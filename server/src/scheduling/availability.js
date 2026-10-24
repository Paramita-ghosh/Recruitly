import { mergeIntervals, subtractIntervals, intersectIntervals, weekdayOf, zonedToUtcMs } from './timeUtils.js';

export function resolveAvailability({ rules = [], exceptions = [], days, timezone }) {
  const available = [];
  const preferred = [];
  const unavailable = [];

  for (const day of days) {
    const wd = weekdayOf(day.key);
    const window = [{ start: day.startMs, end: day.endMs }];
    const dayAvail = [];
    const dayPref = [];
    for (const r of rules) {
      if (Number(r.weekday) !== wd) continue;
      const iv = {
        start: zonedToUtcMs(day.key, r.startTime, timezone),
        end: zonedToUtcMs(day.key, r.endTime, timezone),
      };
      dayAvail.push(iv);
      if (r.kind === 'preferred') dayPref.push(iv);
    }
    const cuts = [];
    for (const ex of exceptions) {
      if (String(ex.date).slice(0, 10) !== day.key) continue;
      const iv =
        ex.startTime == null
          ? { start: day.startMs, end: day.endMs }
          : { start: zonedToUtcMs(day.key, ex.startTime, timezone), end: zonedToUtcMs(day.key, ex.endTime, timezone) };
      if (ex.kind === 'available') dayAvail.push(iv);
      else cuts.push(iv);
    }
    const clippedAvail = intersectIntervals(mergeIntervals(dayAvail), window);
    const clippedPref = intersectIntervals(mergeIntervals(dayPref), window);
    available.push(...subtractIntervals(clippedAvail, cuts));
    preferred.push(...subtractIntervals(clippedPref, cuts));
    unavailable.push(...intersectIntervals(mergeIntervals(cuts), window));
  }
  return {
    available: mergeIntervals(available),
    preferred: mergeIntervals(preferred),
    unavailable: mergeIntervals(unavailable),
  };
}
