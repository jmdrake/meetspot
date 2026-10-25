import express from 'express';
import QRCode from 'qrcode';
import { q, one, all, tx } from './db.js';
import { fail, age, anonLabel, ageRange, randomCode, HOUR } from './util.js';
import { requireUser } from './auth.js';
import { requireAgreement } from './consent.js';
import { photoUrl, profileComplete, INTENTS } from './profile.js';

export const router = express.Router();
router.use(requireUser);
router.use(requireAgreement('member'));

const COST_TYPES = ['free', 'pay_own', 'dutch', 'host_covers', 'ticket'];
const CANCEL_REASONS = ['event_canceled', 'cant_make_it', 'safety'];
const COUNTED = `('confirmed','attended','no_show')`;          // statuses that hold a spot
const REVEALED = ['invited', 'offered', 'confirmed', 'attended', 'no_show']; // host identity visible
const CHAT_OK = ['invited', 'offered', 'confirmed', 'attended', 'no_show'];
const LATE_HOURS = 48;

function requireComplete(req) {
  if (!profileComplete(req.user)) fail(400, 'Finish your profile first');
}

// ---- rules ---------------------------------------------------------------

export function derivedStatus(a, confirmed, now = new Date()) {
  if (a.canceled_at) return 'canceled';
  const start = new Date(a.starts_at), end = new Date(a.ends_at);
  if (now >= new Date(end.getTime() + 2 * HOUR)) return 'past';
  if (now >= start) return 'happening';
  return confirmed >= a.spots ? 'full' : 'open';
}

// Invites last 24 hours, but end 2 hours before the start (never less than 15 minutes).
function inviteExpiry(a, now = Date.now()) {
  const start = new Date(a.starts_at).getTime();
  const t = Math.min(now + 24 * HOUR, start - 2 * HOUR);
  return new Date(Math.min(Math.max(t, now + 0.25 * HOUR), start));
}

// Waitlist offer window scales with how soon the activity starts.
export function offerWindowMs(a, now = Date.now()) {
  const until = new Date(a.starts_at).getTime() - now;
  const w = until > 48 * HOUR ? 6 * HOUR : until > 6 * HOUR ? 1 * HOUR : 0.25 * HOUR;
  return Math.max(Math.min(w, until), 5 * 60 * 1000);
}

const isLate = (a) => new Date(a.starts_at).getTime() - Date.now() < LATE_HOURS * HOUR;

async function notify(c, userId, kind, activityId, title, body = null) {
  await c.q('insert into notifications (user_id, kind, activity_id, title, body) values ($1,$2,$3,$4,$5)',
    [userId, kind, activityId, title, body]);
}

const countConfirmed = async (c, id) =>
  (await c.one(`select count(*)::int n from participations where activity_id = $1 and status in ${COUNTED}`, [id])).n;

async function lockActivity(c, id) {
  const a = await c.one('select * from activities where id = $1 for update', [id]);
  if (!a) fail(404, 'Activity not found');
  return a;
}

async function myPart(c, activityId, userId, forUpdate = true) {
  return c.one(`select * from participations where activity_id = $1 and user_id = $2 ${forUpdate ? 'for update' : ''}`,
    [activityId, userId]);
}

// When the last spot fills: open invites become "filled", pending requests move to the waitlist.
async function settleIfFull(c, a) {
  if ((await countConfirmed(c, a.id)) < a.spots) return;
  const filled = await c.all(
    `update participations set status = 'filled', updated_at = now()
      where activity_id = $1 and status = 'invited' returning user_id`, [a.id]);
  for (const f of filled) await notify(c, f.user_id, 'filled', a.id, `${a.title}: the last spot was taken`, 'Thanks for your interest. Keep an eye on Discover.');
  await c.q(`update participations set status = 'waitlisted', updated_at = now() where activity_id = $1 and status = 'requested'`, [a.id]);
}

