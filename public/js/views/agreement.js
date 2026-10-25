import { api, html, render, icon, toast, longDate } from '../lib.js';

// Card-by-card agreement: read the rule, answer the check (if any), type your initials.
export async function agreement(el, ctx) {
  const kind = ctx.params[0];
  const next = ctx.query.get('next');
  const data = await api(`/agreements/${kind}`);
  const queue = data.cards.filter((c) => c.pending);
  const total = queue.length;
  let i = 0;

  const finish = async () => {
    const me = await ctx.reloadMe();
    if (next) return ctx.go(next, true);
    if (kind === 'member') return ctx.go(me.complete ? '/activities' : '/profile', true);
    ctx.go('/new', true);
  };

  if (!total) return finish();

  const intro = () => {
    const updated = !data.firstTime;
    render(el, html`
      <div class="welcome" style="justify-content:flex-start;padding-top:calc(48px + env(safe-area-inset-top))">
        <span class="chip host" style="align-self:flex-start">${icon('shield', 12)}&nbsp;${data.title}</span>
        <h1 style="font-size:32px">${updated ? 'We updated our rules' : kind === 'host' ? 'Before you host' : 'Before you start'}</h1>
        <p class="tag">${updated
          ? `${total} ${total === 1 ? 'card has' : 'cards have'} changed since you last agreed. Please read and initial ${total === 1 ? 'it' : 'them'} to keep going.`
          : data.intro}</p>
        <div class="panel">
          <div class="row"><span class="avatar" style="background:rgba(255,138,102,.15);color:var(--accent)">${icon('check', 20)}</span>
            <span class="grow">One rule per card, in plain English, with the full terms one tap away.</span></div>
          <div class="row"><span class="avatar" style="background:rgba(143,184,255,.15);color:var(--info)">${icon('person', 20)}</span>
            <span class="grow">Type your initials on each card. Some cards ask a quick question first.</span></div>
          <button class="btn block" id="start">Start</button>
          ${ctx.me.agreements?.member ? html`<a class="btn ghost block" href="/activities">Not now</a>` : ''}
        </div>
      </div>`);
    el.querySelector('#start').onclick = () => card();
  };

  const card = () => {
    const c = queue[i];
    let passed = !c.check;
    render(el, html`
      <header class="hdr">
        <div class="hdr-row">
          ${i > 0 ? html`<button class="icon-btn plain" id="prev" aria-label="Previous card">${icon('back')}</button>` : html`<span style="width:44px"></span>`}
          <div style="text-align:center"><h1 class="small">${data.title}</h1><div class="sub">Card ${i + 1} of ${total}</div></div>
          <span style="width:44px"></span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${i}" aria-label="Cards initialed">
          <span style="width:${(i / total) * 100}%"></span></div>
      </header>
      <main class="no-nav">
        <article class="card pad stack agree-card">
          ${c.updated ? html`<span class="chip pending" style="align-self:flex-start">Updated</span>` : ''}
          <h2 class="agree-title">${c.title}</h2>
          <p class="agree-rule">${c.rule}</p>
          <p class="agree-why"><strong>Why:</strong> ${c.why}</p>
          <details class="terms"><summary>Read the full terms</summary><p>${c.terms}</p></details>
        </article>
        ${c.check ? html`<fieldset class="card pad stack check">
          <legend class="sr">Quick check</legend>
          <div class="label" style="padding:0">Quick check</div>
          <strong>${c.check.question}</strong>
          ${c.check.options.map((o, n) => html`<label class="radio-card"><input type="radio" name="q" value="${n}"><span>${o}</span></label>`)}
          <div id="explain" role="status"></div>
        </fieldset>` : ''}
        <form id="f" class="card pad stack">
          <label class="field"><span>Your initials</span>
            <input name="initials" class="code-input" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AB" required></label>
          <p class="hint">By typing your initials you agree to this card.</p>
          <button class="btn block" id="go" disabled>${i === total - 1 ? 'Initial and finish' : 'Initial and continue'}</button>
        </form>
      </main>`);

    const go = el.querySelector('#go');
    const input = el.querySelector('input[name=initials]');
    const ready = () => { go.disabled = !(passed && /^[A-Za-z]{2,4}$/.test(input.value.trim())); };
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, ''); ready(); };
    let answer = null;
    el.querySelectorAll('input[name=q]').forEach((r) => {
      r.onchange = () => {
        answer = Number(r.value);
        passed = answer === c.check.answer;
        render(el.querySelector('#explain'), passed
          ? html`<div class="notice good">${icon('check', 18)} <span>Right. ${c.check.explain}</span></div>`
          : html`<div class="notice warn"><span>Not quite. ${c.check.explain} Try again.</span></div>`);
        ready();
      };
    });
    const prev = el.querySelector('#prev');
    if (prev) prev.onclick = () => { i -= 1; card(); };
    el.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        await api(`/agreements/${kind}/${c.id}`, { method: 'POST', body: { version: c.version, initials: input.value, checkAnswer: answer } });
        i += 1;
        if (i < total) { card(); window.scrollTo(0, 0); } else done();
      } catch (err) {
        toast(err.message);
        if (err.status === 409) return agreement(el, ctx);
        go.disabled = false;
      }
    };
  };

  const done = () => {
    render(el, html`
      <div class="welcome">
        <span class="avatar lg" style="background:rgba(110,210,150,.18);color:var(--good)">${icon('check', 36)}</span>
        <h1 style="font-size:32px">${kind === 'host' ? 'You’re ready to host' : 'Thanks. You’re all set.'}</h1>
        <p class="tag">${kind === 'host'
          ? 'Post your first activity at a public place and see who wants to come.'
          : 'You can review what you agreed to anytime from your profile.'}</p>
        <button class="btn block" id="next">${kind === 'host' ? 'Create an activity' : 'Continue'}</button>
      </div>`);
    el.querySelector('#next').onclick = finish;
  };

  intro();
}

// Read-only review of both agreements, with when each card was initialed.
export async function agreementsReview(el, ctx) {
  const [member, host] = await Promise.all([api('/agreements/member'), api('/agreements/host')]);
  const section = (a) => html`
    <h2 class="section-title">${a.title}</h2>
    <div class="card">${a.cards.map((c) => html`
      <details class="terms review">
        <summary><span class="grow"><strong>${c.title}</strong><br>
          <span class="hint" style="padding:0">${c.pending ? (c.updated ? 'Updated, needs your initials' : 'Not yet initialed')
            : `Initialed ${c.initials} on ${longDate(c.acceptedAt)}`}</span></span></summary>
        <p>${c.rule}</p><p class="hint" style="padding:0">${c.terms}</p>
      </details>`)}</div>
    ${a.cards.some((c) => c.pending) ? html`<a class="btn ghost block" href="/agreement/${a.kind}">Initial the remaining cards</a>` : ''}`;
  render(el, html`
    <header class="hdr"><div class="hdr-row">
      <a class="icon-btn plain" href="/profile" aria-label="Back">${icon('back')}</a>
      <h1 class="small">What you agreed to</h1><span style="width:44px"></span></div></header>
    <main>${section(member)}${section(host)}</main>`);
}
