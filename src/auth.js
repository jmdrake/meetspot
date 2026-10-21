import express from 'express';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { q, one, tx } from './db.js';
import { fail, normalizeEmail, sha256, randomToken, randomDigits, randomCode } from './util.js';
import { sendEmail } from './email.js';

const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

export const router = express.Router();

// ---- sessions ----------------------------------------------------------

function setSession(res, token) {
  res.cookie('ms_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  });
}

async function createSession(res, userId) {
  const token = randomToken();
  await q(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [sha256(token), userId]);
  setSession(res, token);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Attaches req.user when a valid session cookie is present.
export async function loadUser(req, _res, next) {
  try {
    const token = readCookie(req, 'ms_session');
    if (token) {
      req.user = await one(
        `select u.* from sessions s join users u on u.id = s.user_id
          where s.token_hash = $1 and s.expires_at > now()`, [sha256(token)]);
    }
    next();
  } catch (e) { next(e); }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(Object.assign(new Error('Please sign in'), { status: 401 }));
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(Object.assign(new Error('Admins only'), { status: 403 }));
  next();
}

// ---- finding or creating the member ------------------------------------

async function inviterFor(inviteCode) {
  if (!inviteCode) return null;
  return one('select id from users where invite_code = $1', [String(inviteCode).trim().toUpperCase()]);
}

// Existing member → them. New email → requires a valid invite (invite-only test).
async function findOrCreateUser({ email, emailDisplay, inviteCode, supabaseId }) {
  const existing = await one('select * from users where email = $1', [email]);
  if (existing) {
    if (supabaseId && !existing.supabase_id) await q('update users set supabase_id = $1 where id = $2', [supabaseId, existing.id]);
    return existing;
  }
  const inviter = await inviterFor(inviteCode);
  if (!inviter) fail(403, 'MeetSpot is invite-only right now. Ask a member for their invite link.');
  return tx(async (c) => {
    for (let i = 0; i < 5; i++) {
      const code = randomCode(8);
      const taken = await c.one('select 1 from users where invite_code = $1', [code]);
      if (taken) continue;
      return c.one(
        `insert into users (email, email_display, supabase_id, invite_code, invited_by, invited_at)
         values ($1, $2, $3, $4, $5, now()) returning *`,
        [email, emailDisplay, supabaseId || null, code, inviter.id]);
    }
    fail(500, 'Could not create account');
  });
}

// ---- email codes --------------------------------------------------------

router.post('/start', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) fail(400, 'Enter a valid email address');
  const exists = await one('select 1 from users where email = $1', [email]);
  if (!exists && !(await inviterFor(req.body.invite))) {
    fail(403, 'MeetSpot is invite-only right now. Ask a member for their invite link.');
  }
  const recent = await one(
    `select count(*)::int as n from login_codes where email = $1 and created_at > now() - interval '1 hour'`, [email]);
  if (recent.n >= MAX_CODES_PER_HOUR) fail(429, 'Too many codes requested. Try again in an hour.');

  const code = randomDigits(6);
  await q(
    `insert into login_codes (email, code_hash, invite_code, expires_at)
     values ($1, $2, $3, now() + interval '${CODE_MINUTES} minutes')`,
    [email, sha256(`${email}:${code}`), req.body.invite || null]);
  await sendEmail({
    to: String(req.body.email).trim(),
    subject: `${code} is your MeetSpot code`,
    text: `Your MeetSpot sign-in code is ${code}. It expires in ${CODE_MINUTES} minutes and works once.\n\nIf you didn't ask for it, ignore this email.`,
  });
  // DEV_SHOW_CODES lets testers sign in without an email service. Never set it in production.
  res.json({ ok: true, ...(process.env.DEV_SHOW_CODES === '1' ? { devCode: code } : {}) });
});

router.post('/verify', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!email || !code) fail(400, 'Enter the code from your email');
  const row = await one(
    `select * from login_codes where email = $1 and used_at is null and expires_at > now()
      order by created_at desc limit 1`, [email]);
  if (!row) fail(400, 'That code has expired. Request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) fail(429, 'Too many wrong tries. Request a new code.');
  if (row.code_hash !== sha256(`${email}:${code}`)) {
    await q('update login_codes set attempts = attempts + 1 where id = $1', [row.id]);
    fail(400, 'That code is not right');
  }
  await q('update login_codes set used_at = now() where id = $1', [row.id]);
  const user = await findOrCreateUser({
    email, emailDisplay: String(req.body.email).trim(), inviteCode: row.invite_code || req.body.invite,
  });
  await createSession(res, user.id);
  res.json({ ok: true });
});

// ---- Supabase (Google, Apple, or Supabase-sent email codes) -------------
// The browser signs in with supabase-js, then trades its access token for a MeetSpot session.

// Newer Supabase projects sign tokens with rotating public keys (JWKS); older ones with a shared secret.
let jwks;
async function verifySupabaseToken(token) {
  const { alg } = decodeProtectedHeader(token);
  if (alg === 'HS256') {
    if (!process.env.SUPABASE_JWT_SECRET) throw new Error('no secret');
    return (await jwtVerify(token, new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET))).payload;
  }
  jwks ||= createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return (await jwtVerify(token, jwks)).payload;
}

router.post('/supabase', async (req, res) => {
  if (!process.env.SUPABASE_URL) fail(400, 'Supabase sign-in is not configured');
  let claims;
  try {
    claims = await verifySupabaseToken(String(req.body.access_token || ''));
  } catch {
    fail(401, 'Sign-in expired. Try again.');
  }
  const email = normalizeEmail(claims.email);
  if (!email) fail(400, 'Your account has no email address');
  const user = await findOrCreateUser({
    email, emailDisplay: claims.email, inviteCode: req.body.invite, supabaseId: claims.sub,
  });
  await createSession(res, user.id);
  res.json({ ok: true });
});

router.post('/signout', async (req, res) => {
  const token = readCookie(req, 'ms_session');
  if (token) await q('delete from sessions where token_hash = $1', [sha256(token)]);
  res.clearCookie('ms_session', { path: '/' });
  res.json({ ok: true });
});

router.get('/invite/:code', async (req, res) => {
  const inviter = await one('select first_name from users where invite_code = $1', [req.params.code.toUpperCase()]);
  res.json({ valid: !!inviter, inviter: inviter?.first_name || null });
});