// When a spot opens: offer it to the first person waiting (or tell the host to pick).
export async function offerNext(c, a) {
  if (a.canceled_at || new Date(a.starts_at) <= new Date()) return;
  if ((await countConfirmed(c, a.id)) >= a.spots) return;
  const pendingOffer = await c.one(`select 1 from participations where activity_id = $1 and status = 'offered'`, [a.id]);
  if (pendingOffer) return;
  const next = await c.one(
    `select * from participations where activity_id = $1 and status = 'waitlisted' order by requested_at limit 1`, [a.id]);
  if (!next) return;
  if (!a.auto_fill) {
    await notify(c, a.host_id, 'spot_open', a.id, `${a.title}: a spot opened`, 'Pick someone from your waitlist.');
    return;
  }
  const expires = new Date(Date.now() + offerWindowMs(a));
  await c.q(`update participations set status = 'offered', offer_expires_at = $2, updated_at = now() where id = $1`, [next.id, expires]);
  await notify(c, next.user_id, 'offer', a.id, `A spot opened: ${a.title}`, `You were first on the waitlist. Claim it before it passes to the next person.`);
}

async function confirm(c, a, p) {
  if ((await countConfirmed(c, a.id)) >= a.spots) {
    await c.q(`update participations set status = 'filled', updated_at = now() where id = $1`, [p.id]);
    return false;
  }
  await c.q(
    `update participations set status = 'confirmed', checkin_code = $2, invite_expires_at = null,
       offer_expires_at = null, needs_reconfirm = false, updated_at = now() where id = $1`,
    [p.id, randomCode(6)]);
  await settleIfFull(c, a);
  return true;
}

// ---- background housekeeping ----------------------------------------------

let jobsRunning = null;
export function runJobs() {
  if (!jobsRunning) jobsRunning = doJobs().finally(() => { jobsRunning = null; });
  return jobsRunning;
}

async function doJobs() {
  // Invites nobody answered.
  await q(`update participations set status = 'expired', updated_at = now()
            where status = 'invited' and invite_expires_at < now()`);
  // Waitlist offers that ran out pass to the next person.
  const lapsed = await all(
    `update participations set status = 'expired', updated_at = now()
      where status = 'offered' and offer_expires_at < now() returning activity_id`);
  for (const id of new Set(lapsed.map((r) => r.activity_id))) {
    await tx(async (c) => offerNext(c, await lockActivity(c, id)));
  }
  // Activities over for 2 hours: anyone confirmed but never checked in is a no-show.
  const noShows = await all(
    `update participations p set status = 'no_show', updated_at = now()
       from activities a
      where a.id = p.activity_id and p.status = 'confirmed' and a.canceled_at is null
        and a.ends_at + interval '2 hours' < now()
      returning p.user_id`);
  for (const n of noShows) await q('update users set no_show_count = no_show_count + 1 where id = $1', [n.user_id]);
  // Open requests on activities that have started are closed.
  await q(`update participations p set status = 'expired', updated_at = now() from activities a
            where a.id = p.activity_id and p.status in ('requested','waitlisted') and a.starts_at < now()`);
}

// ---- views ------------------------------------------------------------------

function personView(u, revealed) {
  return {
    id: u.id,
    label: anonLabel(u),
    gender: u.gender,
    ageRange: ageRange(u.birth_date),
    intents: u.intents,
    photo: photoUrl(u),
    bio: u.bio,
    interests: u.interests,
    firstName: revealed ? u.first_name : null,
    age: revealed ? age(u.birth_date) : null,
  };
}

