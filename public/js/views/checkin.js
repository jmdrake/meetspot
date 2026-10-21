import { api, html, render, icon, toast, avatar } from '../lib.js';

// Host check-in: scan a guest's QR code (where the browser supports it), type their code, or tap "Here".
export async function checkin(el, ctx) {
  const id = ctx.params[0];
  let a = (await api(`/activities/${id}`)).activity;
  if (!a.isHost) throw new Error('Only the host can check guests in');
  let stream = null;

  const draw = () => {
    const guests = (a.people || []).filter((p) => ['confirmed', 'attended', 'no_show'].includes(p.status));
    const here = guests.filter((p) => p.checkedIn).length;
    render(el, html`
      <header class="hdr"><div class="hdr-row">
        <a class="icon-btn plain" href="/a/${id}" aria-label="Back">${icon('back')}</a>
        <div style="text-align:center"><h1 class="small">Check-in</h1><div class="sub">${a.title} · ${here} of ${guests.length} here</div></div>
        <span style="width:44px"></span></div></header>
      <main>
        ${'BarcodeDetector' in window ? html`<button class="btn block" id="scan">${icon('scan', 18)} Scan a QR code</button>
          <video id="cam" playsinline muted style="width:100%;border-radius:16px;display:none"></video>` : ''}
        <form id="f" class="row">
          <input class="input code-input grow" name="code" maxlength="6" placeholder="CODE" aria-label="Guest's check-in code" autocapitalize="characters">
          <button class="btn">Check in</button></form>
        <h2 class="section-title">Guests</h2>
        <div class="card">${guests.length ? guests.map((p) => html`<div class="person" style="border-bottom:1px solid rgba(255,255,255,.06)">
          ${avatar(p.person)}<div class="grow"><div class="name">${p.person.firstName}</div></div>
          ${p.checkedIn ? html`<span class="chip going">${icon('check', 12)} Here</span>`
            : html`<button class="btn small ghost" data-p="${p.participationId}">Mark here</button>`}</div>`)
          : html`<div class="empty">No confirmed guests.</div>`}</div>
        <p class="hint">Guests not checked in within 2 hours after the end are marked as no-shows.</p>
      </main>`);
    const f = el.querySelector('#f');
    f.onsubmit = (e) => { e.preventDefault(); submit(f.code.value); f.code.value = ''; };
    el.querySelectorAll('[data-p]').forEach((b) => { b.onclick = async () => {
      try { a = (await api(`/participations/${b.dataset.p}/checkin`, { method: 'POST' })).activity; draw(); } catch (err) { toast(err.message); }
    }; });
    const scanBtn = el.querySelector('#scan');
    if (scanBtn) scanBtn.onclick = scan;
  };

  const submit = async (code) => {
    if (!code) return;
    try {
      const r = await api(`/activities/${id}/checkin`, { method: 'POST', body: { code } });
      a = r.activity;
      toast(r.already ? `${r.checkedIn} was already checked in` : `${r.checkedIn} is checked in`);
      draw();
    } catch (err) { toast(err.message); }
  };

  async function scan() {
    const video = el.querySelector('#cam');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch { return toast('Camera not available. Type the code instead.'); }
    video.srcObject = stream;
    video.style.display = 'block';
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!stream || !ctx.isCurrent()) return stop();
      const codes = await detector.detect(video).catch(() => []);
      if (codes[0]) { stop(); return submit(codes[0].rawValue); }
      requestAnimationFrame(tick);
    };
    tick();
  }
  function stop() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }

  draw();
}
