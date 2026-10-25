import { api, html, render, icon } from './lib.js';
import { signIn, authCallback } from './views/auth.js';
import { profile } from './views/profile.js';
import { activities } from './views/activities.js';
import { detail } from './views/detail.js';
import { activityForm } from './views/form.js';
import { chat } from './views/chat.js';
import { checkin } from './views/checkin.js';
import { mail } from './views/mail.js';
import { invite, comingSoon } from './views/misc.js';
import { agreement, agreementsReview } from './views/agreement.js';

const root = document.getElementById('app');
const state = { me: null, config: null, unread: 0 };

const routes = [
  [/^\/join\/([A-Za-z0-9]+)$/, ([code]) => { localStorage.setItem('ms_invite', code.toUpperCase()); return go('/signin', true); }, { public: true }],
  [/^\/signin$/, () => signIn, { public: true, bare: true }],
  [/^\/auth\/callback$/, () => authCallback, { public: true, bare: true }],
  [/^\/agreement\/(member|host)$/, () => agreement, { allowIncomplete: true, agreement: true, noNav: true }],
  [/^\/agreements$/, () => agreementsReview, {}],
  [/^\/profile$/, () => profile, { allowIncomplete: true }],
  [/^\/(activities)?$/, () => activities, { tab: 'activities' }],
  [/^\/new$/, () => activityForm, { host: true }],
  [/^\/a\/([\w-]+)$/, () => detail, {}],
  [/^\/a\/([\w-]+)\/edit$/, () => activityForm, { host: true }],
  [/^\/a\/([\w-]+)\/chat$/, () => chat, { noNav: true }],
  [/^\/a\/([\w-]+)\/checkin$/, () => checkin, {}],
  [/^\/mail$/, () => mail, { tab: 'mail' }],
  [/^\/invite$/, () => invite, {}],
  [/^\/(friends|venues|moments)$/, () => comingSoon, {}],
];

export function go(path, replace = false) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  route();
}

async function loadMe() {
  state.me = (await api('/me')).user;
  return state.me;
}

let navTimer;
async function refreshUnread() {
  if (!state.me) return;
  try { state.unread = (await api('/mail/unread')).count; } catch { /* offline */ }
  const b = document.querySelector('.nav .badge');
  if (b) { b.textContent = state.unread; b.hidden = !state.unread; }
}

function navBar(tab) {
  const item = (href, name, label, key) => html`
    <a href="${href}" ${tab === key ? html`aria-current="page"` : ''}>${icon(name, 24)}${label}
      ${key === 'mail' ? html`<span class="badge" ${state.unread ? '' : 'hidden'}>${state.unread}</span>` : ''}</a>`;
  return html`<nav class="nav" aria-label="Main">
    ${item('/activities', 'calendar', 'Activities', 'activities')}
    ${item('/friends', 'friends', 'Friends', 'friends')}
    ${item('/venues', 'venues', 'Venues', 'venues')}
    ${item('/mail', 'mail', 'Mail', 'mail')}
    ${item('/moments', 'camera', 'Moments', 'moments')}
  </nav>`;
}

let renderToken = 0;
async function route() {
  const token = ++renderToken;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!state.config) state.config = await api('/config').catch(() => ({}));
  if (state.me === null) await loadMe().catch(() => {});

  for (const [re, pick, opts] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const params = m.slice(1);
    if (!opts.public && !state.me) return go('/signin', true);
    if (!opts.public && !opts.agreement && !state.me.agreements?.member) return go('/agreement/member', true);
    if (!opts.public && !opts.allowIncomplete && state.me && !state.me.complete) return go('/profile', true);
    if (opts.host && !state.me.agreements?.host) return go(`/agreement/host?next=${encodeURIComponent(path)}`, true);
    const view = await pick(params);
    if (typeof view !== 'function' || token !== renderToken) return;
    const tab = opts.tab || (path.match(/^\/(friends|venues|moments)$/)?.[1]);
    root.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'page';
    root.append(page);
    if (!opts.bare && !opts.noNav && state.me?.complete) {
      page.classList.add('with-nav');
      const nav = document.createElement('div');
      render(nav, navBar(tab));
      root.append(nav);
    }
    window.scrollTo(0, 0);
    try {
      await view(page, {
        params, query: url.searchParams, me: state.me, config: state.config, go,
        reloadMe: loadMe, refreshUnread, isCurrent: () => token === renderToken,
      });
    } catch (e) {
      if (e.status === 401) { state.me = null; return go('/signin', true); }
      if (e.code?.startsWith('agreement_')) { await loadMe(); return go(`/agreement/${e.code.slice(10)}?next=${encodeURIComponent(path)}`, true); }
      render(page, html`<main class="no-nav"><div class="empty"><p>${e.message}</p><a class="btn ghost" href="/activities">Back to Activities</a></div></main>`);
    }
    refreshUnread();
    return;
  }
  go('/activities', true);
}

// In-app links use the router instead of reloading the page.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || a.target || e.metaKey || e.ctrlKey || a.hasAttribute('download') || a.getAttribute('href').startsWith('/uploads')) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
window.addEventListener('popstate', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
clearInterval(navTimer);
navTimer = setInterval(refreshUnread, 30000);

export const appState = state;
route();
