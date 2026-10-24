import { MIN, overlaps, subtractIntervals } from './timeUtils.js';
import { ScheduleState, buildOptions, candidateStarts } from './core.js';

export const RESCHEDULE_WEIGHTS = {
  moveSession: 100,
  changeDate: 50,
  changeInterviewer: 10,
  changeMode: 8,
  changeRoom: 5,
  perSlotShift: 0.5,
  quality: 0.01,
};

const W = RESCHEDULE_WEIGHTS;

function changeCost(p, orig, start, opt) {
  let c = 0;
  if (start !== orig.start) {
    c += W.moveSession;
    if (p.dayKey(start) !== p.dayKey(orig.start)) c += W.changeDate;
    c += (Math.abs(start - orig.start) / MIN / p.drive.slotMinutes) * W.perSlotShift;
  }
  const origSet = new Set(orig.interviewerIds);
  c += opt.interviewerIds.filter((id) => !origSet.has(id)).length * W.changeInterviewer;
  if (opt.mode !== orig.mode) c += W.changeMode;
  if ((opt.roomId || null) !== (orig.roomId || null)) c += W.changeRoom;
  return c + opt.cost * W.quality;
}

const snap = (s) => ({ start: s.start, end: s.end, mode: s.mode, roomId: s.roomId || null, interviewerIds: [...s.interviewerIds] });

function withBlockedWindow(p, interviewerId, window) {
  const mod = { ...p };
  mod.interviewers = p.interviewers.map((iv) =>
    iv.id === interviewerId ? { ...iv, availability: subtractIntervals(iv.availability, [window]) } : iv,
  );
  mod.ivById = new Map(mod.interviewers.map((i) => [i.id, i]));
  return mod;
}

function findPlacement(p, state, orig, cancelledId, { allowSameSlot = true, nearby = 12 } = {}) {
  const round = p.roundById.get(orig.roundId);
  const cand = p.candById.get(orig.candidateId);
  const exclude = new Set(cancelledId ? [cancelledId] : []);
  const others = orig.interviewerIds.filter((id) => id !== cancelledId);
  let best = null;
  const consider = (start, tier, must) => {
    const opts = buildOptions(p, round, cand, start, state, {
      exclude,
      mustInclude: must,
      preferRoomId: orig.roomId || undefined,
      preferMode: orig.mode,
      limit: 6,
    });
    for (const o of opts) {
      const cost = changeCost(p, orig, start, o);
      if (!best || cost < best.cost - 1e-9) best = { start, opt: o, cost, tier };
    }
  };
  if (allowSameSlot && candidateStarts(p, round, cand, state).includes(orig.start)) consider(orig.start, 1, others);
  if (best && best.tier === 1) return best; // same slot is always cheapest in practice

  const starts = candidateStarts(p, round, cand, state)
    .filter((s) => s !== orig.start)
    .sort((a, b) => Math.abs(a - orig.start) - Math.abs(b - orig.start) || a - b)
    .slice(0, nearby);
  if (allowSameSlot && !best) consider(orig.start, 1, undefined);
  if (best && best.tier === 1) return best;
  for (const s of starts) {
    consider(s, 2, others);
    consider(s, 2, undefined);
  }
  return best;
}

function mkSession(orig, start, opt, round) {
  return {
    ...orig,
    start,
    end: start + round.durationMinutes * MIN,
    mode: opt.mode,
    roomId: opt.roomId,
    interviewerIds: opt.interviewerIds,
  };
}

