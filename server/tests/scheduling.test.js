import test from 'node:test';
import assert from 'node:assert/strict';
import { solveSchedule } from '../src/scheduling/scheduleSolver.js';
import { validateSchedule } from '../src/scheduling/constraintValidator.js';
import { scoreSchedule } from '../src/scheduling/scoreSchedule.js';
import { resolveAvailability } from '../src/scheduling/availability.js';
import { buildDays, covers, zonedToUtcMs, dateKeyInTz } from '../src/scheduling/timeUtils.js';
import { ScheduleState } from '../src/scheduling/core.js';
import { feasibleSlots } from '../src/scheduling/slotGenerator.js';
import { candidate, interviewer, room, round, makeProblem, ids, win, at, fullDays, DAY1, DAY2, TZ, SK } from './helpers/problem.js';

const MIN = 60000;

function overlapFree(list, keyFn) {
  const by = new Map();
  for (const s of list) for (const k of keyFn(s)) {
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  for (const arr of by.values()) {
    arr.sort((a, b) => a.start - b.start);
    for (let i = 1; i < arr.length; i += 1) if (arr[i].start < arr[i - 1].end) return false;
  }
  return true;
}

function standard(n = 20) {
  return makeProblem({
    candidates: ids('c', n).map((id) => candidate(id)),
    interviewers: [interviewer('i1'), interviewer('i2', { modes: 'online_only' }), interviewer('i3', { modes: 'offline_only' })],
  });
}

test('time utils convert wall-clock time in the drive zone', () => {
  const ms = zonedToUtcMs('2030-01-07', '09:00', TZ);
  assert.equal(new Date(ms).toISOString(), '2030-01-07T03:30:00.000Z');
  assert.equal(dateKeyInTz(ms, TZ), '2030-01-07');
  assert.equal(new Date(zonedToUtcMs('2030-07-01', '09:00', 'America/New_York')).toISOString(), '2030-07-01T13:00:00.000Z');
});

test('availability resolver applies rules, additive exceptions and subtractive exceptions', () => {
  const days = buildDays({ startDate: DAY1, endDate: DAY2, dayStart: '09:00', dayEnd: '17:00', timezone: TZ });
  const r = resolveAvailability({
    days,
    timezone: TZ,
    rules: [
      { weekday: 1, startTime: '09:00', endTime: '13:00', kind: 'available' },
      { weekday: 1, startTime: '10:00', endTime: '11:00', kind: 'preferred' },
    ],
    exceptions: [
      { date: DAY1, startTime: '12:00', endTime: '13:00', kind: 'unavailable' },
      { date: DAY2, startTime: '14:00', endTime: '16:00', kind: 'available' },
    ],
  });
  assert.ok(covers(r.available, at(DAY1, '09:00'), at(DAY1, '12:00')));
  assert.ok(!covers(r.available, at(DAY1, '11:30'), at(DAY1, '12:30')), 'unavailable exception must win');
  assert.ok(covers(r.available, at(DAY2, '14:00'), at(DAY2, '16:00')));
  assert.ok(!covers(r.available, at(DAY2, '09:00'), at(DAY2, '09:30')), 'tuesday has no rule');
  assert.ok(covers(r.preferred, at(DAY1, '10:00'), at(DAY1, '11:00')));
});

test('schedules everyone and satisfies every hard constraint (validated independently)', () => {
  const p = standard(20);
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.status, 'complete');
  assert.equal(res.assignments.length, 20);
  const v = validateSchedule(p, res.assignments, { existing: [] });
  assert.deepEqual(v.violations, []);
  assert.ok(overlapFree(res.assignments, (s) => [s.candidateId]), 'no candidate overlaps');
  assert.ok(overlapFree(res.assignments, (s) => s.interviewerIds), 'no interviewer overlaps');
  assert.ok(overlapFree(res.assignments.filter((s) => s.roomId), (s) => [s.roomId]), 'no room overlaps');
});

