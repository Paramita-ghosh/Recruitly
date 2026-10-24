import { MIN, covers } from './timeUtils.js';
import { generateStarts, hasAllSkills, eligibleInterviewers, panelSatisfies, permittedModes, pickRoom, roomNeedFor } from './core.js';

const PRIORITY = [
  'prerequisite_not_met',
  'no_qualified_interviewer',
  'insufficient_qualified_interviewers',
  'candidate_no_availability',
  'candidate_no_fit',
  'candidate_conflict',
  'interviewer_unavailable',
  'daily_capacity',
  'interviewer_busy',
  'insufficient_panel',
  'panel_composition',
  'mode_policy',
  'no_room',
  'contention',
];

const SEVERITY = { contention: 'warning' };

function diagnoseStart(p, state, round, s, qualified) {
  const e = s + round.durationMinutes * MIN;
  const avail = qualified.filter((iv) => covers(iv.availability, s, e));
  if (!avail.length) return 'interviewer_unavailable';
  const free = avail.filter((iv) => state.interviewerFree(iv, s, e));
  if (!free.length) return 'interviewer_busy';
  const dk = p.dayKey(s);
  const cap = free.filter((iv) => state.dayCount(iv.id, dk) < iv.dailyCapacity);
  if (!cap.length) return 'daily_capacity';
  if (cap.length < round.panelSize) return 'insufficient_panel';
  const modes = permittedModes(p, round);
  const pool = eligibleInterviewers(p, round, s, e, state);
  const panels = [];
  const rec = (start, cur) => {
    if (cur.length === round.panelSize) {
      if (panelSatisfies(round, cur)) panels.push(cur.slice());
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      cur.push(pool[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  if (!panels.length) return 'panel_composition';
  const modeOk = panels.filter((c) => modes.some((m) => c.every((iv) => iv.modeCfg[m])));
  if (!modeOk.length) return 'mode_policy';
  const hasOnline = modeOk.some((c) => modes.includes('online') && c.every((iv) => iv.modeCfg.online));
  if (!hasOnline) {
    const room = pickRoom(p, round, s, e, state);
    if (!room) return 'no_room';
  }
  return null;
}

export function explainConflict(p, state, cand, round) {
  const name = p.nameOf;
  const skillLabel = (round.requiredSkillIds || []).map((id) => p.skillNames[id] || id).join(', ') || 'the required skills';
  const reasons = [];
  const push = (code, message, slots = 0) => reasons.push({ code, message, slots, severity: SEVERITY[code] || 'blocking' });

  if (round.prerequisiteRoundId && !p.passedRounds.get(cand.id)?.has(round.prerequisiteRoundId)) {
    push('prerequisite_not_met', 'The candidate has not passed the prerequisite round yet.');
    return finish(reasons, true);
  }

  const qualified = p.interviewers.filter((iv) => hasAllSkills(iv, round));
  if (!qualified.length) {
    push('no_qualified_interviewer', `No interviewer in this drive has the required skill(s): ${skillLabel}.`);
    return finish(reasons, true);
  }
  if (qualified.length < round.panelSize) {
    push(
      'insufficient_qualified_interviewers',
      `The round needs a panel of ${round.panelSize} but only ${qualified.length} interviewer(s) have ${skillLabel}.`,
    );
    return finish(reasons, true);
  }
  if (!cand.availability.length) {
    push('candidate_no_availability', 'The candidate has not provided any availability inside the drive dates.');
    return finish(reasons, true);
  }

  const dur = round.durationMinutes * MIN;
  const grid = generateStarts(p, round);
  const fit = grid.filter((s) => covers(cand.availability, s, s + dur));
  if (!fit.length) {
    push(
      'candidate_no_fit',
      `The candidate's availability does not contain any full ${round.durationMinutes}-minute slot within the drive working hours.`,
    );
    return finish(reasons, true);
  }
  const free = fit.filter((s) => state.candidateFree(cand, s, s + dur));
  if (!free.length) {
    push('candidate_conflict', "All of the candidate's available slots clash with their other interviews.", fit.length);
    return finish(reasons, true);
  }

  const counts = new Map();
  for (const s of free) {
    const code = diagnoseStart(p, state, round, s, qualified);
    counts.set(code || 'contention', (counts.get(code || 'contention') || 0) + 1);
  }
  const qNames = qualified.map((iv) => name(iv.id)).join(', ');
  const n = (c) => counts.get(c) || 0;
  if (n('interviewer_unavailable'))
    push('interviewer_unavailable', `No qualified interviewer (${qNames}) is available in ${n('interviewer_unavailable')} of the ${free.length} time slot(s) when the candidate is free.`, n('interviewer_unavailable'));
  if (n('daily_capacity'))
    push('daily_capacity', `All qualified interviewers have reached their daily capacity in ${n('daily_capacity')} of the candidate's available slot(s).`, n('daily_capacity'));
  if (n('interviewer_busy'))
    push('interviewer_busy', `All qualified interviewers are already booked in ${n('interviewer_busy')} of the candidate's available slot(s).`, n('interviewer_busy'));
  if (n('insufficient_panel'))
    push('insufficient_panel', `The round needs ${round.panelSize} interviewers at the same time, but fewer are free in ${n('insufficient_panel')} slot(s).`, n('insufficient_panel'));
  if (n('panel_composition')) {
    const need = (round.panelRequirements || []).map((r) => `${r.minCount}× ${p.skillNames[r.skillId] || r.skillId}`).join(', ');
    push('panel_composition', `No available panel satisfies the required skill combination (${need}) in ${n('panel_composition')} slot(s).`, n('panel_composition'));
  }
  if (n('mode_policy'))
    push('mode_policy', `The permitted interview mode (${permittedModes(p, round).join('/') || 'none'}) is not supported by the available interviewers in ${n('mode_policy')} slot(s).`, n('mode_policy'));
  if (n('no_room'))
    push('no_room', `No suitable physical room (needs capacity ${roomNeedFor(round)}) is free in ${n('no_room')} slot(s) and the available interviewers cannot interview online.`, n('no_room'));
  if (n('contention'))
    push('contention', `Resources were free in ${n('contention')} slot(s) but were allocated to other candidates during optimisation. Adding capacity or relaxing availability would help.`, n('contention'));

  const structural = reasons.some((r) => r.code !== 'contention');
  return finish(reasons, structural && !reasons.some((r) => r.code === 'contention'));
}

function finish(reasons, proven) {
  reasons.sort((a, b) => b.slots - a.slots || PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
  if (reasons.every((r) => r.slots === 0)) reasons.sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
  return { primary: reasons[0]?.code ?? null, proven, reasons };
}