async function activityView(a, viewer, { withPeople = false } = {}) {
  const host = await one('select * from users where id = $1', [a.host_id]);
  const confirmed = await countConfirmed({ one }, a.id);
  const part = await one('select * from participations where activity_id = $1 and user_id = $2', [a.id, viewer.id]);
  const isHost = a.host_id === viewer.id;
  const myStatus = part?.status ?? null;
  const revealed = isHost || REVEALED.includes(myStatus);
  const seesAddress = isHost || !a.is_private_home || ['confirmed', 'attended', 'no_show'].includes(myStatus);
  const waitlisted = (await one(`select count(*)::int n from participations where activity_id = $1 and status in ('waitlisted','offered')`, [a.id])).n;

  const v = {
    id: a.id,
    title: a.title,
    description: a.description,
    placeName: seesAddress ? a.place_name : (a.is_private_home ? 'Private home' : a.place_name),
    address: seesAddress ? a.address : null,
    neighborhood: a.neighborhood,
    isPrivateHome: a.is_private_home,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    spots: a.spots,
    confirmed,
    spotsLeft: Math.max(a.spots - confirmed, 0),
    waitlisted,
    costType: a.cost_type,
    priceCents: a.price_cents,
    audience: { intents: a.audience_intents, genders: a.audience_genders, ageMin: a.age_min, ageMax: a.age_max },
    inviteStyle: a.invite_style,
    autoFill: a.auto_fill,
    showToFriends: a.show_to_friends,
    status: derivedStatus(a, confirmed),
    cancelReason: a.cancel_reason,
    cancelNote: a.cancel_note,
    host: { ...personView(host, revealed), isMe: isHost },
    isHost,
    me: part ? {
      status: myStatus,
      inviteExpiresAt: part.invite_expires_at,
      offerExpiresAt: part.offer_expires_at,
      needsReconfirm: part.needs_reconfirm,
      checkinCode: ['confirmed', 'attended'].includes(myStatus) ? part.checkin_code : null,
      checkedIn: !!part.checked_in_at,
    } : null,
    canChat: isHost || CHAT_OK.includes(myStatus),
  };

  if (withPeople && isHost) {
    const rows = await all(
      `select p.*, u.first_name, u.birth_date, u.gender, u.intents, u.bio, u.interests, u.photo_path, u.id as uid,
              u.no_show_count, u.late_cancel_count
         from participations p join users u on u.id = p.user_id
        where p.activity_id = $1 order by p.requested_at`, [a.id]);
    v.people = rows.map((r) => ({
      participationId: r.id,
      status: r.status,
      requestedAt: r.requested_at,
      inviteExpiresAt: r.invite_expires_at,
      offerExpiresAt: r.offer_expires_at,
      needsReconfirm: r.needs_reconfirm,
      checkedIn: !!r.checked_in_at,
      person: personView({ ...r, id: r.uid }, REVEALED.includes(r.status)),
    }));
  }
  if (withPeople && !isHost && ['confirmed', 'attended', 'no_show'].includes(myStatus)) {
    const rows = await all(
      `select u.* from participations p join users u on u.id = p.user_id
        where p.activity_id = $1 and p.status in ${COUNTED} and u.id <> $2`, [a.id, viewer.id]);
    v.going = rows.map((u) => personView(u, true));
  }
  return v;
}

// ---- reading -------------------------------------------------------------------

