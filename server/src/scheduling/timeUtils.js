

export const MIN = 60 * 1000;

export const pad2 = (n) => String(n).padStart(2, '0');

export function timeToMinutes(t) {
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m || 0);
}

const dtfCache = new Map();
function partsFormatter(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function tzOffsetMs(utcMs, tz) {
  const parts = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}


export function zonedToUtcMs(dateStr, timeStr, tz) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const mins = timeToMinutes(timeStr);
  const guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  let off = tzOffsetMs(guess, tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) utc = guess - off2;
  return utc;
}

const keyFmtCache = new Map();

export function dateKeyInTz(ms, tz) {
  let f = keyFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    keyFmtCache.set(tz, f);
  }
  return f.format(new Date(ms));
}

/** 'HH:MM' of an instant as seen in `tz`. */
export function timeKeyInTz(ms, tz) {
  const parts = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return `${parts.hour}:${parts.minute}`;
}

export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function listDates(startStr, endStr) {
  const out = [];
  const [y, m, d] = String(startStr).slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = String(endStr).slice(0, 10).split('-').map(Number);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = Date.UTC(y, m - 1, d); t <= end; t += 86400000) {
    const dt = new Date(t);
    out.push(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
  }
  return out;
}


export function buildDays({ startDate, endDate, dayStart, dayEnd, timezone }) {
  return listDates(startDate, endDate).map((key) => ({
    key,
    startMs: zonedToUtcMs(key, dayStart, timezone),
    endMs: zonedToUtcMs(key, dayEnd, timezone),
  }));
}

export const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

export function mergeIntervals(list) {
  const a = list
    .filter((x) => x.end > x.start)
    .map((x) => ({ start: x.start, end: x.end }))
    .sort((p, q) => p.start - q.start || p.end - q.end);
  const out = [];
  for (const x of a) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push(x);
  }
  return out;
}


export function covers(merged, s, e) {
  for (const x of merged) {
    if (x.start > s) return false;
    if (x.end >= e) return x.start <= s;
  }
  return false;
}

export function subtractIntervals(merged, cuts) {
  const c = mergeIntervals(cuts);
  const out = [];
  for (const m of merged) {
    let cur = m.start;
    for (const x of c) {
      if (x.end <= cur || x.start >= m.end) continue;
      if (x.start > cur) out.push({ start: cur, end: x.start });
      cur = Math.max(cur, x.end);
      if (cur >= m.end) break;
    }
    if (cur < m.end) out.push({ start: cur, end: m.end });
  }
  return out;
}

export function intersectIntervals(a, b) {
  const out = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (e > s) out.push({ start: s, end: e });
    }
  }
  return mergeIntervals(out);
}
