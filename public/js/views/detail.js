import { api, html, render, icon, avatar, toast, when, time, cost, left, INTENT_LABEL } from '../lib.js';
import { statusChip } from './activities.js';

const HOUR = 3600e3;

export async function detail(el, ctx) {
  const id = ctx.params[0];
  let a = (await api(`/activities/${id}`)).activity;

  const act = async (path, body) => {
    try {
      const r = await api(path, { method: 'POST', body });
      if (r.message) toast(r.message);
      if (r.activity) a = r.activity;
      draw();
      ctx.refreshUnread();
      return r;
    } catch (e) { toast(e.message); }
  };

  const draw = () => {
    render(el, html`
      <div class="hero">
        <div class="hdr-row">
          <a class="icon-btn" href="/activities${a.isHost || a.me ? '?view=' + (a.status === 'past' || a.status === 'canceled' ? 'past' : a.isHost || ['confirmed', 'attended'].includes(a.me?.status) ? 'confirmed' : 'requested') : ''}" aria-label="Back">${icon('back')}</a>
          ${statusChip(a)}
        </div>
        <div class="stack" style="gap:4px">
          <h1>${a.title}</h1>
          <div class="sub">${when(a)} – ${time(a.endsAt)}</div>
          <div class="sub">${icon('pin', 14)} ${a.placeName}${a.address ? ` · ${a.address}` : ''}${a.neighborhood && !a.address ? ` · ${a.neighborhood}` : ''}</div>
        </div>
      </div>
      <main>
        <div class="facts">
          <div class="fact"><b>${a.confirmed}/${a.spots}</b><span>going</span></div>
          <div class="fact"><b>${a.spotsLeft}</b><span>spots left</span></div>
          <div class="fact"><b style="font-size:14px;line-height:1.6">${cost(a)}</b><span>cost</span></div>
        </div>
        ${a.status === 'canceled' ? html`<div class="notice bad">This activity was canceled.${a.cancelNote ? html` “${a.cancelNote}”` : ''}</div>` : ''}
        ${a.isHost ? hostPanel(a) : guestPanel(a)}
        ${hostCard(a)}
        ${a.description ? html`<section class="card pad"><div class="label" style="padding:0 0 6px">About</div><div style="white-space:pre-line">${a.description}</div></section>` : ''}
        ${a.isPrivateHome && !a.address ? html`<p class="hint">${icon('shield', 14)} Private home: the address is shared with confirmed guests only.</p>` : ''}
        ${a.going?.length ? html`<section class="stack"><h2 class="section-title">Also going</h2>
          <div class="card">${a.going.map((p) => html`<div class="person">${avatar(p)}<div class="grow"><div class="name">${p.firstName}, ${p.age}</div><div class="bio">${p.bio || ''}</div></div></div>`)}</div></section>` : ''}
        ${a.isHost ? peopleLists(a) : ''}
        <p class="hint">Audience: ${audienceText(a)} · ${a.inviteStyle === 'first_come' ? 'first come, first served' : 'host reviews requests'}</p>
      </main>`);
    wire();
  };

  const wire = () => {
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const action = b.dataset.act;
        if (action === 'drop') return dropSheet();
        if (action === 'cancel') return cancelSheet();
        act(`/activities/${a.id}/${action}`);
      };
    });
    el.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = () => act(`/participations/${b.dataset.p}/${b.dataset.do}`);
    });
  };

  // ---- guest side ----
  function guestPanel(a) {
    const s = a.me?.status;
    const closed = a.status === 'canceled' || a.status === 'past';
    if (closed && !['attended', 'no_show', 'confirmed'].includes(s)) return '';
    if (!s) {
      if (a.status === 'happening') return html`<div class="notice info">This activity has started.</div>`;
      const label = a.status === 'full' ? 'Join the waitlist' : a.inviteStyle === 'first_come' ? 'Join' : 'Ask to join';
      return html`<section class="card pad stack">
        <button class="btn block" data-act="request">${label}</button>
        <p class="hint">${a.inviteStyle === 'first_come' && a.status !== 'full'
          ? 'First come, first served: you’re in right away and the host’s name is revealed.'
          : 'The host sees your photo and profile. Your name stays private until they invite you.'}</p></section>`;
    }
    const panels = {
      requested: html`<section class="card pad stack"><div class="row"><span class="chip pending">Pending</span><span class="grow">Request sent. You’ll get Mail if the host invites you.</span></div>
        <button class="btn ghost small" data-act="withdraw">Withdraw request</button></section>`,
      waitlisted: html`<section class="card pad stack"><div class="row"><span class="chip wait">Waitlist</span><span class="grow">It’s full. If a spot opens you may get an offer with a short time to claim it.</span></div>
        <button class="btn ghost small" data-act="withdraw">Leave the waitlist</button></section>`,
      invited: html`<section class="card pad stack" style="border-color:var(--accent)">
        <strong>${a.host.firstName} invited you</strong>
        <span class="hint">Expires in <span class="countdown" data-until="${a.me.inviteExpiresAt}">${left(a.me.inviteExpiresAt)}</span>. Declining is private.</span>
        <div class="btn-row"><button class="btn" data-act="accept">Accept</button><button class="btn ghost" data-act="decline">Decline</button></div></section>`,
      offered: html`<section class="card pad stack" style="border-color:var(--info)">
        <strong>A spot opened up for you</strong>
        <span class="hint">You were first on the waitlist. Claim within <span class="countdown" data-until="${a.me.offerExpiresAt}">${left(a.me.offerExpiresAt)}</span> or it passes to the next person.</span>
        <div class="btn-row"><button class="btn" data-act="claim">Claim spot</button><button class="btn ghost" data-act="pass">Pass</button></div></section>`,
      confirmed: confirmedPanel(a),
      attended: html`<div class="notice good">${icon('check', 18)} You checked in. Photos from this activity come in a later update.</div>`,
      no_show: html`<div class="notice warn">You were marked as a no-show.</div>`,
      filled: html`<div class="notice info">The last spot was taken before you accepted.</div>`,
      expired: html`<div class="notice info">This invite or offer expired.</div>`,
      declined: html`<div class="notice info">You’re not going to this one.</div>`,
      dropped: html`<div class="notice info">You dropped out of this activity.</div>`,
      canceled: '',
    };
    return panels[s] ?? '';
  }

  function confirmedPanel(a) {
    return html`
      ${a.me.needsReconfirm ? html`<section class="notice warn stack" style="flex-direction:column">
        <span>The host changed the time, place or cost. Still going?</span>
        <div class="btn-row"><button class="btn small" data-act="reconfirm">Yes, still going</button><button class="btn ghost small" data-act="drop">Drop out, no penalty</button></div></section>` : ''}
      <section class="card pad stack" style="align-items:center;text-align:center">
        <strong>You’re going</strong>
        <img class="qr" src="/api/activities/${a.id}/qr.svg" alt="Check-in QR code">
        <div class="code-big">${a.me.checkinCode}</div>
        <span class="hint">Show this to the host when you arrive.</span>
      </section>
      <a class="btn ghost block" href="/a/${a.id}/chat">${icon('chat', 18)} Group chat</a>
      ${a.status !== 'happening' && !a.me.needsReconfirm ? html`<button class="btn danger-ghost block" data-act="drop">I can’t make it</button>` : ''}`;
  }

  function hostCard(a) {
    if (a.isHost) return '';
    const h = a.host;
    return html`<section class="card">
      <div class="person">${h.firstName ? avatar(h) : html`<span class="avatar" aria-hidden="true">${icon('user')}</span>`}
        <div class="grow">
          <div class="name">${h.firstName ? `Hosted by ${h.firstName}, ${h.age}` : `Hosted by ${h.label}`}</div>
          <div class="hint" style="padding:0">${h.intents.map((i) => INTENT_LABEL[i]).join(' · ')}</div>
          ${h.firstName && h.bio ? html`<div class="bio">${h.bio}</div>` : ''}
          ${!h.firstName ? html`<div class="bio" style="color:var(--muted)">You’ll see who the host is if they invite you.</div>` : ''}
        </div></div></section>`;
  }

  // ---- host side ----
  function hostPanel(a) {
    if (a.status === 'canceled') return '';
    const start = new Date(a.startsAt).getTime();
    const checkinOpen = Date.now() > start - HOUR && Date.now() < new Date(a.endsAt).getTime() + 2 * HOUR;
    const before = Date.now() < start;
    return html`<section class="stack">
      ${checkinOpen ? html`<a class="btn block" href="/a/${a.id}/checkin">${icon('scan', 18)} Check guests in</a>` : ''}
      <div class="btn-row">
        <a class="btn ghost" href="/a/${a.id}/chat">${icon('chat', 18)} Chat</a>
        ${before ? html`<a class="btn ghost" href="/a/${a.id}/edit">Edit</a>` : ''}
      </div>
      ${before ? html`<button class="btn danger-ghost block" data-act="cancel">Cancel this activity</button>` : ''}
    </section>`;
  }

  function peopleLists(a) {
    const by = (...st) => (a.people || []).filter((p) => st.includes(p.status));
    const row = (p, actions) => html`<div class="person" style="border-bottom:1px solid rgba(255,255,255,.06)">
      ${avatar(p.person)}
      <div class="grow">
        <div class="name">${p.person.firstName ? `${p.person.firstName}, ${p.person.age}` : p.person.label}
          ${p.checkedIn ? html`<span class="chip going">Here</span>` : ''}${p.needsReconfirm ? html` <span class="chip pending">Re-confirming</span>` : ''}</div>
        <div class="hint" style="padding:0">${p.person.intents.map((i) => INTENT_LABEL[i]).join(' · ')}</div>
        ${p.person.bio ? html`<div class="bio">${p.person.bio}</div>` : ''}
        ${p.status === 'invited' ? html`<div class="hint" style="padding:0">Invite expires in <span class="countdown" data-until="${p.inviteExpiresAt}">${left(p.inviteExpiresAt)}</span></div>` : ''}
        ${p.status === 'offered' ? html`<div class="hint" style="padding:0">Offered a spot · <span class="countdown" data-until="${p.offerExpiresAt}">${left(p.offerExpiresAt)}</span> left</div>` : ''}
      </div>${actions || ''}</div>`;
    const open = a.status === 'open' || a.status === 'full';
    const canInvite = a.status === 'open';
    const section = (title, list, actions, note) => list.length ? html`<section class="stack">
      <h2 class="section-title">${title} · ${list.length}</h2>${note ? html`<p class="hint">${note}</p>` : ''}
      <div class="card">${list.map((p) => row(p, actions?.(p)))}</div></section>` : '';
    const requests = by('requested');
    return html`
      ${section('Requests', requests, (p) => open ? html`<div class="stack" style="gap:6px">
          ${canInvite ? html`<button class="btn small" data-p="${p.participationId}" data-do="invite">Invite</button>` : ''}
          <button class="btn ghost small" data-p="${p.participationId}" data-do="decline" aria-label="Decline request">No thanks</button></div>` : '',
        'You see their photo and profile. Names appear once you invite. You can invite more people than spots; the first to accept get them.')}
      ${section('Invited', by('invited'))}
      ${section('Going', by('confirmed', 'attended', 'no_show'))}
      ${section('Waitlist', by('waitlisted', 'offered'), (p) => p.status === 'waitlisted' && canInvite && !a.autoFill
        ? html`<button class="btn small" data-p="${p.participationId}" data-do="invite">Invite</button>` : '')}
      ${!a.people?.length && open ? html`<div class="empty" style="padding:20px">No requests yet. They’ll show up here and in your Mail.</div>` : ''}`;
  }

  // ---- sheets ----
  function sheet(content, onMount) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    render(bg, html`<section class="sheet" role="dialog" aria-modal="true">${content}</section>`);
    document.body.append(bg);
    const close = () => bg.remove();
    bg.onclick = (e) => { if (e.target === bg) close(); };
    bg.querySelector('[data-close]')?.addEventListener('click', close);
    onMount(bg, close);
  }

  function dropSheet() {
    const late = new Date(a.startsAt) - Date.now() < 48 * HOUR && !a.me.needsReconfirm;
    sheet(html`<h2>Drop out?</h2>
      <p style="margin:0;color:var(--ink-2)">${a.title} · ${when(a)}</p>
      ${late ? html`<div class="notice warn">It’s less than 48 hours away, so this counts as a late cancellation.</div>`
        : html`<div class="notice good">No penalty. Your spot goes to the next person waiting.</div>`}
      <div class="btn-row"><button class="btn ghost" data-close>Keep my spot</button><button class="btn danger" id="go">Drop out</button></div>`,
    (bg, close) => { bg.querySelector('#go').onclick = async () => { close(); await act(`/activities/${a.id}/drop`); }; });
  }

  function cancelSheet() {
    const going = (a.people || []).filter((p) => ['confirmed'].includes(p.status));
    sheet(html`<h2>Cancel this activity?</h2>
      <p style="margin:0;color:var(--ink-2)">${a.title} · ${when(a)}</p>
      ${going.length ? html`<div class="notice info">${going.length} confirmed ${going.length === 1 ? 'person' : 'people'} and anyone waiting will be notified.</div>`
        : html`<div class="notice good">Nobody is confirmed yet, so it will simply be deleted.</div>`}
      <fieldset style="margin:0;padding:0;border:0" class="stack">
        <legend class="label" style="padding:0 0 8px">Why are you canceling?</legend>
        <label class="radio-card"><input type="radio" name="reason" value="event_canceled"><span><strong>The event itself was canceled</strong><br><small style="color:var(--good)">No reliability impact</small></span></label>
        <label class="radio-card"><input type="radio" name="reason" value="cant_make_it" checked><span><strong>I can’t make it anymore</strong><br><small style="color:var(--warn)">Counts as a late cancellation within 48 hours</small></span></label>
        <label class="radio-card"><input type="radio" name="reason" value="safety"><span><strong>Safety concern</strong><br><small style="color:var(--muted)">Never penalized</small></span></label>
      </fieldset>
      <label class="field"><span>Note to guests (optional)</span><textarea id="note" rows="2" maxlength="500"></textarea></label>
      <div class="btn-row"><button class="btn ghost" data-close>Keep it</button><button class="btn danger" id="go">Cancel activity</button></div>`,
    (bg, close) => {
      bg.querySelector('#go').onclick = async () => {
        const reason = bg.querySelector('input[name=reason]:checked').value;
        try {
          const r = await api(`/activities/${a.id}/cancel`, { method: 'POST', body: { reason, note: bg.querySelector('#note').value } });
          close();
          toast(r.deleted ? 'Activity deleted' : 'Activity canceled. Everyone was notified.');
          ctx.go('/activities?view=confirmed', true);
        } catch (e) { toast(e.message); }
      };
    });
  }

  draw();
  const timer = setInterval(() => {
    if (!ctx.isCurrent()) return clearInterval(timer);
    el.querySelectorAll('.countdown').forEach((c) => { c.textContent = left(c.dataset.until); });
  }, 20000);
}

function audienceText(a) {
  const g = { F: 'women', M: 'men', X: 'nonbinary people' };
  const who = a.audience.genders.length ? a.audience.genders.map((x) => g[x]).join(', ') : 'everyone';
  const why = a.audience.intents.length ? ` · ${a.audience.intents.map((i) => INTENT_LABEL[i]).join(', ')}` : '';
  return `${who}, ${a.audience.ageMin}–${a.audience.ageMax}${why}`;
}

