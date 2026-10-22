// Loads everything the scheduling engine needs for one drive from PostgreSQL and normalises it.
// import { createProblem } from '../scheduling/core.js';
// import { buildDays } from '../scheduling/timeUtils.js';
// import { resolveAvailability } from '../scheduling/availability.js';
import { notFound } from '../utils/httpError.js';

/** Runs promises-in-waiting one after another (a pg transaction client cannot run queries concurrently). */
const lazy = (db, ...args) => () => db.query(...args);
async function sequential(thunks) {
  const out = [];
  for (const t of thunks) out.push(await t());
  return out;
}

export const ACTIVE_STATUSES = ['scheduled', 'in_progress', 'completed', 'no_show'];

export async function loadProblem(db, driveId, { notBefore = Date.now(), excludeSessionIds = [] } = {}) {
  const driveRes = await db.query('SELECT * FROM recruitment_drives WHERE id = $1', [driveId]);
  const drive = driveRes.rows[0];
  if (!drive) throw notFound('Drive not found');
  const tz = drive.timezone;
  const days = buildDays({
    startDate: drive.start_date,
    endDate: drive.end_date,
    dayStart: drive.day_start,
    dayEnd: drive.day_end,
    timezone: tz,
  });

  const [roundsRes, panelRes, candRes, ivRes, roomRes, skillRes] = await sequential([
    lazy(db, 
      `SELECT r.*, COALESCE((SELECT array_agg(skill_id) FROM round_required_skills WHERE round_id = r.id), '{}') AS required_skill_ids
         FROM interview_rounds r WHERE r.drive_id = $1 ORDER BY r.position`,
      [driveId],
    ),
    lazy(db, 
      `SELECT p.round_id, p.skill_id, p.min_count FROM round_panel_requirements p
         JOIN interview_rounds r ON r.id = p.round_id WHERE r.drive_id = $1`,
      [driveId],
    ),
    lazy(db, 
      `SELECT u.id, u.name, u.email, dc.pipeline_status, dc.current_round_id
         FROM drive_candidates dc JOIN users u ON u.id = dc.candidate_id
        WHERE dc.drive_id = $1 AND u.is_active ORDER BY u.id`,
      [driveId],
    ),
    lazy(db, 
      `SELECT u.id, u.name, u.email, ip.daily_capacity, ip.min_break_minutes, ip.modes,
              COALESCE(array_agg(isk.skill_id) FILTER (WHERE isk.skill_id IS NOT NULL), '{}') AS skills
         FROM drive_interviewers di
         JOIN users u ON u.id = di.interviewer_id AND u.is_active
         JOIN interviewer_profiles ip ON ip.user_id = u.id
         LEFT JOIN interviewer_skills isk ON isk.user_id = u.id
        WHERE di.drive_id = $1 GROUP BY u.id, ip.user_id ORDER BY u.id`,
      [driveId],
    ),
    lazy(db, 
      `SELECT r.*, COALESCE(json_agg(json_build_object('s', ra.starts_at, 'e', ra.ends_at)) FILTER (WHERE ra.id IS NOT NULL), '[]') AS blocks
         FROM rooms r LEFT JOIN room_availability ra ON ra.room_id = r.id
        WHERE r.drive_id = $1 GROUP BY r.id ORDER BY r.name`,
      [driveId],
    ),
    lazy(db, 'SELECT id, name FROM skills'),
  ]);

  const userIds = [...candRes.rows.map((c) => c.id), ...ivRes.rows.map((i) => i.id)];
  const [rulesRes, excRes] = await sequential([
    lazy(db, 'SELECT user_id, weekday, start_time, end_time, kind FROM availability_rules WHERE user_id = ANY($1)', [userIds]),
    lazy(db, 'SELECT user_id, date, start_time, end_time, kind FROM availability_exceptions WHERE user_id = ANY($1)', [userIds]),
  ]);
  const rulesBy = new Map();
  const excBy = new Map();
  for (const r of rulesRes.rows) {
    if (!rulesBy.has(r.user_id)) rulesBy.set(r.user_id, []);
    rulesBy.get(r.user_id).push({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time, kind: r.kind });
  }
  for (const x of excRes.rows) {
    if (!excBy.has(x.user_id)) excBy.set(x.user_id, []);
    excBy.get(x.user_id).push({ date: x.date, startTime: x.start_time, endTime: x.end_time, kind: x.kind });
  }
  const resolve = (id) => resolveAvailability({ rules: rulesBy.get(id) || [], exceptions: excBy.get(id) || [], days, timezone: tz });

  const panelBy = new Map();
  for (const r of panelRes.rows) {
    if (!panelBy.has(r.round_id)) panelBy.set(r.round_id, []);
    panelBy.get(r.round_id).push({ skillId: r.skill_id, minCount: r.min_count });
  }
  const rounds = roundsRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    durationMinutes: r.duration_minutes,
    panelSize: r.panel_size,
    allowedModes: r.allowed_modes,
    minRoomCapacity: r.min_room_capacity,
    requiredEquipment: r.required_equipment,
    prerequisiteRoundId: r.prerequisite_round_id,
    requiredSkillIds: r.required_skill_ids,
    panelRequirements: panelBy.get(r.id) || [],
    passThreshold: r.pass_threshold,
    requiresReview: r.requires_review,
    bookingPolicy: r.booking_policy,
  }));

  const candidates = candRes.rows.map((c) => {
    const a = resolve(c.id);
    return { id: c.id, name: c.name, email: c.email, pipelineStatus: c.pipeline_status, currentRoundId: c.current_round_id, availability: a.available, preferred: a.preferred };
  });
  const interviewers = ivRes.rows.map((i) => ({
    id: i.id,
    name: i.name,
    email: i.email,
    skills: i.skills,
    dailyCapacity: i.daily_capacity,
    minBreakMinutes: i.min_break_minutes,
    modes: i.modes,
    availability: resolve(i.id).available,
  }));
  const rooms = roomRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    equipment: r.equipment,
    isActive: r.is_active,
    blocked: r.blocks.map((b) => ({ start: new Date(b.s).getTime(), end: new Date(b.e).getTime() })),
  }));

  // Sessions of this drive plus any session in other drives that involves the same people (read-only context).
  const sessRes = await db.query(
    `SELECT s.id, s.drive_id, s.round_id, s.candidate_id, s.starts_at, s.ends_at, s.mode, s.room_id, s.status, s.result_status,
            COALESCE(array_agg(a.interviewer_id ORDER BY a.interviewer_id) FILTER (WHERE a.id IS NOT NULL), '{}') AS interviewer_ids,
            EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id) AS has_evaluation
       FROM interview_sessions s
       LEFT JOIN interview_assignments a ON a.session_id = s.id AND a.active
      WHERE s.status = ANY($2)
        AND (s.drive_id = $1 OR s.candidate_id = ANY($3)
             OR s.id IN (SELECT session_id FROM interview_assignments WHERE active AND interviewer_id = ANY($4)))
      GROUP BY s.id`,
    [driveId, ACTIVE_STATUSES, candidates.map((c) => c.id), interviewers.map((i) => i.id)],
  );
  const excluded = new Set(excludeSessionIds);
  const existing = sessRes.rows
    .filter((s) => !excluded.has(s.id))
    .map((s) => ({
      key: s.id,
      id: s.id,
      driveId: s.drive_id,
      candidateId: s.candidate_id,
      roundId: s.round_id,
      start: s.starts_at.getTime(),
      end: s.ends_at.getTime(),
      mode: s.mode,
      roomId: s.room_id,
      status: s.status,
      resultStatus: s.result_status,
      interviewerIds: s.interviewer_ids,
      movable: s.drive_id === driveId && s.status === 'scheduled' && s.result_status === 'pending' && !s.has_evaluation && s.starts_at.getTime() > Date.now(),
    }));

  const passedRounds = new Map();
  const prior = new Map();
  for (const s of existing) {
    if (s.driveId !== driveId) continue;
    if (s.resultStatus === 'passed') {
      if (!passedRounds.has(s.candidateId)) passedRounds.set(s.candidateId, new Set());
      passedRounds.get(s.candidateId).add(s.roundId);
    }
    if (!prior.has(s.candidateId)) prior.set(s.candidateId, new Set());
    s.interviewerIds.forEach((id) => prior.get(s.candidateId).add(id));
  }
  for (const c of candidates) c.priorInterviewerIds = [...(prior.get(c.id) || [])];

  const names = {};
  [...candidates, ...interviewers, ...rooms].forEach((x) => {
    names[x.id] = x.name;
  });
  const skillNames = Object.fromEntries(skillRes.rows.map((s) => [s.id, s.name]));

  const problem = createProblem({
    drive: {
      timezone: tz,
      slotMinutes: drive.slot_minutes,
      bufferMinutes: drive.buffer_minutes,
      modePolicy: drive.mode_policy,
      continuity: Boolean(drive.eligibility?.continuity),
    },
    days,
    rounds,
    candidates,
    interviewers,
    rooms,
    existing,
    passedRounds,
    notBefore,
    names,
    skillNames,
  });
  return { problem, drive, rounds };
}

/** Candidates that should be scheduled for a round (no active session for that round, prerequisites met). */
export function targetsForRound(problem, round) {
  const hasSession = new Set(problem.existing.filter((s) => s.roundId === round.id).map((s) => s.candidateId));
  return problem.candidates.filter((c) => {
    if (hasSession.has(c.id)) return false;
    if (['failed', 'passed', 'completed'].includes(c.pipelineStatus)) return false;
    if (round.prerequisiteRoundId && !problem.passedRounds.get(c.id)?.has(round.prerequisiteRoundId)) return false;
    return true;
  });
}
