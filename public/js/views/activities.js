import { api, html, render, icon, dow, dayNum, time, capacity, cost } from '../lib.js';

const VIEWS = [
  ['discover', 'Discover', 'Matched to your profile · upcoming'],
  ['requested', 'Requested', "Waiting on hosts. You'll see who they are once they invite you."],
  ['confirmed', 'Confirmed', "You're going or hosting. Chat is open."],
  ['past', 'Past', 'Activities that are over or canceled.'],
];

export function statusChip(a) {
  if (a.status === 'canceled') return html`<span class="chip bad">Canceled</span>`;
  if (a.isHost) return html`<span class="chip host">Hosting</span>`;
  const s = a.me?.status;
  if (a.status === 'happening' && ['confirmed', 'attended'].includes(s)) return html`<span class="chip live">Happening</span>`;
  const map = {
    requested: ['pending', 'Pending'], waitlisted: ['wait', 'Waitlist'], invited: ['invited', 'Invited'],
    offered: ['invited', 'Spot open'], confirmed: ['going', 'Going'], attended: ['going', 'Attended'],
    no_show: ['bad', 'No-show'], filled: ['wait', 'Filled'], expired: ['wait', 'Expired'],
  };
  const m = map[s];
  return m ? html`<span class="chip ${m[0]}">${m[1]}</span>` : '';
}

export function activityRow(a) {
  const who = a.isHost ? 'You' : a.host.firstName ? a.host.firstName : a.host.label;
  return html`
    <a class="card act" href="/a/${a.id}">
      <div class="datebox"><span class="dow">${dow(a.startsAt)}</span><span class="day">${dayNum(a.startsAt)}</span><span class="time">${time(a.startsAt)}</span></div>
      <div class="act-body">
        <div class="row" style="gap:8px;flex-wrap:wrap"><h2 class="act-title">${a.title}</h2>${statusChip(a)}</div>
        <div class="meta"><strong>${who}</strong><span aria-hidden="true">·</span><span>${a.isPrivateHome && !a.address ? a.neighborhood : a.placeName}</span></div>
        <div class="pills">
          <span class="pill">${icon('person', 12)} ${capacity(a)}</span>
          <span class="pill">${cost(a)}</span>
          ${a.waitlisted && (a.isHost || a.status === 'full') ? html`<span class="pill">${a.waitlisted} waiting</span>` : ''}
        </div>
      </div>
      <span class="chev">${icon('chev', 18)}</span>
    </a>`;
}

export async function activities(el, ctx) {
  const view = VIEWS.some(([k]) => k === ctx.query.get('view')) ? ctx.query.get('view') : 'discover';
  const [, , caption] = VIEWS.find(([k]) => k === view);

  render(el, html`
    <header class="hdr">
      <div class="hdr-row">
        <a class="icon-btn" href="/profile" aria-label="Your profile">${ctx.me.photo ? html`<img src="${ctx.me.photo}" alt="" style="width:42px;height:42px;border-radius:21px;object-fit:cover">` : icon('user')}</a>
        <div style="text-align:center"><h1 style="font-size:24px">MeetSpot</h1><div class="sub">${ctx.me.homeCity}</div></div>
        <a class="icon-btn solid" href="/new" aria-label="Create an activity">${icon('plus')}</a>
      </div>
      <div class="seg" role="tablist" aria-label="Activity views">
        ${VIEWS.map(([k, label]) => html`<button role="tab" data-view="${k}" aria-selected="${k === view}">${label}</button>`)}
      </div>
    </header>
    <main>
      <div class="caption">${caption}</div>
      <div id="list" class="stack"><div class="empty">Loading…</div></div>
    </main>`);
  el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => ctx.go(`/activities?view=${b.dataset.view}`, true); });

  const { activities: list } = await api(`/activities?view=${view}`);
  if (!ctx.isCurrent()) return;
  const box = el.querySelector('#list');
  if (!list.length) {
    const empty = {
      discover: html`<p>Nothing matches your profile yet.</p><p class="hint">Be the first: post a plan and see who wants to come.</p><a class="btn" href="/new">${icon('plus', 18)} Create an activity</a>`,
      requested: html`<p>No pending requests.</p><a class="btn ghost" href="/activities?view=discover">Browse Discover</a>`,
      confirmed: html`<p>Nothing on your calendar yet.</p><a class="btn ghost" href="/activities?view=discover">Browse Discover</a>`,
      past: html`<p>Your past activities will show up here.</p>`,
    }[view];
    render(box, html`<div class="empty">${empty}</div>`);
    return;
  }
  render(box, html`${list.map(activityRow)}`);
}
