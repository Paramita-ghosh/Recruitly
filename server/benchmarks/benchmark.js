import { solveSchedule } from '../src/scheduling/scheduleSolver.js';
import { validateSchedule } from '../src/scheduling/constraintValidator.js';
import { scoreSchedule } from '../src/scheduling/scoreSchedule.js';
import { candidate, interviewer, room, round, makeProblem, ids, win, DAY1, DAY2, SK } from '../tests/helpers/problem.js';

const RUNS = 5;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function run(name, build, expectNote) {
  const times = [];
  let last;
  for (let i = 0; i < RUNS; i += 1) {
    const { p, roundId } = build();
    const t0 = process.hrtime.bigint();
    last = solveSchedule(p, { roundId });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    last.p = p;
  }
  const v = validateSchedule(last.p, last.assignments);
  const q = scoreSchedule(last.p, last.assignments, { totalCandidates: last.stats.candidates });
  const top = last.unscheduled[0]?.primary || '-';
  return {
    scenario: name, candidates: last.stats.candidates, scheduled: last.stats.scheduled, status: last.status,
    nodes: last.stats.nodes, ms: Math.round(median(times) * 10) / 10, valid: v.valid, score: q.score, topReason: top, note: expectNote,
  };
}

const wide = () => [win(DAY1, '09:00', '17:00'), win(DAY2, '09:00', '17:00')];

function scale(nc, ni, nr) {
  return () => ({
    roundId: 'r1',
    p: makeProblem({
      candidates: ids('c', nc).map((id) => candidate(id)),
      interviewers: ids('i', ni).map((id) => interviewer(id)),
      rooms: ids('R', nr).map((id) => room(id)),
    }),
  });
}

const rows = [];
// --- scale ---
rows.push(run('Scale: 20 cand / 3 iv / 2 rooms', scale(20, 3, 2), 'baseline'));
rows.push(run('Scale: 60 cand / 6 iv / 4 rooms', scale(60, 6, 4), 'demo size'));
rows.push(run('Scale: 150 cand / 10 iv / 6 rooms', scale(150, 10, 6), 'large drive'));
rows.push(run('Scale: 300 cand / 15 iv / 8 rooms', scale(300, 15, 8), 'stress'));

// --- edge cases ---
rows.push(run('Edge: no interviewer has required skill', () => ({
  roundId: 'r1',
  p: makeProblem({ candidates: ids('c', 10).map((id) => candidate(id)), interviewers: [interviewer('i1', { skills: [SK.HR] })] }),
}), 'must report skill conflict'));

rows.push(run('Edge: demand exceeds capacity (30 cand, 1 iv, cap 8/day)', () => ({
  roundId: 'r1',
  p: makeProblem({ candidates: ids('c', 30).map((id) => candidate(id)), interviewers: [interviewer('i1', { dailyCapacity: 8 })] }),
}), 'max 16 placeable'));

rows.push(run('Edge: candidates free only 1 hour, 1 interviewer', () => ({
  roundId: 'r1',
  p: makeProblem({
    candidates: ids('c', 8).map((id) => candidate(id, { availability: [win(DAY1, '10:00', '11:00')] })),
    interviewers: [interviewer('i1')],
  }),
}), 'max 2 placeable'));

rows.push(run('Edge: offline-only policy, zero rooms', () => ({
  roundId: 'r1',
  p: makeProblem({ candidates: ids('c', 10).map((id) => candidate(id)), interviewers: [interviewer('i1')], rooms: [], drive: { modePolicy: 'offline_only' } }),
}), 'must report no room'));

rows.push(run('Edge: panel of 2 but only 1 qualified interviewer', () => ({
  roundId: 'r1',
  p: makeProblem({ candidates: ids('c', 6).map((id) => candidate(id)), interviewers: [interviewer('i1')], rounds: [round({ panelSize: 2 })] }),
}), 'must report panel conflict'));

rows.push(run('Edge: prerequisite round not passed', () => ({
  roundId: 'r2',
  p: makeProblem({
    candidates: ids('c', 6).map((id) => candidate(id)), interviewers: [interviewer('i1')],
    rounds: [round({ id: 'r1' }), round({ id: 'r2', name: 'Round 2', prerequisiteRoundId: 'r1' })],
  }),
}), 'must refuse all'));

rows.push(run('Edge: one room, all offline, 12 cand, 3 iv', () => ({
  roundId: 'r1',
  p: makeProblem({
    candidates: ids('c', 12).map((id) => candidate(id)), interviewers: ids('i', 3).map((id) => interviewer(id)),
    rooms: [room('A')], drive: { modePolicy: 'offline_only' },
  }),
}), 'room is the bottleneck'));

rows.push(run('Edge: tight puzzle (24 cand, exactly 24 slots)', () => ({
  roundId: 'r1',
  p: makeProblem({
    candidates: ids('c', 24).map((id) => candidate(id, { availability: [win(DAY1, '09:00', '12:00')] })),
    interviewers: [interviewer('i1', { availability: [win(DAY1, '09:00', '12:00')], dailyCapacity: 24 }), interviewer('i2', { availability: [win(DAY1, '09:00', '12:00')], dailyCapacity: 24 })],
    rooms: [room('A'), room('B')],
  }),
}), '2 iv x 6 slots = 12 placeable'));

console.table(rows.map(({ scenario, candidates, scheduled, status, nodes, ms, valid, score, topReason }) => ({ scenario, candidates, scheduled, status, nodes, ms, valid, score, topReason })));
console.log(JSON.stringify(rows));