import test from 'node:test';
import assert from 'node:assert/strict';
import { planReschedule } from '../src/scheduling/rescheduleEngine.js';
import { validateSchedule } from '../src/scheduling/constraintValidator.js';
import { solveSchedule } from '../src/scheduling/scheduleSolver.js';
import { candidate, interviewer, room, makeProblem, ids, win, at, DAY1, DAY2 } from './helpers/problem.js';

const sess = (key, cand, from, ivs, over = {}) => ({
  key,
  candidateId: cand,
  roundId: 'r1',
  start: at(DAY1, from),
  end: at(DAY1, from) + 30 * 60000,
  mode: 'online',
  roomId: null,
  interviewerIds: ivs,
  movable: true,
  ...over,
});

const window1 = { start: at(DAY1, '08:00'), end: at(DAY1, '18:00') };

test('same-slot substitution is tried first and unrelated interviews stay untouched', () => {
  const existing = [
    sess('s1', 'c1', '09:00', ['i1']),
    sess('s2', 'c2', '09:30', ['i2']),
    sess('s3', 'c3', '10:00', ['i1']),
  ];
  const p = makeProblem({
    candidates: [candidate('c1'), candidate('c2'), candidate('c3')],
    interviewers: [interviewer('i1', { modes: 'online_only' }), interviewer('i2', { modes: 'online_only' }), interviewer('i3', { modes: 'online_only' })],
    existing,
  });
  const plan = planReschedule(p, { cancelledInterviewerId: 'i1', window: window1, now: 0 });
  assert.equal(plan.affectedCount, 2);
  assert.equal(plan.changes.length, 2);
  for (const c of plan.changes) {
    assert.equal(c.type, 'interviewer_substituted');
    assert.equal(c.candidateMoved, false);
    assert.equal(c.before.start, c.after.start, 'time is preserved');
    assert.ok(!c.after.interviewerIds.includes('i1'));
  }
  const s2 = plan.finalSessions.find((s) => s.key === 's2');
  assert.deepEqual(s2, existing[1], 'unrelated session unchanged');
  assert.equal(plan.unchangedCount, 1);
  const v = validateSchedule(plan.problem, plan.finalSessions, { existing: [] });
  assert.deepEqual(v.violations, []);
});

test('offline mode and room are preserved where feasible', () => {
  const existing = [sess('s1', 'c1', '09:00', ['i1'], { mode: 'offline', roomId: 'A' })];
  const p = makeProblem({
    candidates: [candidate('c1')],
    interviewers: [interviewer('i1'), interviewer('i2')],
    rooms: [room('A'), room('B')],
    existing,
  });
  const plan = planReschedule(p, { cancelledInterviewerId: 'i1', window: window1 });
  const ch = plan.changes[0];
  assert.equal(ch.modeChanged, false);
  assert.equal(ch.roomChanged, false);
  assert.equal(ch.after.roomId, 'A');
});

test('when no substitute exists the interview moves to the nearest feasible slot', () => {
  const existing = [sess('s1', 'c1', '09:00', ['i1'])];
  const p = makeProblem({
    candidates: [candidate('c1')],
    // only i2 can replace, but only from 09:30 onward the same day
    interviewers: [interviewer('i1', { modes: 'online_only' }), interviewer('i2', { modes: 'online_only', availability: [win(DAY1, '09:30', '12:00')] })],
    existing,
  });
  const plan = planReschedule(p, { cancelledInterviewerId: 'i1', window: { start: at(DAY1, '08:00'), end: at(DAY1, '09:30') } });
  const ch = plan.changes[0];
  assert.equal(ch.type, 'moved');
  assert.equal(ch.after.start, at(DAY1, '09:30'));
  assert.equal(ch.candidateMoved, true);
  assert.deepEqual(validateSchedule(plan.problem, plan.finalSessions, { existing: [] }).violations, []);
});

test('unresolvable interviews are marked needs_rebooking', () => {
  const existing = [sess('s1', 'c1', '09:00', ['i1'])];
  const p = makeProblem({
    candidates: [candidate('c1', { availability: [win(DAY1, '09:00', '09:30')] })],
    interviewers: [interviewer('i1', { modes: 'online_only' })],
    existing,
  });
  const plan = planReschedule(p, { cancelledInterviewerId: 'i1', window: window1 });
  assert.equal(plan.changes[0].type, 'needs_rebooking');
  assert.equal(plan.changes[0].needsManual, true);
  assert.equal(plan.finalSessions.length, 0);
});

test('completed or locked interviews are never moved', () => {
  const existing = [sess('s1', 'c1', '09:00', ['i1'], { movable: false })];
  const p = makeProblem({
    candidates: [candidate('c1')],
    interviewers: [interviewer('i1'), interviewer('i2')],
    existing,
  });
  const plan = planReschedule(p, { cancelledInterviewerId: 'i1', window: window1 });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].type, 'manual_review');
  assert.equal(plan.changes[0].after, null);
  assert.deepEqual(plan.finalSessions.find((s) => s.key === 's1'), existing[0], 'locked interview is untouched');
  assert.equal(plan.finalSessions.length, 1);
});

test('a realistic reschedule after a generated schedule changes as few interviews as possible', () => {
  const ivs = [
    interviewer('i1', { modes: 'offline_only' }),
    interviewer('i2', { modes: 'online_only' }),
    interviewer('i3'),
    interviewer('i4'),
    interviewer('i5'),
  ];
  const cands = ids('c', 14).map((id) => candidate(id));
  const base = makeProblem({ candidates: cands, interviewers: ivs, rooms: [room('A'), room('B'), room('C')] });
  const solved = solveSchedule(base, { roundId: 'r1' });
  assert.equal(solved.status, 'complete');
  const existing = solved.assignments.map((a) => ({ ...a, key: `s-${a.candidateId}`, movable: true }));
  const p = makeProblem({ candidates: cands, interviewers: ivs, rooms: [room('A'), room('B'), room('C')], existing });
  const cancelWindow = { start: at(DAY1, '08:00'), end: at(DAY1, '18:00') };
  const plan = planReschedule(p, { cancelledInterviewerId: 'i3', window: cancelWindow });
  const affected = existing.filter((s) => s.interviewerIds.includes('i3') && s.start >= cancelWindow.start && s.end <= cancelWindow.end);
  assert.equal(plan.affectedCount, affected.length);
  const changedKeys = new Set(plan.changes.map((c) => c.key));
  for (const s of existing) {
    if (!changedKeys.has(s.key)) assert.deepEqual(plan.finalSessions.find((f) => f.key === s.key), s);
  }
  const v = validateSchedule(plan.problem, plan.finalSessions, { existing: [] });
  assert.deepEqual(v.violations, []);
  const moved = plan.changes.filter((c) => c.candidateMoved).length;
  assert.ok(affected.length > 0, 'scenario must affect something');
  assert.ok(moved <= Math.ceil(affected.length / 2), `moved ${moved} of ${affected.length}`);
});
