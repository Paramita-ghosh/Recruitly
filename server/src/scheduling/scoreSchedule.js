import { MIN, covers } from './timeUtils.js';
import { validateSchedule } from './constraintValidator.js';

export const SCORE_WEIGHTS = {
  coverage: 25,
  loadBalance: 20,
  idleGaps: 15,
  candidatePreference: 15,
  modePreference: 15,
  stability: 10,
};

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n) => Math.max(0, Math.min(100, n));

export function scoreSchedule(p, assignments, { totalCandidates, baseline, roundIds } = {}) {
  const sessions = [...assignments].sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : 1));
  const isLive = (x) => !x.status || ['scheduled', 'in_progress'].includes(x.status);
  const validation = validateSchedule(p, sessions.filter(isLive), { existing: sessions.filter((x) => !isLive(x)) });
  const total = totalCandidates ?? sessions.length;

  const coverage = total === 0 ? 100 : clamp((sessions.length / total) * 100);

  const rounds = new Set(roundIds || sessions.map((s) => s.roundId));
  const qualified = p.interviewers.filter((iv) =>
    [...rounds].some((rid) => {
      const r = p.roundById.get(rid);
      return r && (r.requiredSkillIds || []).every((sk) => iv.skillSet.has(sk));
    }),
  );
  const counts = new Map(qualified.map((iv) => [iv.id, 0]));
  for (const s of sessions) for (const id of s.interviewerIds) counts.set(id, (counts.get(id) || 0) + 1);
  const vals = [...counts.values()];
  let loadBalance = 100;
  let cv = 0;
  if (vals.length > 1) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean > 0) {
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      cv = Math.sqrt(variance) / mean;
      loadBalance = clamp(100 * (1 - cv));
    }
  }

  const perIv = new Map();
  for (const s of sessions) for (const id of s.interviewerIds) {
    const k = `${id}|${p.dayKey(s.start)}`;
    if (!perIv.has(k)) perIv.set(k, []);
    perIv.get(k).push(s);
  }
  let idleTotal = 0;
  let idleCount = 0;
  for (const list of perIv.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      idleTotal += Math.max(0, (list[i].start - list[i - 1].end) / MIN);
      idleCount += 1;
    }
  }
  const avgIdle = idleCount ? idleTotal / idleCount : 0;
  const idleGaps = clamp(100 * (1 - avgIdle / 120));

  let withPref = 0;
  let satisfied = 0;
  for (const s of sessions) {
    const c = p.candById.get(s.candidateId);
    if (c && c.preferred && c.preferred.length) {
      withPref += 1;
      if (covers(c.preferred, s.start, s.end)) satisfied += 1;
    }
  }
  const candidatePreference = withPref ? clamp((satisfied / withPref) * 100) : 100;

  let modeSum = 0;
  let modeN = 0;
  for (const s of sessions) {
    for (const id of s.interviewerIds) {
      const iv = p.ivById.get(id);
      if (!iv) continue;
      modeN += 1;
      modeSum += iv.modeCfg.offline && iv.modeCfg.online ? (iv.modeCfg.pref === s.mode ? 1 : 0) : 1;
    }
  }
  const modePreference = modeN ? clamp((modeSum / modeN) * 100) : 100;

  let stability = 100;
  let unchanged = 0;
  if (baseline && baseline.size) {
    for (const [key, b] of baseline) {
      const now = sessions.find((s) => s.key === key);
      if (now && now.start === b.start && now.mode === b.mode && now.roomId === b.roomId && now.interviewerIds.join() === b.interviewerIds.join()) unchanged += 1;
    }
    stability = clamp((unchanged / baseline.size) * 100);
  }

  const components = {
    coverage: { score: round1(coverage), weight: SCORE_WEIGHTS.coverage, detail: `${sessions.length} of ${total} candidates scheduled` },
    loadBalance: {
      score: round1(loadBalance),
      weight: SCORE_WEIGHTS.loadBalance,
      detail: vals.length ? `Interviews per interviewer: ${vals.join(', ')} (variation ${round1(cv * 100)}%)` : 'No interviewers assigned',
    },
    idleGaps: {
      score: round1(idleGaps),
      weight: SCORE_WEIGHTS.idleGaps,
      detail: idleCount ? `Average idle gap ${round1(avgIdle)} min between consecutive interviews` : 'No consecutive interviews to compare',
    },
    candidatePreference: {
      score: round1(candidatePreference),
      weight: SCORE_WEIGHTS.candidatePreference,
      detail: withPref ? `${satisfied} of ${withPref} candidates placed in a preferred window` : 'No candidate preferences recorded',
    },
    modePreference: {
      score: round1(modePreference),
      weight: SCORE_WEIGHTS.modePreference,
      detail: modeN ? `${Math.round(modePreference)}% of panel assignments match the interviewer's preferred mode` : 'No assignments',
    },
    stability: {
      score: round1(stability),
      weight: SCORE_WEIGHTS.stability,
      detail: baseline && baseline.size ? `${unchanged} of ${baseline.size} baseline interviews unchanged` : 'No previous schedule to compare',
    },
  };

  const weighted = Object.values(components).reduce((acc, c) => acc + (c.score * c.weight) / 100, 0);
  const score = validation.valid ? round1(clamp(weighted)) : 0;

  return {
    score,
    valid: validation.valid,
    hardConstraintViolations: validation.violations.length,
    violations: validation.violations.slice(0, 50),
    components,
    note: validation.valid
      ? 'All hard constraints verified independently.'
      : 'Hard constraints are violated, so the score is forced to 0 until they are fixed.',
  };
}
