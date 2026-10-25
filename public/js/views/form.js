import { api, html, render, icon, toast, toLocalInput, INTENT_LABEL, COST } from '../lib.js';

export async function activityForm(el, ctx) {
  const id = ctx.params[0];
  const editing = !!id;
  const a = editing ? (await api(`/activities/${id}`)).activity : null;
  if (editing && !a.isHost) throw new Error('Only the host can edit this activity');

  // Sensible defaults for a new plan: tomorrow at 7 PM for two hours.
  const start = a ? new Date(a.startsAt) : (() => { const d = new Date(Date.now() + 864e5); d.setHours(19, 0, 0, 0); return d; })();
  const end = a ? new Date(a.endsAt) : new Date(start.getTime() + 2 * 3600e3);
  const intents = new Set(a?.audience.intents || []);
  const genders = new Set(a?.audience.genders || []);

  render(el, html`
    <header class="hdr"><div class="hdr-row">
      <a class="text-btn" href="${editing ? `/a/${id}` : '/activities'}">Cancel</a>
      <h1 class="small">${editing ? 'Edit activity' : 'New activity'}</h1>
      <span style="min-width:64px"></span></div></header>
    <main class="no-nav">
      ${editing && a.confirmed ? html`<div class="notice warn">${a.confirmed} ${a.confirmed === 1 ? 'person is' : 'people are'} confirmed. Changing the time, place or cost asks them to re-confirm, and they can drop out with no penalty.</div>` : ''}
      <form id="f" class="stack" style="gap:14px">
        <label class="field"><span>What’s the plan?</span><input name="title" required maxlength="80" value="${a?.title || ''}" placeholder="Trivia night, sunrise hike, extra concert ticket…"></label>
        <label class="field"><span>Details (optional)</span><textarea name="description" maxlength="1000" placeholder="What to expect, what to bring">${a?.description || ''}</textarea></label>
        <label class="field"><span>Place</span><input name="placeName" required maxlength="120" value="${a?.placeName || ''}" placeholder="Restaurant, bar, park, theater…"></label>
        <p class="hint" style="margin-top:-6px">${icon('shield', 14)} Public places only, such as a restaurant, bar, park, theater or café. No activities at homes.</p>
        <div class="grid2">
          <label class="field"><span>Address</span><input name="address" maxlength="200" value="${a?.address || ''}" placeholder="Street address"></label>
          <label class="field"><span>Neighborhood</span><input name="neighborhood" maxlength="80" value="${a?.neighborhood || ''}" placeholder="East Nashville"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Starts</span><input type="datetime-local" name="startsAt" required value="${toLocalInput(start)}"></label>
          <label class="field"><span>Ends</span><input type="datetime-local" name="endsAt" required value="${toLocalInput(end)}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Spots (not counting you)</span><input type="number" name="spots" min="1" max="100" required value="${a?.spots || 1}"></label>
          <label class="field"><span>Cost</span><select name="costType">
            ${Object.entries(COST).map(([k, v]) => html`<option value="${k}" ${(a?.costType || 'free') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        </div>
        <label class="field" id="price" ${a?.costType === 'ticket' ? '' : 'hidden'}><span>Ticket price ($)</span>
          <input type="number" name="price" min="1" step="0.01" value="${a?.priceCents ? (a.priceCents / 100).toFixed(2) : ''}">
          <span class="hint">Recorded for now. Payments come in a later version.</span></label>

        <div class="field"><span>Who’s it for?</span>
          <div class="choices">${Object.entries(INTENT_LABEL).map(([k, v]) => html`<button type="button" class="choice" data-intent="${k}" aria-pressed="${intents.has(k)}">${v}</button>`)}</div>
          <span class="hint">Leave all off for anyone.</span></div>
        <div class="field"><span>Open to</span>
          <div class="choices">${[['F', 'Women'], ['M', 'Men'], ['X', 'Nonbinary']].map(([k, v]) => html`<button type="button" class="choice" data-gender="${k}" aria-pressed="${genders.has(k)}">${v}</button>`)}</div>
          <span class="hint">Leave all off for everyone.</span></div>
        <div class="grid2">
          <label class="field"><span>Age from</span><input type="number" name="ageMin" min="18" max="99" value="${a?.audience.ageMin ?? 18}"></label>
          <label class="field"><span>Age to</span><input type="number" name="ageMax" min="18" max="99" value="${a?.audience.ageMax ?? 99}"></label>
        </div>

        <div class="toggles">
          <label class="toggle"><span>I review requests first<small>Off: first come, first served</small></span>
            <input type="checkbox" class="switch" name="review" ${!a || a.inviteStyle === 'review' ? 'checked' : ''}></label>
          <label class="toggle"><span>Auto-fill from waitlist<small>Off: you pick who gets an open spot</small></span>
            <input type="checkbox" class="switch" name="autoFill" ${!a || a.autoFill ? 'checked' : ''}></label>
          <label class="toggle"><span>Show on my friends’ pages<small>Friends arrive in a later update</small></span>
            <input type="checkbox" class="switch" name="showToFriends" ${!a || a.showToFriends ? 'checked' : ''}></label>
        </div>
        <p class="err" id="err"></p>
        <button class="btn block">${editing ? 'Save changes' : 'Post activity'}</button>
      </form>
    </main>`);

  const f = el.querySelector('#f');
  const E = f.elements;
  E.costType.onchange = () => { el.querySelector('#price').hidden = E.costType.value !== 'ticket'; };
  el.querySelectorAll('[data-intent]').forEach((b) => { b.onclick = () => { const k = b.dataset.intent; intents.has(k) ? intents.delete(k) : intents.add(k); b.setAttribute('aria-pressed', intents.has(k)); }; });
  el.querySelectorAll('[data-gender]').forEach((b) => { b.onclick = () => { const k = b.dataset.gender; genders.has(k) ? genders.delete(k) : genders.add(k); b.setAttribute('aria-pressed', genders.has(k)); }; });

  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      title: E.title.value, description: E.description.value, placeName: E.placeName.value,
      address: E.address.value, neighborhood: E.neighborhood.value, isPrivateHome: false,
      startsAt: new Date(E.startsAt.value).toISOString(), endsAt: new Date(E.endsAt.value).toISOString(),
      spots: Number(E.spots.value), costType: E.costType.value,
      priceCents: E.costType.value === 'ticket' ? Math.round(Number(E.price.value) * 100) : null,
      audience: { intents: [...intents], genders: [...genders], ageMin: Number(E.ageMin.value), ageMax: Number(E.ageMax.value) },
      inviteStyle: E.review.checked ? 'review' : 'first_come', autoFill: E.autoFill.checked, showToFriends: E.showToFriends.checked,
    };
    const btn = f.querySelector('.btn');
    btn.disabled = true;
    try {
      const r = editing
        ? await api(`/activities/${id}`, { method: 'PUT', body })
        : await api('/activities', { method: 'POST', body });
      toast(editing ? 'Saved' : 'Posted! Requests will show up in Mail.');
      ctx.go(`/a/${r.activity.id}`, true);
    } catch (err) {
      el.querySelector('#err').textContent = err.message;
      btn.disabled = false;
    }
  };
}
