import { createProblem } from '../../src/scheduling/core.js';
import { buildDays, zonedToUtcMs } from '../../src/scheduling/timeUtils.js';

export const TZ = 'Asia/Kolkata';
export const DAY1 = '2030-01-07'; // Monday
export const DAY2 = '2030-01-08'; // Tuesday
export const SK = { DSA: 1, CODING: 2, SYSDES: 5, HR: 8 };

export const at = (date, hhmm) => zonedToUtcMs(date, hhmm, TZ);
export const win = (date, from, to) => ({ start: at(date, from), end: at(date, to) });
export const fullDays = () => [win(DAY1, '09:00', '17:00'), win(DAY2, '09:00', '17:00')];

export function round(over = {}) {
  return {
    id: 'r1',
    name: 'Coding',
    durationMinutes: 30,
    panelSize: 1,
    allowedModes: ['offline', 'online'],
    requiredSkillIds: [SK.CODING],
    panelRequirements: [],
    requiredEquipment: [],
    prerequisiteRoundId: null,
    ...over,
  };
}

export function interviewer(id, over = {}) {
  return {
    id,
    skills: [SK.CODING, SK.DSA],
    availability: fullDays(),
    dailyCapacity: 8,
    minBreakMinutes: 0,
    modes: 'both_prefer_offline',
    ...over,
  };
}

export function candidate(id, over = {}) {
  return { id, availability: fullDays(), preferred: [], ...over };
}

export function room(id, over = {}) {
  return { id, name: id, capacity: 4, equipment: [], blocked: [], ...over };
}

export function makeProblem({ candidates, interviewers, rooms, rounds, existing = [], drive = {}, passedRounds, notBefore = 0 }) {
  const names = {};
  [...candidates, ...interviewers, ...(rooms || [])].forEach((x) => {
    names[x.id] = x.name || x.id;
  });
  return createProblem({
    drive: { timezone: TZ, slotMinutes: 30, bufferMinutes: 0, modePolicy: 'any', ...drive },
    days: buildDays({ startDate: DAY1, endDate: DAY2, dayStart: '09:00', dayEnd: '17:00', timezone: TZ }),
    rounds: rounds || [round()],
    candidates,
    interviewers,
    rooms: rooms || [room('A'), room('B')],
    existing,
    passedRounds,
    notBefore,
    names,
    skillNames: { 1: 'DSA', 2: 'Coding', 5: 'System Design', 8: 'HR' },
  });
}

export const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