export function planReschedule(p, { cancelledInterviewerId, window, now = 0, maxEjectionCandidates = 40, driveId = null }) {
  const mod = withBlockedWindow(p, cancelledInterviewerId, window);
  const all = p.existing;
  const affected = all.filter(
    (s) => s.movable !== false && s.start >= now && s.interviewerIds.includes(cancelledInterviewerId) && overlaps(s.start, s.end, window.start, window.end),
  );
  const affectedKeys = new Set(affected.map((s) => s.key));
  const lockedAffected = all.filter(
    (s) => s.movable === false && (!driveId || s.driveId === driveId) && (!s.status || ['scheduled', 'in_progress'].includes(s.status)) && s.end > now &&
      s.interviewerIds.includes(cancelledInterviewerId) && overlaps(s.start, s.end, window.start, window.end),
  );
  const state = new ScheduleState(mod, all.filter((s) => !affectedKeys.has(s.key)));

  const ranked = affected
    .map((s) => {
      const round = mod.roundById.get(s.roundId);
      const cand = mod.candById.get(s.candidateId);
      const n = buildOptions(mod, round, cand, s.start, state, { exclude: new Set([cancelledInterviewerId]) }).length;
      return { s, n };
    })
    .sort((a, b) => a.n - b.n || a.s.start - b.s.start || (a.s.key < b.s.key ? -1 : 1))
    .map((x) => x.s);

  const changes = [];
  const finalSessions = new Map(all.filter((s) => !affectedKeys.has(s.key)).map((s) => [s.key, s]));
  let totalCost = 0;

  const describe = (orig, next, type, extra = '') => {
    const names = (ids) => ids.map((id) => mod.nameOf(id)).join(', ');
    const origSet = new Set(orig.interviewerIds);
    const added = next.interviewerIds.filter((id) => !origSet.has(id));
    let reason;
    if (type === 'interviewer_substituted')
      reason = `${mod.nameOf(cancelledInterviewerId)} became unavailable; ${names(added)} covers the same slot.`;
    else reason = `${mod.nameOf(cancelledInterviewerId)} became unavailable; interview moved to the nearest feasible slot.${extra}`;
    return reason;
  };

  for (const orig of ranked) {
    const round = mod.roundById.get(orig.roundId);
    let placement = findPlacement(mod, state, orig, cancelledInterviewerId);

    if (placement) {
      const next = mkSession(orig, placement.start, placement.opt, round);
      state.add(next);
      finalSessions.set(orig.key, next);
      totalCost += placement.cost;
      const type = placement.start === orig.start ? 'interviewer_substituted' : 'moved';
      changes.push({
        key: orig.key,
        type,
        before: snap(orig),
        after: snap(next),
        reason: describe(orig, next, type),
        candidateMoved: placement.start !== orig.start,
        interviewerChanged: next.interviewerIds.join() !== [...orig.interviewerIds].sort().join(),
        modeChanged: next.mode !== orig.mode,
        roomChanged: (next.roomId || null) !== (orig.roomId || null),
        needsManual: false,
        cost: Math.round(placement.cost * 100) / 100,
      });
      continue;
    }

    let bestEject = null;
    const movables = [...state.sessions.values()]
      .filter((v) => v.movable !== false && v.start >= now && v.candidateId !== orig.candidateId)
      .sort((a, b) => Math.abs(a.start - orig.start) - Math.abs(b.start - orig.start) || (a.key < b.key ? -1 : 1))
      .slice(0, maxEjectionCandidates);
    for (const v of movables) {
      state.remove(v);
      const pa = findPlacement(mod, state, orig, cancelledInterviewerId);
      if (pa) {
        const na = mkSession(orig, pa.start, pa.opt, round);
        state.add(na);
        const pv = findPlacement(mod, state, v, null, { allowSameSlot: false });
        if (pv) {
          const total = pa.cost + pv.cost;
          if (!bestEject || total < bestEject.total - 1e-9) bestEject = { v, pa, pv, total };
        }
        state.remove(na);
      }
      state.add(v);
    }
    if (bestEject) {
      const { v, pa, pv, total } = bestEject;
      state.remove(v);
      const na = mkSession(orig, pa.start, pa.opt, round);
      const nv = mkSession(v, pv.start, pv.opt, mod.roundById.get(v.roundId));
      state.add(na);
      state.add(nv);
      finalSessions.set(orig.key, na);
      finalSessions.set(v.key, nv);
      totalCost += total;
      changes.push({
        key: orig.key,
        type: pa.start === orig.start ? 'interviewer_substituted' : 'moved',
        before: snap(orig),
        after: snap(na),
        reason: describe(orig, na, pa.start === orig.start ? 'interviewer_substituted' : 'moved', ' Another interview was shifted to make room.'),
        candidateMoved: pa.start !== orig.start,
        interviewerChanged: na.interviewerIds.join() !== [...orig.interviewerIds].sort().join(),
        modeChanged: na.mode !== orig.mode,
        roomChanged: (na.roomId || null) !== (orig.roomId || null),
        needsManual: false,
        cost: Math.round(pa.cost * 100) / 100,
      });
      changes.push({
        key: v.key,
        type: 'moved_for_capacity',
        before: snap(v),
        after: snap(nv),
        reason: `Moved to free a resource for ${mod.nameOf(orig.candidateId)}'s rescheduled interview (smallest possible disruption).`,
        candidateMoved: pv.start !== v.start,
        interviewerChanged: nv.interviewerIds.join() !== [...v.interviewerIds].sort().join(),
        modeChanged: nv.mode !== v.mode,
        roomChanged: (nv.roomId || null) !== (v.roomId || null),
        needsManual: false,
        cost: Math.round(pv.cost * 100) / 100,
      });
      continue;
    }

    finalSessions.delete(orig.key);
    changes.push({
      key: orig.key,
      type: 'needs_rebooking',
      before: snap(orig),
      after: null,
      reason: `${mod.nameOf(cancelledInterviewerId)} became unavailable and no qualified replacement or nearby slot exists. The candidate must rebook.`,
      candidateMoved: true,
      interviewerChanged: false,
      modeChanged: false,
      roomChanged: false,
      needsManual: true,
      cost: W.moveSession + W.changeDate,
    });
    totalCost += W.moveSession + W.changeDate;
  }

  for (const s of lockedAffected) {
    changes.push({
      key: s.key,
      type: 'manual_review',
      before: snap(s),
      after: null,
      reason: `${mod.nameOf(cancelledInterviewerId)} is unavailable but this interview already has evaluations or has started, so it was not changed automatically. Decide manually.`,
      candidateMoved: false,
      interviewerChanged: false,
      modeChanged: false,
      roomChanged: false,
      needsManual: true,
      cost: 0,
    });
  }

  return {
    changes,
    affectedCount: affected.length + lockedAffected.length,
    unchangedCount: all.length - changes.length,
    totalCost: Math.round(totalCost * 100) / 100,
    finalSessions: [...finalSessions.values()],
    problem: mod,
  };
}
