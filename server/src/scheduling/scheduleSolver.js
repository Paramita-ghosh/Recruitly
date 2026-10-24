import { MIN } from './timeUtils.js';
import {
  ScheduleState,
  buildOptions,
  candidateStarts,
  hasAllSkills,
  hasOption,
  makeSession,
} from './core.js';
import { validateSchedule } from './constraintValidator.js';
import { explainConflict } from './explainConflict.js';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function ctxFor(p, cand) {
  return p.drive.continuity && cand.priorInterviewerIds?.length ? { continuityIds: new Set(cand.priorInterviewerIds) } : {};
}

function countFeasible(p, round, v, state) {
  let n = 0;
  for (const s of v.domain) if (hasOption(p, round, v.cand, s, state, ctxFor(p, v.cand))) n += 1;
  return n;
}

function bestPlacement(p, round, v, state) {
  let best = null;
  for (const s of v.domain) {
    const opts = buildOptions(p, round, v.cand, s, state, { ...ctxFor(p, v.cand), limit: 1 });
    if (!opts.length) continue;
    const o = opts[0];
    if (!best || o.cost < best.opt.cost - 1e-9 || (Math.abs(o.cost - best.opt.cost) <= 1e-9 && s < best.start)) best = { start: s, opt: o };
  }
  return best;
}

function enumerateBranches(p, round, v, state, maxBranch) {
  const all = [];
  for (const s of v.domain) {
    for (const o of buildOptions(p, round, v.cand, s, state, { ...ctxFor(p, v.cand), limit: 2 })) all.push({ start: s, opt: o });
  }
  all.sort((a, b) => a.opt.cost - b.opt.cost || a.start - b.start);
  return all.slice(0, maxBranch);
}

function runGreedy(p, round, vars) {
  const state = new ScheduleState(p);
  const remaining = new Set(vars.map((v) => v.cand.id));
  const assigned = [];
  const failed = [];
  while (remaining.size) {
    let pick = null;
    let pickCount = Infinity;
    for (const v of vars) {
      if (!remaining.has(v.cand.id)) continue;
      const c = countFeasible(p, round, v, state);
      if (c === 0) {
        remaining.delete(v.cand.id);
        failed.push(v.cand.id);
        continue;
      }
      if (c < pickCount || (c === pickCount && v.cand.id < pick.cand.id)) {
        pick = v;
        pickCount = c;
      }
    }
    if (!pick) break;
    const place = bestPlacement(p, round, pick, state);
    const sess = makeSession(round, pick.cand, place.start, place.opt);
    state.add(sess);
    assigned.push(sess);
    remaining.delete(pick.cand.id);
  }
  return { state, assigned, failed };
}

function runDfs(p, round, vars, budget) {
  const state = new ScheduleState(p);
  const stats = { nodes: 0, stopped: false };
  const t0 = Date.now();
  let best = [];
  const current = [];
  const rec = (remaining) => {
    if (current.length > best.length) best = current.slice();
    if (stats.nodes++ > budget.maxNodes || Date.now() - t0 > budget.maxMs) {
      stats.stopped = true;
      return false;
    }
    if (!remaining.length) return true;
    let pick = null;
    let pickCount = Infinity;
    for (const v of remaining) {
      const c = countFeasible(p, round, v, state);
      if (c === 0) return false; // forward-checking dead end
      if (c < pickCount || (c === pickCount && v.cand.id < pick.cand.id)) {
        pick = v;
        pickCount = c;
      }
    }
    const rest = remaining.filter((v) => v !== pick);
    for (const br of enumerateBranches(p, round, pick, state, budget.maxBranch)) {
      const sess = makeSession(round, pick.cand, br.start, br.opt);
      state.add(sess);
      current.push(sess);
      if (rec(rest)) return true;
      current.pop();
      state.remove(sess);
      if (stats.stopped) return false;
    }
    return false;
  };
  const found = rec([...vars].sort((a, b) => a.cand.id.localeCompare(b.cand.id)));
  return { found, solution: found ? current.slice() : best, stats };
}

function capacityProof(p, round, vars) {
  if (!vars.length) return null;
  const base = new ScheduleState(p);
  const qualified = p.interviewers.filter((iv) => hasAllSkills(iv, round));
  let available = 0;
  for (const iv of qualified) {
    for (const day of p.days) {
      const hasWindow = iv.availability.some((w) => w.end > day.startMs && w.start < day.endMs);
      if (hasWindow) available += Math.max(0, iv.dailyCapacity - base.dayCount(iv.id, day.key));
    }
  }
  const needed = vars.length * round.panelSize;
  return needed > available ? { code: 'aggregate_capacity', needed, available } : null;
}

function improve(p, round, vars, state, assigned, unscheduled) {
  const varById = new Map(vars.map((v) => [v.cand.id, v]));
  let ejections = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const uid of [...unscheduled].sort()) {
      const u = varById.get(uid);
      const direct = bestPlacement(p, round, u, state);
      if (direct) {
        const s = makeSession(round, u.cand, direct.start, direct.opt);
        state.add(s);
        assigned.push(s);
        unscheduled.delete(uid);
        changed = true;
        continue;
      }
      for (const v of [...assigned].sort((a, b) => (a.key < b.key ? -1 : 1))) {
        state.remove(v);
        const pu = bestPlacement(p, round, u, state);
        if (!pu) {
          state.add(v);
          continue;
        }
        const su = makeSession(round, u.cand, pu.start, pu.opt);
        state.add(su);
        const vv = varById.get(v.candidateId);
        const pv = bestPlacement(p, round, vv, state);
        if (pv) {
          const sv = makeSession(round, vv.cand, pv.start, pv.opt);
          state.add(sv);
          assigned.splice(assigned.indexOf(v), 1, sv);
          assigned.push(su);
          unscheduled.delete(uid);
          ejections += 1;
          changed = true;
          break;
        }
        state.remove(su);
        state.add(v);
      }
    }
    if (!changed) break;
  }

  let rebalanced = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    let any = false;
    for (let i = 0; i < assigned.length; i += 1) {
      const cur = assigned[i];
      const v = varById.get(cur.candidateId);
      state.remove(cur);
      const round_ = round;
      const opts = buildOptions(p, round_, v.cand, cur.start, state, ctxFor(p, v.cand));
      const same = opts.find((o) => o.mode === cur.mode && o.roomId === cur.roomId && o.interviewerIds.join() === cur.interviewerIds.join());
      const best = opts[0];
      if (best && same && best.cost < same.cost - 1e-9) {
        const ns = makeSession(round_, v.cand, cur.start, best);
        state.add(ns);
        assigned[i] = ns;
        rebalanced += 1;
        any = true;
      } else {
        state.add(cur);
      }
    }
    if (!any) break;
  }
  return { ejections, rebalanced };
}