router.get('/activities', async (req, res) => {
  await runJobs();
  const me = req.user;
  const view = req.query.view || 'discover';
  let rows;
  if (view === 'discover') {
    rows = await all(
      `select a.* from activities a
        where a.canceled_at is null and a.starts_at > now() and a.host_id <> $1
          and not exists (select 1 from participations p where p.activity_id = a.id and p.user_id = $1)
          and (cardinality(a.audience_genders) = 0 or $2 = any(a.audience_genders))
          and $3::int between a.age_min and a.age_max
          and (cardinality(a.audience_intents) = 0 or a.audience_intents && $4::text[])
        order by a.starts_at limit 100`,
      [me.id, me.gender, age(me.birth_date) ?? 0, me.intents]);
  } else if (view === 'requested') {
    rows = await all(
      `select a.* from activities a join participations p on p.activity_id = a.id
        where p.user_id = $1 and p.status in ('requested','invited','waitlisted','offered')
          and a.canceled_at is null and a.starts_at > now()
        order by a.starts_at`, [me.id]);
  } else if (view === 'confirmed') {
    rows = await all(
      `select a.* from activities a
        where a.canceled_at is null and a.ends_at + interval '2 hours' > now()
          and (a.host_id = $1 or exists (select 1 from participations p where p.activity_id = a.id
               and p.user_id = $1 and p.status in ('confirmed','attended')))
        order by a.starts_at`, [me.id]);
  } else if (view === 'past') {
    rows = await all(
      `select a.* from activities a
        where (a.ends_at + interval '2 hours' <= now() or a.canceled_at is not null)
          and (a.host_id = $1 or exists (select 1 from participations p where p.activity_id = a.id
               and p.user_id = $1 and p.status in ('confirmed','attended','no_show','canceled')))
        order by a.starts_at desc limit 100`, [me.id]);
  } else fail(400, 'Unknown view');
  res.json({ activities: await Promise.all(rows.map((a) => activityView(a, me))) });
});

router.get('/activities/:id', async (req, res) => {
  await runJobs();
  const a = await one('select * from activities where id = $1', [req.params.id]);
  if (!a) fail(404, 'This activity is no longer available');
  res.json({ activity: await activityView(a, req.user, { withPeople: true }) });
});

// ---- hosting ----------------------------------------------------------------------

function parseActivity(b, existing = {}) {
  const v = {
    title: String(b.title ?? existing.title ?? '').trim().slice(0, 80),
    description: String(b.description ?? existing.description ?? '').trim().slice(0, 1000) || null,
    place_name: String(b.placeName ?? existing.place_name ?? '').trim().slice(0, 120),
    address: String(b.address ?? existing.address ?? '').trim().slice(0, 200) || null,
    neighborhood: String(b.neighborhood ?? existing.neighborhood ?? '').trim().slice(0, 80) || null,
    is_private_home: Boolean(b.isPrivateHome ?? existing.is_private_home ?? false),
    starts_at: new Date(b.startsAt ?? existing.starts_at),
    ends_at: new Date(b.endsAt ?? existing.ends_at),
    spots: parseInt(b.spots ?? existing.spots, 10),
    cost_type: b.costType ?? existing.cost_type ?? 'free',
    price_cents: b.priceCents != null && b.priceCents !== '' ? Math.round(Number(b.priceCents)) : (existing.price_cents ?? null),
    audience_intents: (b.audience?.intents ?? existing.audience_intents ?? []).filter((i) => INTENTS.includes(i)),
    audience_genders: (b.audience?.genders ?? existing.audience_genders ?? []).filter((g) => ['F', 'M', 'X'].includes(g)),
    age_min: parseInt(b.audience?.ageMin ?? existing.age_min ?? 18, 10),
    age_max: parseInt(b.audience?.ageMax ?? existing.age_max ?? 99, 10),
    invite_style: b.inviteStyle ?? existing.invite_style ?? 'review',
    auto_fill: Boolean(b.autoFill ?? existing.auto_fill ?? true),
    show_to_friends: Boolean(b.showToFriends ?? existing.show_to_friends ?? true),
  };
  if (!v.title) fail(400, 'Give your activity a title');
  if (!v.place_name) fail(400, 'Where is it happening?');
  if (isNaN(v.starts_at) || isNaN(v.ends_at)) fail(400, 'Set a start and end time');
  if (v.ends_at <= v.starts_at) fail(400, 'The end time must be after the start');
  if (!(v.spots >= 1 && v.spots <= 100)) fail(400, 'Spots must be between 1 and 100');
  if (!COST_TYPES.includes(v.cost_type)) fail(400, 'Choose who pays');
  if (v.cost_type !== 'ticket') v.price_cents = null;
  else if (!(v.price_cents > 0)) fail(400, 'Set a ticket price');
  if (!['review', 'first_come'].includes(v.invite_style)) fail(400, 'Choose an invite style');
  if (!(v.age_min >= 18 && v.age_max >= v.age_min && v.age_max <= 99)) fail(400, 'Check the age range');
  // Launch rule: public places only. Home activities return later, friends-only (see the Safety rules in the spec).
  if (v.is_private_home && process.env.ALLOW_HOME_ACTIVITIES !== '1') {
    fail(400, 'During testing, activities must be at a public place. Home activities come later, for friends only.');
  }
  if (v.is_private_home && !v.neighborhood) fail(400, 'Add a neighborhood: a home address is shown only to confirmed guests');
  return v;
}

