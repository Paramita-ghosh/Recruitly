import { MIN } from './timeUtils.js';
import { ScheduleState, buildOptions, candidateStarts, generateStarts } from './core.js';

export { generateStarts, candidateStarts };


export function feasibleSlots(p, round, cand, state = new ScheduleState(p), { mode } = {}) {
  const out = [];
  for (const s of candidateStarts(p, round, cand, state)) {
    let options = buildOptions(p, round, cand, s, state);
    if (mode) options = options.filter((o) => o.mode === mode);
    if (!options.length) continue;
    out.push({
      start: s,
      end: s + round.durationMinutes * MIN,
      dayKey: p.dayKey(s),
      modes: [...new Set(options.map((o) => o.mode))],
      options,
      best: options[0],
    });
  }
  return out;
}