export function solveSchedule(p, { roundId, candidateIds, budget = {} }) {
  const t0 = Date.now();
  const round = p.roundById.get(roundId);
  if (!round) throw new Error(`Unknown round ${roundId}`);
  const opts = { maxNodes: 20000, maxMs: 4000, maxBranch: 6, ...budget };

  const targets = (candidateIds || p.candidates.map((c) => c.id))
    .map((id) => p.candById.get(id))
    .filter(Boolean)
    .sort(byId);

  const base = new ScheduleState(p);
  const vars = [];
  const structural = new Set();
  for (const cand of targets) {
    if (round.prerequisiteRoundId && !p.passedRounds.get(cand.id)?.has(round.prerequisiteRoundId)) {
      structural.add(cand.id);
      continue;
    }
    const domain = candidateStarts(p, round, cand, base).filter((s) => hasOption(p, round, cand, s, base, ctxFor(p, cand)));
    if (!domain.length) {
      structural.add(cand.id);
      continue;
    }
    vars.push({ cand, domain });
  }

  const stats = { candidates: targets.length, nodes: 0, dfsRun: false, dfsStopped: false, ejections: 0, rebalanced: 0 };
  let assigned = [];
  let unscheduledIds = new Set();
  let state = null;
  let proof = null;

  if (vars.length) {
    const greedy = runGreedy(p, round, vars);
    stats.greedyScheduled = greedy.assigned.length;
    assigned = greedy.assigned;
    state = greedy.state;
    unscheduledIds = new Set(greedy.failed);

    if (unscheduledIds.size) {
      proof = capacityProof(p, round, vars);
      if (!proof) {
        stats.dfsRun = true;
        const dfs = runDfs(p, round, vars, opts);
        stats.nodes = dfs.stats.nodes;
        stats.dfsStopped = dfs.stats.stopped;
        if (dfs.found || dfs.solution.length > assigned.length) {
          // rebuild state from the better solution
          assigned = dfs.solution;
          state = new ScheduleState(p);
          for (const s of assigned) state.add(s);
          const got = new Set(assigned.map((s) => s.candidateId));
          unscheduledIds = new Set(vars.filter((v) => !got.has(v.cand.id)).map((v) => v.cand.id));
        }
      }
      if (unscheduledIds.size) {
        const imp = improve(p, round, vars, state, assigned, unscheduledIds);
        stats.ejections = imp.ejections;
        stats.rebalanced = imp.rebalanced;
      }
    } else {
      const imp = improve(p, round, vars, state, assigned, unscheduledIds);
      stats.rebalanced = imp.rebalanced;
    }
  } else {
    state = new ScheduleState(p);
  }

  let validation = validateSchedule(p, assigned);
  const dropped = [];
  for (let i = 0; i < 3 && !validation.valid; i += 1) {
    const bad = new Set(validation.violations.map((v) => v.key));
    for (const s of assigned) if (bad.has(s.key)) dropped.push(s.candidateId);
    for (const s of assigned.filter((x) => bad.has(x.key))) state.remove(s);
    assigned = assigned.filter((s) => !bad.has(s.key));
    validation = validateSchedule(p, assigned);
  }
  for (const id of dropped) unscheduledIds.add(id);

  assigned.sort((a, b) => a.start - b.start || (a.candidateId < b.candidateId ? -1 : 1));
  const scheduledIds = new Set(assigned.map((s) => s.candidateId));

  const finalState = new ScheduleState(p);
  for (const s of assigned) finalState.add(s);
  const unscheduled = [];
  for (const cand of targets) {
    if (scheduledIds.has(cand.id)) continue;
    const ex = explainConflict(p, finalState, cand, round);
    const provenHere = structural.has(cand.id) || ex.proven || (proof && ex.reasons.some((r) => ['interviewer_busy', 'daily_capacity'].includes(r.code)));
    unscheduled.push({ candidateId: cand.id, name: p.nameOf(cand.id), proven: Boolean(provenHere), primary: ex.primary, reasons: ex.reasons });
  }

  let status;
  if (!unscheduled.length) status = 'complete';
  else if (!assigned.length && unscheduled.every((u) => u.proven)) status = 'infeasible';
  else if (stats.dfsStopped && unscheduled.some((u) => !u.proven)) status = 'budget_exhausted';
  else status = 'partial';

  stats.elapsedMs = Date.now() - t0;
  stats.scheduled = assigned.length;
  stats.unscheduled = unscheduled.length;
  stats.capacityProof = proof;
  stats.validationDropped = dropped.length;

  return {
    status,
    assignments: assigned.map((s) => ({ ...s, durationMinutes: (s.end - s.start) / MIN })),
    unscheduled,
    stats,
    validation,
  };
}