const COLS = ['title', 'description', 'place_name', 'address', 'neighborhood', 'is_private_home', 'starts_at', 'ends_at',
  'spots', 'cost_type', 'price_cents', 'audience_intents', 'audience_genders', 'age_min', 'age_max', 'invite_style',
  'auto_fill', 'show_to_friends'];
const MATERIAL = ['starts_at', 'ends_at', 'place_name', 'address', 'cost_type', 'price_cents'];

router.post('/activities', requireAgreement('host'), async (req, res) => {
  requireComplete(req);
  const v = parseActivity(req.body);
  if (v.starts_at <= new Date()) fail(400, 'The start time must be in the future');
  const a = await one(
    `insert into activities (host_id, ${COLS.join(', ')})
     values ($1, ${COLS.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
    [req.user.id, ...COLS.map((k) => v[k])]);
  res.status(201).json({ activity: await activityView(a, req.user, { withPeople: true }) });
});

router.put('/activities/:id', requireAgreement('host'), async (req, res) => {
  const updated = await tx(async (c) => {
    const a = await lockActivity(c, req.params.id);
    if (a.host_id !== req.user.id) fail(403, 'Only the host can edit this');
    if (a.canceled_at) fail(400, 'This activity was canceled');
    if (new Date(a.starts_at) <= new Date()) fail(400, 'This activity has already started');
    const v = parseActivity(req.body, a);
    const confirmed = await countConfirmed(c, a.id);
    if (v.spots < confirmed) fail(400, `${confirmed} people are confirmed. Spots can't go below that.`);
    const changed = MATERIAL.some((k) => String(v[k] ?? '') !== String(a[k] ?? ''));
    const b = await c.one(
      `update activities set ${COLS.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now()
        where id = $1 returning *`, [a.id, ...COLS.map((k) => v[k])]);
    if (changed) {
      const guests = await c.all(
        `update participations set needs_reconfirm = true, updated_at = now()
          where activity_id = $1 and status = 'confirmed' returning user_id`, [a.id]);
      for (const g of guests) {
        await notify(c, g.user_id, 'reconfirm', a.id, `${b.title} changed`,
          'The host changed the time, place or cost. Re-confirm, or drop out with no penalty.');
      }
    }
    if (v.spots > a.spots) {
      // Room for more: move requests back from the waitlist and offer spots.
      await offerNext(c, b);
    }
    return b;
  });
  res.json({ activity: await activityView(updated, req.user, { withPeople: true }) });
});

