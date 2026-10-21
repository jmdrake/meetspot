import { api, html, render, icon, ago, left } from '../lib.js';

const ICON = {
  invite: ['mail', 'var(--accent)'], offer: ['clock', 'var(--info)'], request: ['person', 'var(--warn)'],
  confirmed: ['check', 'var(--good)'], joined: ['check', 'var(--good)'], dropped: ['person', 'var(--muted)'],
  reconfirm: ['clock', 'var(--warn)'], canceled: ['calendar', 'var(--bad)'], filled: ['person', 'var(--muted)'],
  spot_open: ['clock', 'var(--info)'],
};

export async function mail(el, ctx) {
  render(el, html`
    <header class="hdr"><div class="hdr-row"><h1>Mail</h1>
      <a class="icon-btn" href="/invite" aria-label="Invite friends">${icon('link', 20)}</a></div></header>
    <main><div id="list" class="stack"><div class="empty">Loading…</div></div></main>`);
  const { mail: items } = await api('/mail');
  if (!ctx.isCurrent()) return;
  const box = el.querySelector('#list');
  if (!items.length) {
    render(box, html`<div class="empty"><p>Invites, waitlist offers and updates about your activities land here.</p></div>`);
  } else {
    const action = items.filter((m) => m.open);
    const rest = items.filter((m) => !m.open);
    const card = (m) => {
      const [ic, color] = ICON[m.kind] || ['mail', 'var(--muted)'];
      const href = m.activityId ? `/a/${m.activityId}` : null;
      const inner = html`
        <span class="avatar" style="background:rgba(255,255,255,.06);color:${color}" aria-hidden="true">${icon(ic, 20)}</span>
        <div class="grow">
          <div class="row" style="justify-content:space-between;gap:8px"><strong style="font-size:14px">${m.title}</strong>
            <span class="hint" style="padding:0;white-space:nowrap">${ago(m.at)}</span></div>
          ${m.body ? html`<div class="bio">${m.body}</div>` : ''}
          ${m.open && m.expiresAt ? html`<div class="countdown" style="font-size:13px;margin-top:4px">${m.kind === 'offer' ? 'Claim within' : 'Expires in'} ${left(m.expiresAt)}</div>` : ''}
        </div>
        ${m.unread ? html`<span style="width:8px;height:8px;border-radius:4px;background:var(--accent);flex-shrink:0" aria-label="Unread"></span>` : ''}`;
      return href
        ? html`<a class="card person" href="${href}" style="text-decoration:none;color:inherit;${m.open ? 'border-color:var(--accent)' : ''}">${inner}</a>`
        : html`<div class="card person">${inner}</div>`;
    };
    render(box, html`
      ${action.length ? html`<h2 class="section-title">Needs your answer</h2>${action.map(card)}` : ''}
      ${rest.length ? html`<h2 class="section-title">${action.length ? 'Earlier' : 'All mail'}</h2>${rest.map(card)}` : ''}`);
  }
  await api('/mail/read', { method: 'POST' });
  ctx.refreshUnread();
}
