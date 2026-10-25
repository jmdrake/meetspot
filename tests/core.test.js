// End-to-end tests of the milestone 1 loop against a real Postgres database.
// Uses TEST_DATABASE_URL (default: local meetspot_test). The schema is wiped before the run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5433/meetspot_test?host=/tmp';
process.env.DEV_SHOW_CODES = '1';
process.env.SECRET = 'test';
process.env.UPLOAD_DIR = '/tmp/meetspot-test-uploads';

const { pool, migrate, one, q } = await import('../src/db.js');
const { createApp } = await import('../src/server.js');
const { runJobs, offerWindowMs } = await import('../src/activities.js');
const { randomCode } = await import('../src/util.js');

let server, base, rootInvite;
const HOUR = 3600e3;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate();
  const admin = await one(`insert into users (email, email_display, role, invite_code, first_name)
                           values ('root@test.dev','root@test.dev','admin',$1,'Root') returning *`, [randomCode(8)]);
  rootInvite = admin.invite_code;
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

// A tiny browser: keeps the session cookie.
function client() {
  let cookie = '';
  const call = async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(form ? {} : { 'content-type': 'application/json' }) },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    upload: (p, form) => call('POST', p, null, { form }),
  };
}

async function agreeAll(c, kind) {
  const a = await c.get(`/api/agreements/${kind}`);
  for (const card of a.cards.filter((x) => x.pending)) {
    const r = await c.post(`/api/agreements/${kind}/${card.id}`, { version: card.version, initials: 'TT', checkAnswer: card.check?.answer });
    assert.equal(r.status, 200, r.error);
  }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function member(email, { gender = 'F', birth = '1993-05-01', intents = ['friends', 'romance'], invite = rootInvite, name } = {}) {
  const c = client();
  const s = await c.post('/api/auth/start', { email, invite });
  assert.equal(s.status, 200, s.error);
  const v = await c.post('/api/auth/verify', { email, code: s.devCode });
  assert.equal(v.status, 200, v.error);
  await agreeAll(c, 'member');
  await agreeAll(c, 'host');
  const p = await c.put('/api/me', { firstName: name || email.split('@')[0], birthDate: birth, gender, intents });
  assert.equal(p.status, 200, p.error);
  const form = new FormData();
  form.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
  const up = await c.upload('/api/me/photo', form);
  assert.equal(up.status, 200, up.error);
  c.user = up.user;
  return c;
}

const iso = (ms) => new Date(Date.now() + ms).toISOString();
const newActivity = (over = {}) => ({
  title: 'Trivia Night', placeName: 'The Pub', neighborhood: 'East', startsAt: iso(72 * HOUR), endsAt: iso(75 * HOUR),
  spots: 2, costType: 'free', inviteStyle: 'review', autoFill: true, audience: { intents: [], genders: [], ageMin: 18, ageMax: 99 },
  ...over,
});

test('sign-up is invite-only and the referral is recorded once', async () => {
  const c = client();
  const r = await c.post('/api/auth/start', { email: 'stranger@test.dev' });
  assert.equal(r.status, 403);

  const m = await member('jane.doe+meetspot@gmail.com', { name: 'Jane' });
  assert.equal(m.user.complete, true);
  const row = await one(`select * from users where email = 'janedoe@gmail.com'`);
  assert.ok(row, 'gmail address normalized');
  const root = await one(`select id from users where invite_code = $1`, [rootInvite]);
  assert.equal(row.invited_by, root.id);
  await assert.rejects(q(`update users set invited_by = null where id = $1`, [row.id]), /write-once/);

  // Same person, different spelling: no second account, and no invite needed.
  const again = client();
  const s = await again.post('/api/auth/start', { email: 'JaneDoe@gmail.com' });
  assert.equal(s.status, 200);
  const bad = await again.post('/api/auth/verify', { email: 'JaneDoe@gmail.com', code: '000000' === s.devCode ? '111111' : '000000' });
  assert.equal(bad.status, 400);
  const ok = await again.post('/api/auth/verify', { email: 'JaneDoe@gmail.com', code: s.devCode });
  assert.equal(ok.status, 200);
  assert.equal((await again.get('/api/me')).user.firstName, 'Jane');
  assert.equal((await one(`select count(*)::int n from users where email = 'janedoe@gmail.com'`)).n, 1);

  const invites = await m.get('/api/me/invites');
  assert.equal(invites.code, m.user.inviteCode);
});

test('codes lock after 5 wrong tries', async () => {
  const c = client();
  const s = await c.post('/api/auth/start', { email: 'locky@test.dev', invite: rootInvite });
  const wrong = s.devCode === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/verify', { email: 'locky@test.dev', code: wrong })).status, 400);
  assert.equal((await c.post('/api/auth/verify', { email: 'locky@test.dev', code: s.devCode })).status, 429);
});

test('the full loop: anonymous host, review, parallel invites, waitlist offer, re-confirm', async () => {
  const host = await member('host1@test.dev', { name: 'Hana', gender: 'F', birth: '1991-02-02' });
  const a1 = await member('guest1@test.dev', { name: 'Al', gender: 'M' });
  const b1 = await member('guest2@test.dev', { name: 'Bo', gender: 'M' });
  const c1 = await member('guest3@test.dev', { name: 'Cy', gender: 'M' });
  const d1 = await member('guest4@test.dev', { name: 'Di', gender: 'F' });

  const { activity } = await host.post('/api/activities', newActivity());
  assert.equal(activity.status, 'open');

  // Discover shows the host as "F · 30s" with no name or photo-free identity.
  const disc = await a1.get('/api/activities?view=discover');
  const seen = disc.activities.find((x) => x.id === activity.id);
  assert.equal(seen.host.label, 'F · 30s');
  assert.equal(seen.host.firstName, null);

  for (const g of [a1, b1, c1]) assert.equal((await g.post(`/api/activities/${activity.id}/request`)).activity.me.status, 'requested');

  // Host sees requesters' photos but not their names.
  let view = (await host.get(`/api/activities/${activity.id}`)).activity;
  assert.equal(view.people.length, 3);
  assert.ok(view.people.every((p) => p.person.photo && p.person.firstName === null));

  // Parallel invites: three invites for two spots.
  for (const p of view.people) assert.equal((await host.post(`/api/participations/${p.participationId}/invite`)).status, 200);
  const aView = (await a1.get(`/api/activities/${activity.id}`)).activity;
  assert.equal(aView.host.firstName, 'Hana', 'invite reveals the host');

  assert.equal((await a1.post(`/api/activities/${activity.id}/accept`)).activity.me.status, 'confirmed');
  const bAcc = await b1.post(`/api/activities/${activity.id}/accept`);
  assert.equal(bAcc.activity.me.status, 'confirmed');
  assert.equal(bAcc.activity.status, 'full');
  const cAcc = await c1.post(`/api/activities/${activity.id}/accept`);
  assert.equal(cAcc.status, 400, 'third invite was filled');
  assert.equal((await c1.get(`/api/activities/${activity.id}`)).activity.me.status, 'filled');

  // A request to a full activity joins the waitlist.
  assert.equal((await d1.post(`/api/activities/${activity.id}/request`)).activity.me.status, 'waitlisted');

  // Al drops out (3 days ahead: not late) → Di gets an offer and claims it.
  assert.equal((await a1.post(`/api/activities/${activity.id}/drop`)).activity.me.status, 'dropped');
  assert.equal((await one(`select late_cancel_count from users where email = 'guest1@test.dev'`)).late_cancel_count, 0);
  const dView = (await d1.get(`/api/activities/${activity.id}`)).activity;
  assert.equal(dView.me.status, 'offered');
  const mail = await d1.get('/api/mail');
  assert.ok(mail.mail.some((m) => m.kind === 'offer' && m.open));
  assert.equal((await d1.post(`/api/activities/${activity.id}/claim`)).activity.me.status, 'confirmed');

  // Changing the time asks confirmed guests to re-confirm.
  await host.put(`/api/activities/${activity.id}`, { startsAt: iso(80 * HOUR), endsAt: iso(82 * HOUR) });
  const bAfter = (await b1.get(`/api/activities/${activity.id}`)).activity;
  assert.equal(bAfter.me.needsReconfirm, true);
  assert.equal((await b1.post(`/api/activities/${activity.id}/reconfirm`)).activity.me.needsReconfirm, false);

  // Chat: confirmed guests can talk; someone whose invite was filled cannot read it.
  assert.equal((await b1.post(`/api/activities/${activity.id}/messages`, { body: 'See you there!' })).status, 201);
  assert.equal((await host.get(`/api/activities/${activity.id}/messages`)).messages.length, 1);
  assert.equal((await c1.get(`/api/activities/${activity.id}/messages`)).status, 403);
});

test('audience settings decide who sees an activity in Discover', async () => {
  const host = await member('host2@test.dev', { gender: 'M' });
  const woman = await member('w2@test.dev', { gender: 'F', intents: ['romance'] });
  const man = await member('m2@test.dev', { gender: 'M', intents: ['romance'] });
  const friendOnly = await member('f2@test.dev', { gender: 'F', intents: ['friends'] });
  const { activity } = await host.post('/api/activities',
    newActivity({ spots: 1, audience: { intents: ['romance'], genders: ['F'], ageMin: 25, ageMax: 45 } }));
  const sees = async (c) => (await c.get('/api/activities?view=discover')).activities.some((x) => x.id === activity.id);
  assert.equal(await sees(woman), true);
  assert.equal(await sees(man), false);
  assert.equal(await sees(friendOnly), false);
});

test('first-come joins instantly; check-in by code marks attendance', async () => {
  const host = await member('host3@test.dev');
  const g = await member('g3@test.dev');
  const { activity } = await host.post('/api/activities',
    newActivity({ inviteStyle: 'first_come', startsAt: iso(0.5 * HOUR), endsAt: iso(2 * HOUR) }));
  const joined = await g.post(`/api/activities/${activity.id}/request`);
  assert.equal(joined.activity.me.status, 'confirmed');
  const code = joined.activity.me.checkinCode;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal((await host.post(`/api/activities/${activity.id}/checkin`, { code: 'WRONG1' })).status, 404);
  const ok = await host.post(`/api/activities/${activity.id}/checkin`, { code: code.toLowerCase() });
  assert.equal(ok.checkedIn, 'g3');
  assert.equal((await g.get(`/api/activities/${activity.id}`)).activity.me.status, 'attended');
});

test('launch rule: no activities at private homes', async () => {
  const host = await member('host4b@test.dev');
  const r = await host.post('/api/activities', newActivity({ isPrivateHome: true, placeName: 'My place', neighborhood: 'Sylvan Park' }));
  assert.equal(r.status, 400);
  assert.match(r.error, /public place/);
});

test('private home address is shown only to confirmed guests (when homes are enabled)', async () => {
  process.env.ALLOW_HOME_ACTIVITIES = '1';
  const host = await member('host4@test.dev');
  const g = await member('g4@test.dev');
  const { activity } = await host.post('/api/activities',
    newActivity({ isPrivateHome: true, placeName: "Hana's place", address: '12 Elm St', neighborhood: 'Sylvan Park', inviteStyle: 'first_come' }));
  const before = (await g.get('/api/activities?view=discover')).activities.find((x) => x.id === activity.id);
  assert.equal(before.address, null);
  assert.equal(before.placeName, 'Private home');
  const joined = (await g.post(`/api/activities/${activity.id}/request`)).activity;
  assert.equal(joined.address, '12 Elm St');
  delete process.env.ALLOW_HOME_ACTIVITIES;
});

test('canceling: deleted if nobody confirmed, otherwise everyone is told', async () => {
  const host = await member('host5@test.dev');
  const g = await member('g5@test.dev');
  const { activity: empty } = await host.post('/api/activities', newActivity());
  assert.equal((await host.post(`/api/activities/${empty.id}/cancel`, { reason: 'cant_make_it' })).deleted, true);
  assert.equal((await host.get(`/api/activities/${empty.id}`)).status, 404);

  const { activity } = await host.post('/api/activities', newActivity({ inviteStyle: 'first_come', startsAt: iso(10 * HOUR), endsAt: iso(12 * HOUR) }));
  await g.post(`/api/activities/${activity.id}/request`);
  const r = await host.post(`/api/activities/${activity.id}/cancel`, { reason: 'cant_make_it', note: 'Sorry, sick' });
  assert.equal(r.deleted, false);
  assert.ok((await g.get('/api/mail')).mail.some((m) => m.kind === 'canceled' && m.body === 'Sorry, sick'));
  assert.equal((await one(`select late_cancel_count from users where email = 'host5@test.dev'`)).late_cancel_count, 1);
  const past = await g.get('/api/activities?view=past');
  assert.equal(past.activities.find((x) => x.id === activity.id).status, 'canceled');
});

test('waitlist offers expire and pass on; no-shows are counted', async () => {
  const host = await member('host6@test.dev');
  const g1 = await member('g6a@test.dev');
  const g2 = await member('g6b@test.dev');
  const g3 = await member('g6c@test.dev');
  const { activity } = await host.post('/api/activities', newActivity({ spots: 1, inviteStyle: 'first_come' }));
  await g1.post(`/api/activities/${activity.id}/request`);
  await g2.post(`/api/activities/${activity.id}/request`);
  await g3.post(`/api/activities/${activity.id}/request`);
  await g1.post(`/api/activities/${activity.id}/drop`);
  assert.equal((await g2.get(`/api/activities/${activity.id}`)).activity.me.status, 'offered');
  await q(`update participations set offer_expires_at = now() - interval '1 minute' where status = 'offered' and activity_id = $1`, [activity.id]);
  await runJobs();
  assert.equal((await g2.get(`/api/activities/${activity.id}`)).activity.me.status, 'expired');
  assert.equal((await g3.get(`/api/activities/${activity.id}`)).activity.me.status, 'offered');

  // Offer windows: 6 h a week out, 1 h a day out, 15 min the same evening.
  assert.equal(offerWindowMs({ starts_at: iso(7 * 24 * HOUR) }), 6 * HOUR);
  assert.equal(offerWindowMs({ starts_at: iso(24 * HOUR) }), 1 * HOUR);
  assert.equal(offerWindowMs({ starts_at: iso(3 * HOUR) }), 0.25 * HOUR);

  // Move the activity into the past: confirmed-but-never-checked-in becomes a no-show.
  await g3.post(`/api/activities/${activity.id}/claim`);
  await q(`update activities set starts_at = now() - interval '5 hours', ends_at = now() - interval '3 hours' where id = $1`, [activity.id]);
  await runJobs();
  assert.equal((await g3.get(`/api/activities/${activity.id}`)).activity.me.status, 'no_show');
  assert.equal((await one(`select no_show_count from users where email = 'g6c@test.dev'`)).no_show_count, 1);
});

test('Google/Apple sign-in via a Supabase token: invite needed for new people', async () => {
  const { SignJWT } = await import('jose');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_JWT_SECRET = 'sb-secret';
  const token = await new SignJWT({ email: 'oauth.person@gmail.com' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111').setExpirationTime('5m').sign(new TextEncoder().encode('sb-secret'));
  const c = client();
  assert.equal((await c.post('/api/auth/supabase', { access_token: token })).status, 403);
  assert.equal((await c.post('/api/auth/supabase', { access_token: token, invite: rootInvite })).status, 200);
  assert.equal((await c.get('/api/me')).user.email, 'oauth.person@gmail.com');
  assert.equal((await c.post('/api/auth/supabase', { access_token: 'garbage' })).status, 401);
  delete process.env.SUPABASE_URL;
});

test('agreements: initial every card before using MeetSpot; hosts initial the host cards', async () => {
  const { AGREEMENTS } = await import('../src/agreements.js');
  const c = client();
  const s = await c.post('/api/auth/start', { email: 'newbie@test.dev', invite: rootInvite });
  await c.post('/api/auth/verify', { email: 'newbie@test.dev', code: s.devCode });
  assert.deepEqual((await c.get('/api/me')).user.agreements, { member: false, host: false });

  const blocked = await c.put('/api/me', { firstName: 'Nia', birthDate: '1990-01-01', gender: 'F', intents: ['friends'] });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, 'agreement_member');

  const m = await c.get('/api/agreements/member');
  assert.equal(m.firstTime, true);
  assert.equal(m.cards.length, AGREEMENTS.member.cards.length);
  const withCheck = m.cards.find((x) => x.check);
  const wrong = (withCheck.check.answer + 1) % withCheck.check.options.length;
  assert.equal((await c.post(`/api/agreements/member/${withCheck.id}`, { version: withCheck.version, initials: 'NA', checkAnswer: wrong })).status, 400);
  assert.equal((await c.post(`/api/agreements/member/${m.cards[0].id}`, { version: m.cards[0].version, initials: 'x' })).status, 400);
  assert.equal((await c.post(`/api/agreements/member/${m.cards[0].id}`, { version: 99, initials: 'NA' })).status, 409);

  await agreeAll(c, 'member');
  const me = (await c.get('/api/me')).user;
  assert.deepEqual(me.agreements, { member: true, host: false });
  assert.equal((await c.put('/api/me', { firstName: 'Nia', birthDate: '1990-01-01', gender: 'F', intents: ['friends'] })).status, 200);

  // Hosting needs the host agreement.
  const form = new FormData();
  form.append('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
  await c.upload('/api/me/photo', form);
  const noHost = await c.post('/api/activities', newActivity());
  assert.equal(noHost.code, 'agreement_host');
  await agreeAll(c, 'host');
  assert.equal((await c.post('/api/activities', newActivity())).status, 201);

  // The record is permanent and stores initials, version and device.
  const row = await one(`select a.* from agreement_acceptances a join users u on u.id = a.user_id
                          where u.email = 'newbie@test.dev' and a.card_id = $1`, [withCheck.id]);
  assert.equal(row.initials, 'TT');
  assert.equal(row.check_passed, true);
  await assert.rejects(q('update agreement_acceptances set initials = $1 where id = $2', ['ZZ', row.id]), /cannot be changed/);

  // Changing one card asks for that card again, and only that card.
  const card = AGREEMENTS.member.cards[2];
  card.version += 1;
  try {
    assert.equal((await c.get('/api/me')).user.agreements.member, false);
    const again = await c.get('/api/agreements/member');
    assert.deepEqual(again.cards.filter((x) => x.pending).map((x) => x.id), [card.id]);
    assert.equal(again.cards.find((x) => x.id === card.id).updated, true);
    assert.equal((await c.get('/api/activities?view=discover')).status, 403);
    await agreeAll(c, 'member');
    assert.equal((await c.get('/api/me')).user.agreements.member, true);
  } finally { card.version -= 1; }
});