router.post('/activities/:id/cancel', async (req, res) => {
  const reason = req.body.reason;
  if (!CANCEL_REASONS.includes(reason)) fail(400, 'Choose a reason');
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  const result = await tx(async (c) => {
    const a = await lockActivity(c, req.params.id);
    if (a.host_id !== req.user.id) fail(403, 'Only the host can cancel this');
    if (a.canceled_at) fail(400, 'Already canceled');
    if (new Date(a.ends_at) <= new Date()) fail(400, 'This activity is over');
    const confirmed = await countConfirmed(c, a.id);
    const affected = await c.all(
      `select user_id, status from participations where activity_id = $1
          and status in ('requested','invited','waitlisted','offered','confirmed')`, [a.id]);
    if (confirmed === 0) {
      // Nobody confirmed: the activity is simply deleted.
      for (const p of affected.filter((p) => ['invited', 'offered'].includes(p.status))) {
        await notify(c, p.user_id, 'canceled', null, `${a.title} was canceled`, note);
      }
      await c.q('delete from activities where id = $1', [a.id]);
      return { deleted: true };
    }
    await c.q(`update activities set canceled_at = now(), cancel_reason = $2, cancel_note = $3, updated_at = now() where id = $1`,
      [a.id, reason, note]);
    await c.q(`update participations set status = 'canceled', updated_at = now()
                where activity_id = $1 and status in ('requested','invited','waitlisted','offered','confirmed')`, [a.id]);
    for (const p of affected) {
      await notify(c, p.user_id, 'canceled', a.id, `${a.title} was canceled`, note ||
        (reason === 'event_canceled' ? 'The event itself was canceled.' : 'The host canceled this activity.'));
    }
    if (reason === 'cant_make_it' && isLate(a)) {
      await c.q('update users set late_cancel_count = late_cancel_count + 1 where id = $1', [a.host_id]);
    }
    return { deleted: false };
  });
  res.json(result);
});

// Host acts on one person: invite, or decline a request (silently).
router.post('/participations/:pid/:action', async (req, res) => {
  const { pid, action } = req.params;
  const out = await tx(async (c) => {
    const p0 = await c.one('select * from participations where id = $1', [pid]);
    if (!p0) fail(404, 'Not found');
    const a = await lockActivity(c, p0.activity_id);
    if (a.host_id !== req.user.id) fail(403, 'Only the host can do that');
    if (a.canceled_at || new Date(a.starts_at) <= new Date()) fail(400, 'This activity is closed');
    const p = await c.one('select * from participations where id = $1 for update', [pid]);
    if (action === 'invite') {
      if (!['requested', 'waitlisted'].includes(p.status)) fail(400, 'This person can no longer be invited');
      if ((await countConfirmed(c, a.id)) >= a.spots) fail(400, 'All spots are filled. Add a spot or wait for one to open.');
      await c.q(`update participations set status = 'invited', invite_expires_at = $2, updated_at = now() where id = $1`,
        [p.id, inviteExpiry(a)]);
      const host = req.user;
      await notify(c, p.user_id, 'invite', a.id, `${host.first_name} invited you: ${a.title}`, 'Accept to confirm your spot.');
    } else if (action === 'decline') {
      if (!['requested', 'waitlisted'].includes(p.status)) fail(400, 'Nothing to decline');
      await c.q(`update participations set status = 'declined', updated_at = now() where id = $1`, [p.id]);
    } else if (action === 'checkin') {
      checkinWindow(a);
      if (!['confirmed', 'no_show'].includes(p.status)) fail(400, 'Only confirmed guests can check in');
      await c.q(`update participations set status = 'attended', checked_in_at = now(), updated_at = now() where id = $1`, [p.id]);
    } else fail(404, 'Unknown action');
    return a;
  });
  res.json({ activity: await activityView(out, req.user, { withPeople: true }) });
});

function checkinWindow(a) {
  const now = Date.now();
  if (now < new Date(a.starts_at).getTime() - HOUR) fail(400, 'Check-in opens an hour before the start');
  if (now > new Date(a.ends_at).getTime() + 2 * HOUR) fail(400, 'Check-in has closed');
}

router.post('/activities/:id/checkin', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const out = await tx(async (c) => {
    const a = await lockActivity(c, req.params.id);
    if (a.host_id !== req.user.id) fail(403, 'Only the host can check guests in');
    checkinWindow(a);
    const p = await c.one(
      `select p.*, u.first_name from participations p join users u on u.id = p.user_id
        where p.activity_id = $1 and p.checkin_code = $2`, [a.id, code]);
    if (!p) fail(404, 'No guest has that code');
    if (p.status === 'attended') return { a, name: p.first_name, already: true };
    if (!['confirmed', 'no_show'].includes(p.status)) fail(400, 'That guest is not confirmed');
    await c.q(`update participations set status = 'attended', checked_in_at = now(), updated_at = now() where id = $1`, [p.id]);
    return { a, name: p.first_name, already: false };
  });
  res.json({ checkedIn: out.name, already: out.already, activity: await activityView(out.a, req.user, { withPeople: true }) });
});

