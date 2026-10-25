import express from 'express';
import { all, q } from './db.js';
import { fail } from './util.js';
import { requireUser } from './auth.js';
import { AGREEMENTS, KINDS } from './agreements.js';

export const router = express.Router();

// Cards of an agreement the member has not initialed at their current version.
export async function pendingCards(userId, kind) {
  const done = await all(
    'select card_id, card_version from agreement_acceptances where user_id = $1 and agreement = $2', [userId, kind]);
  const have = new Set(done.map((r) => `${r.card_id}@${r.card_version}`));
  return AGREEMENTS[kind].cards.filter((c) => !have.has(`${c.id}@${c.version}`));
}

export async function agreementStatus(userId) {
  const out = {};
  for (const k of KINDS) out[k] = (await pendingCards(userId, k)).length === 0;
  return out;
}

// Middleware: the member must have initialed every current card of `kind`.
export const requireAgreement = (kind) => async (req, _res, next) => {
  try {
    if ((await pendingCards(req.user.id, kind)).length) {
      const e = new Error(kind === 'host'
        ? 'Please read and initial the host agreement before hosting.'
        : 'Please read and initial the member agreement first.');
      e.status = 403;
      e.code = `agreement_${kind}`;
      return next(e);
    }
    next();
  } catch (e) { next(e); }
};

router.get('/agreements/:kind', requireUser, async (req, res) => {
  const a = AGREEMENTS[req.params.kind];
  if (!a) fail(404, 'Unknown agreement');
  const rows = await all(
    `select card_id, card_version, initials, accepted_at from agreement_acceptances
      where user_id = $1 and agreement = $2 order by accepted_at`, [req.user.id, req.params.kind]);
  const pending = new Set((await pendingCards(req.user.id, req.params.kind)).map((c) => c.id));
  const firstTime = rows.length === 0;
  res.json({
    kind: req.params.kind,
    title: a.title,
    intro: a.intro,
    firstTime,
    cards: a.cards.map((c) => {
      const latest = rows.filter((r) => r.card_id === c.id).at(-1);
      return {
        id: c.id, version: c.version, title: c.title, rule: c.rule, why: c.why, terms: c.terms,
        check: c.check ? { question: c.check.question, options: c.check.options, answer: c.check.answer, explain: c.check.explain } : null,
        pending: pending.has(c.id),
        // An older version initialed before: this card changed and needs new initials.
        updated: pending.has(c.id) && !!latest,
        acceptedAt: !pending.has(c.id) ? latest?.accepted_at : null,
        initials: !pending.has(c.id) ? latest?.initials : null,
      };
    }),
  });
});

router.post('/agreements/:kind/:cardId', requireUser, async (req, res) => {
  const a = AGREEMENTS[req.params.kind];
  const card = a?.cards.find((c) => c.id === req.params.cardId);
  if (!card) fail(404, 'Unknown card');
  if (Number(req.body.version) !== card.version) fail(409, 'This card was just updated. Please read the new version.');
  const initials = String(req.body.initials || '').trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(initials)) fail(400, 'Type your initials: 2 to 4 letters');
  let checkPassed = null;
  if (card.check) {
    if (Number(req.body.checkAnswer) !== card.check.answer) fail(400, 'Answer the question on this card first');
    checkPassed = true;
  }
  await q(
    `insert into agreement_acceptances (user_id, agreement, card_id, card_version, initials, check_passed, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, agreement, card_id, card_version) do nothing`,
    [req.user.id, req.params.kind, card.id, card.version, initials, checkPassed, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]);
  const remaining = await pendingCards(req.user.id, req.params.kind);
  res.json({ ok: true, remaining: remaining.length });
});
