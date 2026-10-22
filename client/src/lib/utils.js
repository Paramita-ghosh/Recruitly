import clsx from 'clsx';
export const cn = (...a) => clsx(...a);

const tzOf = (tz) => tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
export const fmtTime = (iso, tz) => (iso ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tzOf(tz) }).format(new Date(iso)) : '—');
export const fmtDate = (iso, tz) => (iso ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tzOf(tz) }).format(new Date(iso)) : '—');
export const fmtDateLong = (iso, tz) => (iso ? new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tzOf(tz) }).format(new Date(iso)) : '—');
export const fmtDateTime = (iso, tz) => (iso ? `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}` : '—');
export const timeKey = (iso, tz) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tzOf(tz) }).format(new Date(iso));
export const dayKey = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf(tz) }).format(new Date(iso));
export const fmtRange = (s, e, tz) => `${fmtTime(s, tz)} – ${fmtTime(e, tz)}`;
export const fmtAgo = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
export const pct = (n) => `${Math.round(n)}%`;
export const dateOnly = (v) => String(v || '').slice(0, 10);

/** Combine a YYYY-MM-DD date and HH:MM wall-clock time in an IANA time zone into a UTC ISO string. */
export function zonedToIso(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let utc = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utc));
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    const asIfUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
    utc += Date.UTC(y, m - 1, d, hh, mm) - asIfUtc;
  }
  return new Date(utc).toISOString();
}

export const STATUS_TONE = {
  scheduled: 'blue', in_progress: 'violet', completed: 'green', cancelled: 'red', needs_rebooking: 'amber',
  awaiting_booking: 'amber', eligible: 'gray', evaluation_pending: 'violet', passed: 'green', failed: 'red',
  draft: 'gray', published: 'blue', pending: 'gray', preview: 'amber', approved: 'green', discarded: 'gray',
};
export const label = (s = '') => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const ROUND_COLORS = ['#3563E9', '#7C5CFC', '#0D9488', '#F4B942', '#D92D3A'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const modesLabel = (m) => ({ offline_only: 'Offline only', online_only: 'Online only', both_prefer_offline: 'Both · prefers offline', both_prefer_online: 'Both · prefers online' }[m] || label(m));