// ---- guests --------------------------------------------------------------------------

const GUEST_ACTIONS = ['request', 'withdraw', 'accept', 'decline', 'claim', 'pass', 'drop', 'reconfirm'];

router.post('/activities/:id/:action', async (req, res, next) => {
  const { action } = req.params;
  if (!GUEST_ACTIONS.includes(action)) return next();
  if (action === 'request') requireComplete(req);
  const a = await tx(async (c) => {
    const a = await lockActivity(c, req.params.id);
    if (a.canceled_at) fail(400, 'This activity was canceled');
    if (new Date(a.starts_at) <= new Date() && action !== 'drop') fail(400, 'This activity has already started');
    if (a.host_id === req.user.id) fail(400, "You're the host");
    const p = await myPart(c, a.id, req.user.id);

    switch (action) {
      case 'request': {
        if (p) fail(400, 'You already asked to join');
        const full = (await countConfirmed(c, a.id)) >= a.spots;
        const status = full ? 'waitlisted' : a.invite_style === 'first_come' ? 'confirmed' : 'requested';
        const np = await c.one(
          `insert into participations (activity_id, user_id, status) values ($1, $2, $3) returning *`,
          [a.id, req.user.id, status === 'confirmed' ? 'requested' : status]);
        if (status === 'confirmed') {
          await confirm(c, a, np);
          await notify(c, a.host_id, 'joined', a.id, `Someone joined ${a.title}`);
        } else if (status === 'requested') {
          await notify(c, a.host_id, 'request', a.id, `New request for ${a.title}`, 'Review it and invite if it fits.');
        }
        break;
      }
      case 'withdraw':
        if (!p || !['requested', 'waitlisted', 'invited', 'offered'].includes(p.status)) fail(400, 'Nothing to withdraw');
        await c.q(`delete from participations where id = $1`, [p.id]);
        if (p.status === 'offered') await offerNext(c, a);
        break;
      case 'accept':
        if (p?.status !== 'invited') fail(400, 'This invite is no longer open');
        if (new Date(p.invite_expires_at) < new Date()) fail(400, 'This invite expired');
        if (await confirm(c, a, p)) {
          await notify(c, a.host_id, 'confirmed', a.id, `${req.user.first_name} is going to ${a.title}`);
        } else {
          return { a, msg: 'Sorry, the last spot was just taken.' };
        }
        break;
      case 'decline':
        if (p?.status !== 'invited') fail(400, 'This invite is no longer open');
        await c.q(`update participations set status = 'declined', updated_at = now() where id = $1`, [p.id]);
        break;
      case 'claim':
        if (p?.status !== 'offered') fail(400, 'This offer is no longer open');
        if (new Date(p.offer_expires_at) < new Date()) fail(400, 'This offer expired');
        if (await confirm(c, a, p)) {
          await notify(c, a.host_id, 'confirmed', a.id, `${req.user.first_name} took the open spot in ${a.title}`);
        }
        break;
      case 'pass':
        if (p?.status !== 'offered') fail(400, 'This offer is no longer open');
        await c.q(`update participations set status = 'declined', updated_at = now() where id = $1`, [p.id]);
        await offerNext(c, a);
        break;
      case 'drop': {
        if (p?.status !== 'confirmed') fail(400, "You're not confirmed for this");
        if (new Date(a.starts_at) <= new Date()) fail(400, 'This activity has already started');
        await c.q(`update participations set status = 'dropped', updated_at = now() where id = $1`, [p.id]);
        if (!p.needs_reconfirm && isLate(a)) {
          await c.q('update users set late_cancel_count = late_cancel_count + 1 where id = $1', [req.user.id]);
        }
        await notify(c, a.host_id, 'dropped', a.id, `${req.user.first_name} dropped out of ${a.title}`);
        await offerNext(c, a);
        break;
      }
      case 'reconfirm':
        if (p?.status !== 'confirmed' || !p.needs_reconfirm) fail(400, 'Nothing to re-confirm');
        await c.q(`update participations set needs_reconfirm = false, updated_at = now() where id = $1`, [p.id]);
        break;
    }
    return { a };
  });
  res.json({ message: a.msg || null, activity: await activityView(a.a, req.user, { withPeople: true }) });
});

