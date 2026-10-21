import { api, html, render, icon, toast, longDate } from '../lib.js';

export async function invite(el, ctx) {
  const { code, joined } = await api('/me/invites');
  const link = `${location.origin}/join/${code}`;
  render(el, html`
    <header class="hdr"><div class="hdr-row">
      <a class="icon-btn plain" href="/profile" aria-label="Back">${icon('back')}</a>
      <h1 class="small">Invite friends</h1><span style="width:44px"></span></div></header>
    <main>
      <div class="notice info">MeetSpot is invite-only during testing. Everyone who joins through your link is recorded as your referral, and referrals will be honored under the program’s terms when it launches.</div>
      <section class="card pad stack">
        <div class="label" style="padding:0">Your invite link</div>
        <div style="word-break:break-all;font-weight:700">${link}</div>
        <div class="btn-row">
          <button class="btn" id="share">${navigator.share ? 'Share' : 'Copy link'}</button>
          <button class="btn ghost" id="copy">Copy</button>
        </div>
      </section>
      <h2 class="section-title">Joined through you · ${joined.length}</h2>
      <div class="card">${joined.length ? joined.map((j) => html`<div class="person" style="border-bottom:1px solid rgba(255,255,255,.06)">
          <span class="avatar" aria-hidden="true">${j.firstName.slice(0, 1)}</span><div class="grow"><div class="name">${j.firstName}</div>
          <div class="hint" style="padding:0">Joined ${longDate(j.joinedAt)}</div></div></div>`)
        : html`<div class="empty">No one yet. Share your link with people you’d like to meet up with.</div>`}</div>
    </main>`);
  const copy = async () => { await navigator.clipboard.writeText(link); toast('Link copied'); };
  el.querySelector('#copy').onclick = copy;
  el.querySelector('#share').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join me on MeetSpot', text: 'I’m testing MeetSpot. Here’s my invite:', url: link }); } catch { /* dismissed */ }
    } else copy();
  };
}

const SOON = {
  friends: ['Friends', 'friends', 'People you meet at activities become friends here, and you can invite them directly to plans.'],
  venues: ['Venues', 'venues', 'Real-world places and events, with groups forming around them.'],
  moments: ['Moments', 'camera', 'Photos from activities you attended, with faces blurred unless people approve.'],
};

export async function comingSoon(el, ctx) {
  const key = location.pathname.slice(1);
  const [title, ic, text] = SOON[key];
  render(el, html`
    <header class="hdr"><div class="hdr-row"><h1>${title}</h1></div></header>
    <main><div class="empty">${icon(ic, 40)}<p><strong>Coming in the next test build</strong></p><p>${text}</p>
      <a class="btn ghost" href="/activities">Back to Activities</a></div></main>`);
}