test('candidate availability and unavailable intervals are respected', () => {
  const cands = [
    candidate('c1', { availability: [win(DAY1, '09:00', '10:00')] }),
    candidate('c2', { availability: [win(DAY1, '15:00', '16:00'), win(DAY2, '09:00', '09:30')] }),
  ];
  const p = makeProblem({ candidates: cands, interviewers: [interviewer('i1')] });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.assignments.length, 2);
  for (const a of res.assignments) assert.ok(covers(p.candById.get(a.candidateId).availability, a.start, a.end));
});

test('interviewers without the required skill are never assigned', () => {
  const p = makeProblem({
    candidates: ids('c', 6).map((id) => candidate(id)),
    interviewers: [interviewer('good'), interviewer('nope', { skills: [SK.HR] })],
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.ok(res.assignments.every((a) => !a.interviewerIds.includes('nope')));
  assert.equal(res.status, 'complete');
});

test('daily capacity is never exceeded and leftovers are explained', () => {
  const p = makeProblem({
    candidates: ids('c', 8).map((id) => candidate(id)),
    interviewers: [interviewer('i1', { dailyCapacity: 2 })],
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.assignments.length, 4); // 2 per day x 2 days
  const perDay = {};
  for (const a of res.assignments) perDay[p.dayKey(a.start)] = (perDay[p.dayKey(a.start)] || 0) + 1;
  assert.ok(Object.values(perDay).every((n) => n <= 2));
  assert.equal(res.unscheduled.length, 4);
  assert.ok(res.unscheduled.every((u) => u.reasons.some((r) => r.code === 'daily_capacity')));
  assert.equal(res.stats.capacityProof.code, 'aggregate_capacity');
  assert.equal(res.status, 'partial');
});

test('panel requirements are satisfied', () => {
  const r = round({ id: 'r1', panelSize: 2, panelRequirements: [{ skillId: SK.SYSDES, minCount: 1 }], requiredSkillIds: [] });
  const p = makeProblem({
    rounds: [r],
    candidates: ids('c', 6).map((id) => candidate(id)),
    interviewers: [
      interviewer('a', { skills: [SK.DSA] }),
      interviewer('b', { skills: [SK.DSA] }),
      interviewer('sd', { skills: [SK.SYSDES] }),
    ],
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.status, 'complete');
  assert.ok(res.assignments.every((a) => a.interviewerIds.length === 2 && a.interviewerIds.includes('sd')));
});

test('offline sessions get a room, online sessions never reserve one', () => {
  const p = standard(15);
  const res = solveSchedule(p, { roundId: 'r1' });
  for (const a of res.assignments) {
    if (a.mode === 'offline') assert.ok(a.roomId, 'offline needs room');
    else assert.equal(a.roomId, null);
  }
  const online = makeProblem({
    candidates: ids('c', 5).map((id) => candidate(id)),
    interviewers: [interviewer('i1', { modes: 'online_only' })],
    rooms: [],
  });
  const r2 = solveSchedule(online, { roundId: 'r1' });
  assert.equal(r2.status, 'complete');
  assert.ok(r2.assignments.every((a) => a.mode === 'online' && a.roomId === null));
});

test('offline preference falls back to online when no room is free', () => {
  const p = makeProblem({
    candidates: ids('c', 3).map((id) => candidate(id, { availability: [win(DAY1, '09:00', '10:00')] })),
    interviewers: [interviewer('i1'), interviewer('i2'), interviewer('i3')],
    rooms: [room('only')],
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.status, 'complete');
  const offline = res.assignments.filter((a) => a.mode === 'offline');
  assert.ok(offline.length >= 1);
  assert.ok(overlapFree(offline, (s) => [s.roomId]));
});

test('mandatory mode policy is never silently overridden', () => {
  const p = makeProblem({
    drive: { modePolicy: 'offline_only' },
    candidates: ids('c', 3).map((id) => candidate(id)),
    interviewers: [interviewer('i1', { modes: 'online_only' })],
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.assignments.length, 0);
  assert.ok(res.unscheduled.every((u) => u.primary === 'mode_policy'));
});

test('conflict explanations name the real blocking constraint', () => {
  // 1. candidate never overlaps with the interviewer
  const p1 = makeProblem({
    candidates: [candidate('c1', { availability: [win(DAY1, '09:00', '12:00')] })],
    interviewers: [interviewer('i1', { availability: [win(DAY1, '13:00', '17:00')] })],
  });
  const r1 = solveSchedule(p1, { roundId: 'r1' });
  assert.equal(r1.unscheduled[0].primary, 'interviewer_unavailable');
  assert.equal(r1.status, 'infeasible');

  // 2. nobody has the skill
  const p2 = makeProblem({ candidates: [candidate('c1')], interviewers: [interviewer('i1', { skills: [SK.HR] })] });
  assert.equal(solveSchedule(p2, { roundId: 'r1' }).unscheduled[0].primary, 'no_qualified_interviewer');

  // 3. offline only and no room
  const p3 = makeProblem({ candidates: [candidate('c1')], interviewers: [interviewer('i1', { modes: 'offline_only' })], rooms: [] });
  assert.equal(solveSchedule(p3, { roundId: 'r1' }).unscheduled[0].primary, 'no_room');

  // 4. candidate gave no availability
  const p4 = makeProblem({ candidates: [candidate('c1', { availability: [] })], interviewers: [interviewer('i1')] });
  assert.equal(solveSchedule(p4, { roundId: 'r1' }).unscheduled[0].primary, 'candidate_no_availability');
});

test('prerequisite rounds are enforced', () => {
  const r1 = round({ id: 'r1' });
  const r2 = round({ id: 'r2', name: 'Technical', prerequisiteRoundId: 'r1' });
  const p = makeProblem({
    rounds: [r1, r2],
    candidates: [candidate('pass'), candidate('nopass')],
    interviewers: [interviewer('i1')],
    passedRounds: new Map([['pass', new Set(['r1'])]]),
  });
  const res = solveSchedule(p, { roundId: 'r2' });
  assert.deepEqual(res.assignments.map((a) => a.candidateId), ['pass']);
  assert.equal(res.unscheduled[0].primary, 'prerequisite_not_met');
});

test('existing bookings and buffers are respected', () => {
  const existing = [
    { key: 'e1', candidateId: 'x', roundId: 'r1', start: at(DAY1, '09:00'), end: at(DAY1, '09:30'), mode: 'online', roomId: null, interviewerIds: ['i1'] },
  ];
  const p = makeProblem({
    drive: { bufferMinutes: 15 },
    candidates: [candidate('c1', { availability: [win(DAY1, '09:00', '10:30')] })],
    interviewers: [interviewer('i1', { modes: 'online_only' })],
    existing,
  });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.assignments.length, 1);
  assert.ok(res.assignments[0].start >= at(DAY1, '09:45'), 'buffer after existing interview');
});

test('schedule quality score is deterministic and never hides violations', () => {
  const p = standard(18);
  const a = solveSchedule(p, { roundId: 'r1' });
  const b = solveSchedule(p, { roundId: 'r1' });
  assert.deepEqual(a.assignments.map((s) => [s.candidateId, s.start, s.interviewerIds, s.roomId]), b.assignments.map((s) => [s.candidateId, s.start, s.interviewerIds, s.roomId]));
  const s1 = scoreSchedule(p, a.assignments, { totalCandidates: 18 });
  const s2 = scoreSchedule(p, b.assignments, { totalCandidates: 18 });
  assert.deepEqual(s1, s2);
  assert.ok(s1.valid && s1.score > 0 && s1.score <= 100);

  const broken = a.assignments.map((s) => ({ ...s }));
  broken[1] = { ...broken[1], start: broken[0].start, end: broken[0].end, candidateId: broken[0].candidateId };
  const bad = scoreSchedule(p, broken, { totalCandidates: 18 });
  assert.equal(bad.valid, false);
  assert.equal(bad.score, 0);
});

test('validator detects injected hard-constraint violations', () => {
  const p = standard(4);
  const base = solveSchedule(p, { roundId: 'r1' }).assignments;
  const codes = (list) => validateSchedule(p, list, { existing: [] }).violations.map((v) => v.code);

  const sameIv = base.map((s) => ({ ...s, interviewerIds: ['i1'], mode: 'online', roomId: null, start: base[0].start, end: base[0].end, candidateId: s.candidateId }));
  assert.ok(codes(sameIv).includes('INTERVIEWER_OVERLAP'));

  const noRoom = [{ ...base[0], mode: 'offline', roomId: null, interviewerIds: ['i1'] }];
  assert.ok(codes(noRoom).includes('OFFLINE_NO_ROOM'));

  const onlineRoom = [{ ...base[0], mode: 'online', roomId: 'A', interviewerIds: ['i2'] }];
  assert.ok(codes(onlineRoom).includes('ONLINE_HAS_ROOM'));

  const wrongMode = [{ ...base[0], mode: 'offline', roomId: 'A', interviewerIds: ['i2'] }];
  assert.ok(codes(wrongMode).includes('MODE_NOT_PERMITTED'));

  const outside = [{ ...base[0], start: at(DAY1, '20:00'), end: at(DAY1, '20:30') }];
  assert.ok(codes(outside).includes('OUTSIDE_WINDOW'));

  const dupRoom = [
    { key: 'a', candidateId: 'c01', roundId: 'r1', start: at(DAY1, '09:00'), end: at(DAY1, '09:30'), mode: 'offline', roomId: 'A', interviewerIds: ['i1'] },
    { key: 'b', candidateId: 'c02', roundId: 'r1', start: at(DAY1, '09:00'), end: at(DAY1, '09:30'), mode: 'offline', roomId: 'A', interviewerIds: ['i3'] },
  ];
  assert.ok(codes(dupRoom).includes('ROOM_OVERLAP'));
});

test('feasible slots only list bookable times', () => {
  const p = makeProblem({
    candidates: [candidate('c1', { availability: [win(DAY1, '09:00', '11:00')] })],
    interviewers: [interviewer('i1', { availability: [win(DAY1, '09:30', '10:30')] })],
  });
  const slots = feasibleSlots(p, p.roundById.get('r1'), p.candById.get('c1'), new ScheduleState(p));
  assert.deepEqual(slots.map((s) => s.start), [at(DAY1, '09:30'), at(DAY1, '10:00')]);
});

test('larger drive (60 candidates, 6 interviewers, 4 rooms) schedules within budget', () => {
  const ivs = [
    interviewer('i1', { modes: 'offline_only', dailyCapacity: 10 }),
    interviewer('i2', { modes: 'online_only', dailyCapacity: 10 }),
    interviewer('i3', { dailyCapacity: 10 }),
    interviewer('i4', { modes: 'both_prefer_online', dailyCapacity: 10 }),
    interviewer('i5', { dailyCapacity: 10, availability: [win(DAY1, '09:00', '13:00')] }),
    interviewer('i6', { dailyCapacity: 10, availability: [win(DAY2, '09:00', '17:00')] }),
  ];
  const cands = ids('c', 60).map((id, i) => candidate(id, { availability: i % 7 === 0 ? [win(DAY2, '09:00', '12:00')] : fullDays() }));
  const p = makeProblem({ candidates: cands, interviewers: ivs, rooms: [room('A'), room('B'), room('C'), room('D')] });
  const res = solveSchedule(p, { roundId: 'r1' });
  assert.equal(res.status, 'complete');
  assert.equal(validateSchedule(p, res.assignments, { existing: [] }).valid, true);
  assert.ok(res.stats.elapsedMs < 4000);
});