// The guest's check-in QR code (encodes their check-in code).
router.get('/activities/:id/qr.svg', async (req, res) => {
  const p = await one(`select checkin_code from participations where activity_id = $1 and user_id = $2 and status in ('confirmed','attended')`,
    [req.params.id, req.user.id]);
  if (!p) fail(404, 'No check-in code');
  res.type('image/svg+xml').send(await QRCode.toString(p.checkin_code, { type: 'svg', margin: 1 }));
});

// ---- chat --------------------------------------------------------------------------------

async function chatAllowed(user, activityId) {
  const a = await one('select * from activities where id = $1', [activityId]);
  if (!a) fail(404, 'Not found');
  if (a.host_id === user.id) return a;
  const p = await one('select status from participations where activity_id = $1 and user_id = $2', [activityId, user.id]);
  if (!CHAT_OK.includes(p?.status)) fail(403, 'Chat opens once you are invited');
  return a;
}

router.get('/activities/:id/messages', async (req, res) => {
  await chatAllowed(req.user, req.params.id);
  const rows = await all(
    `select m.id, m.body, m.created_at, m.sender_id, u.first_name, u.photo_path
       from messages m join users u on u.id = m.sender_id
      where m.activity_id = $1 order by m.created_at limit 500`, [req.params.id]);
  res.json({
    messages: rows.map((m) => ({
      id: m.id, body: m.body, at: m.created_at, mine: m.sender_id === req.user.id,
      from: m.first_name, photo: photoUrl(m),
    })),
  });
});

router.post('/activities/:id/messages', async (req, res) => {
  const a = await chatAllowed(req.user, req.params.id);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) fail(400, 'Message is empty');
  await q('insert into messages (activity_id, sender_id, body) values ($1, $2, $3)', [a.id, req.user.id, body]);
  res.status(201).json({ ok: true });
});

// ---- mail ------------------------------------------------------------------------------------

router.get('/mail', async (req, res) => {
  await runJobs();
  const rows = await all(
    `select n.*, p.status as part_status, p.offer_expires_at, p.invite_expires_at
       from notifications n
       left join participations p on p.activity_id = n.activity_id and p.user_id = n.user_id
      where n.user_id = $1 order by n.created_at desc limit 100`, [req.user.id]);
  res.json({
    mail: rows.map((n) => ({
      id: n.id, kind: n.kind, activityId: n.activity_id, title: n.title, body: n.body, at: n.created_at,
      unread: !n.read_at,
      // Live state so an invite or offer card shows whether it can still be acted on.
      open: (n.kind === 'invite' && n.part_status === 'invited') || (n.kind === 'offer' && n.part_status === 'offered'),
      expiresAt: n.kind === 'offer' ? n.offer_expires_at : n.kind === 'invite' ? n.invite_expires_at : null,
    })),
  });
});

router.get('/mail/unread', async (req, res) => {
  res.json({ count: (await one('select count(*)::int n from notifications where user_id = $1 and read_at is null', [req.user.id])).n });
});

router.post('/mail/read', async (req, res) => {
  await q('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ ok: true });
});
