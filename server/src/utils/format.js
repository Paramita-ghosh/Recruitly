export const iso = (ms) => new Date(ms).toISOString();
export const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

export function fmtWhen(startsAt, tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(startsAt));
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const csvSafe = (v) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
};
