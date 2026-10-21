import { api, html, render, toast } from '../lib.js';

let supabasePromise;
function supabase(config) {
  if (!config.supabaseUrl) return null;
  supabasePromise ||= import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
    .then(({ createClient }) => createClient(config.supabaseUrl, config.supabaseAnonKey));
  return supabasePromise;
}

export async function signIn(el, ctx) {
  if (ctx.me) return ctx.go('/activities', true);
  const invite = localStorage.getItem('ms_invite');
  let inviter = null;
  if (invite) inviter = (await api(`/auth/invite/${invite}`).catch(() => ({}))).inviter;
  let email = '';

  const step1 = () => {
    render(el, html`
      <div class="welcome">
        <div class="stack" style="gap:8px">
          <h1>MeetSpot</h1>
          <p class="tag">See where people like you are going.</p>
        </div>
        ${invite ? html`<div class="notice good">${inviter ? `${inviter} invited you to the MeetSpot test group.` : 'You have an invite to the MeetSpot test group.'}</div>` : ''}
        <form class="panel" id="f">
          ${ctx.config.supabaseUrl ? html`
            <button type="button" class="oauth" data-provider="google">Continue with Google</button>
            <button type="button" class="oauth" data-provider="apple">Continue with Apple</button>
            <div class="divider">or use email</div>` : ''}
          <label class="field"><span>Email</span>
            <input type="email" name="email" autocomplete="email" required placeholder="you@example.com" value="${email}"></label>
          <p class="err" id="err"></p>
          <button class="btn block">Email me a code</button>
          <p class="hint">No password. We email you a 6-digit code each time you sign in on a new device.</p>
        </form>
      </div>`);
    el.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      email = e.target.email.value.trim();
      const btn = e.target.querySelector('.btn');
      btn.disabled = true;
      try {
        const r = await api('/auth/start', { method: 'POST', body: { email, invite } });
        step2(r.devCode);
      } catch (err) {
        el.querySelector('#err').textContent = err.message;
        btn.disabled = false;
      }
    };
    el.querySelectorAll('[data-provider]').forEach((b) => {
      b.onclick = async () => {
        const sb = await supabase(ctx.config);
        await sb.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: `${location.origin}/auth/callback` } });
      };
    });
  };

  const step2 = (devCode) => {
    render(el, html`
      <div class="welcome">
        <h1 style="font-size:30px">Check your email</h1>
        <p class="tag">We sent a 6-digit code to <strong>${email}</strong>. It expires in 10 minutes.</p>
        ${devCode ? html`<div class="notice warn">Test mode: your code is <strong>${devCode}</strong></div>` : ''}
        <form class="panel" id="f">
          <label class="field"><span>Code</span>
            <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
          <p class="err" id="err"></p>
          <button class="btn block">Sign in</button>
          <button type="button" class="btn ghost block" id="back">Use a different email</button>
        </form>
      </div>`);
    const input = el.querySelector('input');
    input.focus();
    el.querySelector('#back').onclick = step1;
    el.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/auth/verify', { method: 'POST', body: { email, code: input.value, invite } });
        localStorage.removeItem('ms_invite');
        const me = await ctx.reloadMe();
        ctx.go(me.complete ? '/activities' : '/profile', true);
      } catch (err) {
        el.querySelector('#err').textContent = err.message;
        input.select();
      }
    };
  };
  step1();
}

// Supabase sends Google/Apple sign-ins back here; trade the token for a MeetSpot session.
export async function authCallback(el, ctx) {
  render(el, html`<div class="welcome"><p class="tag">Signing you in…</p></div>`);
  try {
    const sb = await supabase(ctx.config);
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('Sign-in was canceled');
    await api('/auth/supabase', { method: 'POST', body: { access_token: data.session.access_token, invite: localStorage.getItem('ms_invite') } });
    await sb.auth.signOut();
    localStorage.removeItem('ms_invite');
    const me = await ctx.reloadMe();
    ctx.go(me.complete ? '/activities' : '/profile', true);
  } catch (err) {
    toast(err.message);
    ctx.go('/signin', true);
  }
}
