// Creates the first admin account (the root of the invite tree) and prints its invite link.
//   npm run seed -- you@example.com
//   npm run seed -- you@example.com --demo   (also adds sample members and activities for local testing)
import 'dotenv/config';
import { migrate, one, q, pool } from '../src/db.js';
import { normalizeEmail, randomCode } from '../src/util.js';

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.includes('@'));
const demo = args.includes('--demo');
if (!emailArg) {
  console.error('Usage: npm run seed -- you@example.com [--demo]');
  process.exit(1);
}

await migrate();
const email = normalizeEmail(emailArg);
let admin = await one('select * from users where email = $1', [email]);
if (!admin) {
  admin = await one(
    `insert into users (email, email_display, role, invite_code) values ($1, $2, 'admin', $3) returning *`,
    [email, emailArg, randomCode(8)]);
} else {
  admin = await one(`update users set role = 'admin' where id = $1 returning *`, [admin.id]);
}
const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
console.log(`\nAdmin: ${emailArg}`);
console.log(`Your invite link: ${base}/join/${admin.invite_code}`);
console.log('Sign in with your email to finish your profile, then share your invite link.\n');

if (demo) {
  const people = [
    ['dana@demo.test', 'Dana', '1994-03-02', 'F', ['friends', 'romance']],
    ['marcus@demo.test', 'Marcus', '1982-07-19', 'M', ['friends', 'community']],
    ['kim@demo.test', 'Kim', '1997-11-05', 'F', ['friends']],
    ['ray@demo.test', 'Ray', '1990-01-23', 'M', ['romance', 'friends']],
  ];
  const ids = {};
  for (const [e, name, birth, gender, intents] of people) {
    const u = await one(
      `insert into users (email, email_display, first_name, birth_date, gender, intents, bio, photo_path, invite_code, invited_by, invited_at)
       values ($1, $1, $2, $3, $4, $5, $6, null, $7, $8, now())
       on conflict (email) do update set first_name = excluded.first_name returning id`,
      [e, name, birth, gender, intents, `Hi, I'm ${name}. Demo account.`, randomCode(8), admin.id]);
    ids[name] = u.id;
  }
  const day = 24 * 3600 * 1000;
  const at = (days, hour) => { const d = new Date(Date.now() + days * day); d.setHours(hour, 0, 0, 0); return d; };
  const acts = [
    [ids.Dana, 'Trivia Night', '[Bar name]', 'East Nashville', at(3, 19), at(3, 21), 6, 'pay_own', [], [], 'review'],
    [ids.Marcus, 'Dragon Boat Practice', 'Percy Priest Lake', 'Hermitage', at(5, 9), at(5, 11), 5, 'free', ['friends', 'community'], [], 'first_come'],
    [ids.Kim, 'Pickleball Meetup', 'Centennial Park', 'Midtown', at(2, 17), at(2, 19), 4, 'free', [], [], 'review'],
    [ids.Ray, 'Comedy Club, extra ticket', '[Comedy club]', 'Downtown', at(4, 20), at(4, 22), 1, 'host_covers', ['romance'], ['F'], 'review'],
  ];
  for (const [host, title, place, hood, s, e, spots, cost, intents, genders, style] of acts) {
    await q(
      `insert into activities (host_id, title, place_name, neighborhood, starts_at, ends_at, spots, cost_type,
         audience_intents, audience_genders, invite_style)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [host, title, place, hood, s, e, spots, cost, intents, genders, style]);
  }
  console.log('Added 4 demo members (their emails end in @demo.test) and 4 activities.\n');
}
await pool.end();
