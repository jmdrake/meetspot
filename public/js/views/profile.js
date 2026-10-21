import { api, html, render, toast, icon, avatar, INTENT_LABEL } from '../lib.js';

export async function profile(el, ctx) {
  const me = ctx.me;
  const setup = !me.complete;
  const intents = new Set(me.intents || []);
  let photo = me.photo;

  const draw = () => render(el, html`
    <header class="hdr">
      <div class="hdr-row">
        ${setup ? html`<span style="width:44px"></span>` : html`<a class="icon-btn plain" href="/activities" aria-label="Back">${icon('back')}</a>`}
        <h1 class="small">${setup ? 'Set up your profile' : 'Your profile'}</h1>
        <span style="width:44px"></span>
      </div>
    </header>
    <main class="no-nav">
      ${setup ? html`<div class="notice info">Hosts see your photo and a short profile when you ask to join. Your name stays hidden until they invite you.</div>` : ''}
      <form id="f" class="stack" style="gap:14px">
        <div class="row" style="gap:14px">
          ${photo ? html`<img class="avatar lg" src="${photo}" alt="Your photo">` : html`<span class="avatar lg" aria-hidden="true">${icon('user', 30)}</span>`}
          <label class="btn ghost small" style="cursor:pointer">${photo ? 'Change photo' : 'Add a photo'}
            <input type="file" accept="image/*" id="photo" class="sr"></label>
        </div>
        <label class="field"><span>First name</span><input name="firstName" required maxlength="40" value="${me.firstName || ''}" autocomplete="given-name"></label>
        <div class="grid2">
          <label class="field"><span>Birth date</span><input type="date" name="birthDate" required value="${me.birthDate || ''}"></label>
          <label class="field"><span>Gender</span>
            <select name="gender" required>
              <option value="">Choose</option>
              <option value="F" ${me.gender === 'F' ? 'selected' : ''}>Woman</option>
              <option value="M" ${me.gender === 'M' ? 'selected' : ''}>Man</option>
              <option value="X" ${me.gender === 'X' ? 'selected' : ''}>Nonbinary</option>
            </select></label>
        </div>
        <p class="hint" style="margin-top:-6px">Others see only your age range (like "30s") and gender until a host invites you.</p>
        <div class="field"><span>I'm here for</span>
          <div class="choices">${Object.entries(INTENT_LABEL).map(([k, v]) => html`
            <button type="button" class="choice" data-intent="${k}" aria-pressed="${intents.has(k)}">${v}</button>`)}</div></div>
        <label class="field"><span>About me (optional)</span><textarea name="bio" maxlength="500" placeholder="A line or two about you">${me.bio || ''}</textarea></label>
        <label class="field"><span>Interests (optional, comma separated)</span><input name="interests" value="${(me.interests || []).join(', ')}" placeholder="hiking, trivia, live music"></label>
        <p class="err" id="err"></p>
        <button class="btn block">${setup ? 'Start exploring' : 'Save'}</button>
      </form>
      ${setup ? '' : html`
        <a class="btn ghost block" href="/invite">${icon('link', 18)} Invite friends</a>
        <button class="btn ghost block" id="signout">Sign out</button>`}
    </main>`);

  draw();
  const wire = () => {
    el.querySelectorAll('[data-intent]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.intent;
        intents.has(k) ? intents.delete(k) : intents.add(k);
        b.setAttribute('aria-pressed', intents.has(k));
      };
    });
    el.querySelector('#photo').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('photo', file);
      try {
        const r = await api('/me/photo', { method: 'POST', form });
        photo = r.user.photo;
        const keep = new FormData(el.querySelector('#f'));
        draw(); wire();
        for (const [k, v] of keep) { const f = el.querySelector(`[name="${k}"]`); if (f) f.value = v; }
      } catch (err) { toast(err.message); }
    };
    el.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const err = el.querySelector('#err');
      if (!photo) { err.textContent = 'Add a photo. Hosts see it when you ask to join.'; return; }
      try {
        await api('/me', {
          method: 'PUT',
          body: {
            firstName: f.get('firstName'), birthDate: f.get('birthDate'), gender: f.get('gender'),
            intents: [...intents], bio: f.get('bio'),
            interests: String(f.get('interests') || '').split(',').map((s) => s.trim()).filter(Boolean),
          },
        });
        await ctx.reloadMe();
        toast(setup ? 'Welcome to MeetSpot!' : 'Saved');
        ctx.go('/activities', setup);
      } catch (e2) { err.textContent = e2.message; }
    };
    const so = el.querySelector('#signout');
    if (so) so.onclick = async () => { await api('/auth/signout', { method: 'POST' }); location.href = '/signin'; };
  };
  wire();
}
