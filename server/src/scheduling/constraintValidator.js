// Independent hard-constraint validator. Deliberately does NOT reuse ScheduleState or the option
// generator so that it can catch bugs in the solver, in coordinator overrides and in reschedule plans.

import { MIN, covers, overlaps } from './timeUtils.js';
import { permittedModes, roomNeedFor } from './core.js';

/**
 * assignments: [{ key, candidateId, roundId, start, end, mode, roomId, interviewerIds }]
 * options.existing  : fixed sessions that are assumed valid but still constrain the assignments
 * options.focusKeys : only report problems involving these keys (default: all assignments)
 * Returns { valid, violations: [{ code, key, message }] }
 */
export function validateSchedule(p, assignments, options = {}) {
  const existing = options.existing ?? p.existing ?? [];
  const focus = options.focusKeys ? new Set(options.focusKeys) : null;
  const violations = [];
  const add = (code, key, message) => violations.push({ code, key, message });
  const name = (id) => p.nameOf(id);
  const all = [...existing.filter((x) => !assignments.some((a) => a.key === x.key)), ...assignments];
  const isFocus = (a) => !focus || focus.has(a.key);

  for (const a of assignments) {
    if (!isFocus(a)) continue;
    const round = p.roundById.get(a.roundId);
    const cand = p.candById.get(a.candidateId);
    if (!round) {
      add('UNKNOWN_ROUND', a.key, 'Interview references an unknown round.');
      continue;
    }
    // 15 / duration & window
    if (a.end - a.start !== round.durationMinutes * MIN)
      add('DURATION', a.key, `Interview length must be ${round.durationMinutes} minutes.`);
    if (!p.days.some((d) => a.start >= d.startMs && a.end <= d.endMs))
      add('OUTSIDE_WINDOW', a.key, 'Interview falls outside the drive working hours.');
    if (a.start < p.notBefore) add('IN_THE_PAST', a.key, 'Interview starts before the earliest allowed time.');

    // 1 candidate availability
    if (!cand || !covers(cand.availability, a.start, a.end))
      add('CANDIDATE_UNAVAILABLE', a.key, `${name(a.candidateId)} is not available for the full interview.`);

    // 14 prerequisites
    if (round.prerequisiteRoundId) {
      const passed = p.passedRounds.get(a.candidateId);
      if (!passed || !passed.has(round.prerequisiteRoundId))
        add('PREREQUISITE', a.key, `${name(a.candidateId)} has not passed the prerequisite round.`);
    }

    // panel size / composition
    const ivs = a.interviewerIds.map((id) => p.ivById.get(id));
    if (new Set(a.interviewerIds).size !== a.interviewerIds.length)
      add('PANEL_DUPLICATE', a.key, 'An interviewer appears twice on the panel.');
    if (a.interviewerIds.length !== round.panelSize)
      add('PANEL_SIZE', a.key, `Panel must have exactly ${round.panelSize} interviewer(s).`);
    if (ivs.some((i) => !i)) {
      add('UNKNOWN_INTERVIEWER', a.key, 'Panel references an unknown interviewer.');
      continue;
    }
    for (const req of round.panelRequirements || []) {
      const n = ivs.filter((i) => i.skillSet.has(req.skillId)).length;
      if (n < req.minCount)
        add('PANEL_COMPOSITION', a.key, `Panel needs at least ${req.minCount} member(s) with ${p.skillNames[req.skillId] || req.skillId}.`);
    }

    for (const iv of ivs) {
      // 2/12 availability, 3 skills
      if (!covers(iv.availability, a.start, a.end))
        add('INTERVIEWER_UNAVAILABLE', a.key, `${name(iv.id)} is not available for the full interview.`);
      for (const sk of round.requiredSkillIds || [])
        if (!iv.skillSet.has(sk))
          add('MISSING_SKILL', a.key, `${name(iv.id)} lacks required skill ${p.skillNames[sk] || sk}.`);
      if (!iv.modeCfg[a.mode])
        add('MODE_NOT_PERMITTED', a.key, `${name(iv.id)} does not conduct ${a.mode} interviews.`);
    }

    // 9 mode policy
    if (!permittedModes(p, round).includes(a.mode))
      add('MODE_NOT_PERMITTED', a.key, `The ${a.mode} mode is not permitted for this round / drive.`);

    // 8/10/11 rooms
    if (a.mode === 'offline') {
      const room = a.roomId ? p.roomById.get(a.roomId) : null;
      if (!room) add('OFFLINE_NO_ROOM', a.key, 'Offline interviews require a physical room.');
      else {
        if (room.isActive === false) add('ROOM_INACTIVE', a.key, `${room.name} is not active.`);
        if (room.capacity < roomNeedFor(round))
          add('ROOM_CAPACITY', a.key, `${room.name} seats ${room.capacity} but ${roomNeedFor(round)} are needed.`);
        const missing = (round.requiredEquipment || []).filter((q) => !(room.equipment || []).includes(q));
        if (missing.length) add('ROOM_EQUIPMENT', a.key, `${room.name} lacks: ${missing.join(', ')}.`);
        for (const b of room.blocked || [])
          if (overlaps(a.start, a.end, b.start, b.end)) add('ROOM_BLOCKED', a.key, `${room.name} is blocked at that time.`);
      }
    } else if (a.roomId) {
      add('ONLINE_HAS_ROOM', a.key, 'Online interviews must not reserve a physical room.');
    }
  }

  // 4/5/6 overlaps (and breaks) against everything
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const x = all[i];
      const y = all[j];
      const fx = assignments.includes(x) && isFocus(x);
      const fy = assignments.includes(y) && isFocus(y);
      if (!fx && !fy) continue;
      const key = fx ? x.key : y.key;
      if (x.candidateId === y.candidateId) {
        if (overlaps(x.start, x.end, y.start, y.end)) add('CANDIDATE_OVERLAP', key, `${name(x.candidateId)} has overlapping interviews.`);
        else if (p.bufferMs && overlaps(x.start, x.end + p.bufferMs, y.start - p.bufferMs, y.end))
          add('CANDIDATE_BUFFER', key, `${name(x.candidateId)} has interviews closer than the required buffer.`);
      }
      if (x.roomId && x.roomId === y.roomId && overlaps(x.start, x.end, y.start, y.end))
        add('ROOM_OVERLAP', key, `Room is double-booked.`);
      for (const id of x.interviewerIds) {
        if (!y.interviewerIds.includes(id)) continue;
        const iv = p.ivById.get(id);
        if (overlaps(x.start, x.end, y.start, y.end)) add('INTERVIEWER_OVERLAP', key, `${name(id)} is double-booked.`);
        else if (iv) {
          const gap = p.gapMs(iv);
          if (gap && overlaps(x.start - gap, x.end + gap, y.start, y.end))
            add('INTERVIEWER_BREAK', key, `${name(id)} does not get the required break between interviews.`);
        }
      }
    }
  }

  // 7 daily capacity
  const counts = new Map();
  for (const s of all) {
    const dk = p.dayKey(s.start);
    for (const id of s.interviewerIds) {
      const k = `${id}|${dk}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of counts) {
    const [id, dk] = k.split('|');
    const iv = p.ivById.get(id);
    if (iv && n > iv.dailyCapacity) {
      const touches = assignments.filter((a) => isFocus(a) && a.interviewerIds.includes(id) && p.dayKey(a.start) === dk);
      for (const a of touches) add('DAILY_CAPACITY', a.key, `${name(id)} exceeds the daily capacity of ${iv.dailyCapacity} on ${dk}.`);
    }
  }

  return { valid: violations.length === 0, violations };
}
