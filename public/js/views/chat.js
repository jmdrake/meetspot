import { api, html, render, icon, ago, toast } from '../lib.js';

export async function chat(el, ctx) {
  const id = ctx.params[0];
  const { activity: a } = await api(`/activities/${id}`);
  render(el, html`
    <header class="hdr"><div class="hdr-row">
      <a class="icon-btn plain" href="/a/${id}" aria-label="Back">${icon('back')}</a>
      <div style="text-align:center;min-width:0"><h1 class="small">${a.title}</h1><div class="sub">Group chat</div></div>
      <span style="width:44px"></span></div></header>
    <main class="no-nav"><div class="msgs" id="msgs"></div></main>
    <form class="composer" id="f"><input name="body" placeholder="Message" autocomplete="off" maxlength="2000" aria-label="Message">
      <button class="btn small">Send</button></form>`);

  const box = el.querySelector('#msgs');
  let count = -1;
  const load = async () => {
    const { messages } = await api(`/activities/${id}/messages`);
    if (messages.length === count) return;
    count = messages.length;
    render(box, messages.length ? html`${messages.map((m) => html`<div class="msg ${m.mine ? 'mine' : ''}">
        ${m.mine ? '' : html`<div class="from">${m.from}</div>`}${m.body}<div class="hint" style="padding:2px 0 0;font-size:10px">${ago(m.at)}</div></div>`)}`
      : html`<div class="empty">No messages yet. Say hi!</div>`);
    window.scrollTo(0, document.body.scrollHeight);
  };
  await load();
  const f = el.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = f.body.value.trim();
    if (!body) return;
    f.body.value = '';
    try { await api(`/activities/${id}/messages`, { method: 'POST', body: { body } }); await load(); }
    catch (err) { toast(err.message); f.body.value = body; }
  };
  const timer = setInterval(() => { if (!ctx.isCurrent()) return clearInterval(timer); load().catch(() => {}); }, 5000);
}
