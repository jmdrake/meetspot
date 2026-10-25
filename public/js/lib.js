// Shared helpers: API calls, safe HTML templating, formatting, icons, toast.

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: form ? {} : { 'content-type': 'application/json' },
    body: form || (body ? JSON.stringify(body) : undefined),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong');
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

// html`...` escapes every interpolated value unless wrapped in raw().
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s ?? '') });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function part(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}
export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
}
export const render = (el, tpl) => { el.innerHTML = tpl[RAW]; };

// Formatting
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const dow = (d) => DOW[new Date(d).getDay()];
export const dayNum = (d) => new Date(d).getDate();
export const time = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
export const longDate = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
export const when = (a) => `${longDate(a.startsAt)} · ${time(a.startsAt)}`;
export function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return longDate(d);
}
export function left(d) {
  const s = Math.max(0, (new Date(d) - Date.now()) / 1000);
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} days`;
}
export const COST = { free: 'Free', pay_own: 'Pay your own', dutch: 'Dutch', host_covers: 'Host covers it', ticket: 'Ticket' };
export const cost = (a) => (a.costType === 'ticket' ? `$${(a.priceCents / 100).toFixed(2).replace('.00', '')} ticket` : COST[a.costType]);
export const INTENT_LABEL = { romance: 'Romance', friends: 'Friends', networking: 'Networking', community: 'Community' };
export const capacity = (a) => (a.spots === 1 ? (a.spotsLeft ? '1 spot' : 'Full') : `${a.confirmed} of ${a.spots} filled`);

// Local datetime-input value ↔ ISO
export const toLocalInput = (d) => {
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Stroke icons (aria-hidden; buttons carry their own labels).
const P = {
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  friends: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.9.3 5 2.7 5 5.8"/>',
  venues: '<ellipse cx="12" cy="9" rx="9" ry="3.5"/><path d="M3 9v6c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5V9"/><path d="M8 12.2v6M16 12.2v6M12 12.5v6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c0-4 3.4-7 7.5-7s7.5 3 7.5 7"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  person: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9 2.5h6"/>',
  scan: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export const icon = (name, size = 22) =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);

export const avatar = (p, cls = '') =>
  p?.photo ? html`<img class="avatar ${cls}" src="${p.photo}" alt="">`
    : html`<span class="avatar ${cls}" aria-hidden="true">${(p?.firstName || p?.label || '?').slice(0, 1)}</span>`;
