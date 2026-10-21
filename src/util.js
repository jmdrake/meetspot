import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

// Gmail ignores dots and +tags, so they must not create separate accounts.
export function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  let [local, domain] = email.split('@');
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

export const sha256 = (s) => crypto.createHash('sha256').update(`${process.env.SECRET || 'dev'}:${s}`).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const randomDigits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = (n) => Array.from({ length: n }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');

export function age(birthDate, at = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  const m = at.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

// "30s" — the only age anyone sees before an invite.
export const ageRange = (birthDate) => {
  const a = age(birthDate);
  return a == null ? '' : `${Math.floor(a / 10) * 10}s`;
};

// "F · 30s" — how a host appears before inviting someone.
export const anonLabel = (u) => [u.gender, ageRange(u.birth_date)].filter(Boolean).join(' · ');

export const HOUR = 3600 * 1000;
