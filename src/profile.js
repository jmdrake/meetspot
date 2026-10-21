import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { one, all } from './db.js';
import { fail, age, ageRange, randomToken } from './util.js';
import { requireUser } from './auth.js';

export const router = express.Router();
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const INTENTS = ['romance', 'friends', 'networking', 'community'];

// Photos live on local disk by default, or in Supabase Storage when it is configured
// (needed on hosts whose disk is wiped on each deploy). Stored paths starting "sb:" are in Supabase.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'photos';
const useSupabaseStorage = () => !!(SB_URL && SB_KEY);

export const photoUrl = (u) => {
  const p = u?.photo_path;
  if (!p) return null;
  if (p.startsWith('sb:')) return `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${p.slice(3)}`;
  return `/uploads/${p}`;
};

async function storePhoto(file) {
  const name = `${randomToken(12)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`;
  if (useSupabaseStorage()) {
    const res = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SB_KEY}`, 'Content-Type': file.mimetype, 'x-upsert': 'false' },
      body: file.buffer,
    });
    if (!res.ok) throw new Error(`Photo upload failed: ${res.status} ${await res.text()}`);
    return `sb:${name}`;
  }
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return name;
}

async function removePhoto(p) {
  if (!p) return;
  if (p.startsWith('sb:')) {
    await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${p.slice(3)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${SB_KEY}` },
    }).catch(() => {});
  } else fs.rm(path.join(UPLOAD_DIR, p), { force: true }, () => {});
}

export const profileComplete = (u) =>
  !!(u.first_name && u.birth_date && u.gender && u.intents?.length && u.photo_path);

// What the member sees about themselves.
export function selfView(u) {
  return {
    id: u.id,
    email: u.email_display,
    role: u.role,
    firstName: u.first_name,
    birthDate: u.birth_date ? new Date(u.birth_date).toISOString().slice(0, 10) : null,
    age: age(u.birth_date),
    ageRange: ageRange(u.birth_date),
    gender: u.gender,
    intents: u.intents,
    bio: u.bio,
    interests: u.interests,
    photo: photoUrl(u),
    homeCity: u.home_city,
    inviteCode: u.invite_code,
    complete: profileComplete(u),
  };
}

router.get('/me', (req, res) => {
  res.json({ user: req.user ? selfView(req.user) : null });
});

router.put('/me', requireUser, async (req, res) => {
  const b = req.body;
  const firstName = String(b.firstName || '').trim().slice(0, 40);
  if (!firstName) fail(400, 'First name is required');
  const birth = b.birthDate ? new Date(b.birthDate) : null;
  if (!birth || isNaN(birth)) fail(400, 'Birth date is required');
  if (age(birth) < 18) fail(400, 'MeetSpot is for adults 18 and over');
  if (!['F', 'M', 'X'].includes(b.gender)) fail(400, 'Choose a gender');
  const intents = (b.intents || []).filter((i) => INTENTS.includes(i));
  if (!intents.length) fail(400, 'Choose at least one reason you are here');
  const interests = (b.interests || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
  const u = await one(
    `update users set first_name = $1, birth_date = $2, gender = $3, intents = $4, bio = $5, interests = $6
      where id = $7 returning *`,
    [firstName, birth.toISOString().slice(0, 10), b.gender, intents, String(b.bio || '').slice(0, 500), interests, req.user.id]);
  res.json({ user: selfView(u) });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});

router.post('/me/photo', requireUser, upload.single('photo'), async (req, res) => {
  if (!req.file) fail(400, 'Choose a JPG, PNG or WebP photo under 6 MB');
  const old = req.user.photo_path;
  const stored = await storePhoto(req.file);
  const u = await one('update users set photo_path = $1 where id = $2 returning *', [stored, req.user.id]);
  await removePhoto(old);
  res.json({ user: selfView(u) });
});

// My invite link and who joined through it (the referral record).
router.get('/me/invites', requireUser, async (req, res) => {
  const joined = await all(
    `select first_name, invited_at from users where invited_by = $1 order by invited_at desc`, [req.user.id]);
  res.json({
    code: req.user.invite_code,
    joined: joined.map((j) => ({ firstName: j.first_name || 'New member', joinedAt: j.invited_at })),
  });
});

export { INTENTS };
