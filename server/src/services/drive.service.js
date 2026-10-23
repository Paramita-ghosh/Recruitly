import { pool, query, withTransaction } from '../config/database.js';
import { saveRubric } from './evaluation.service.js';
import { audit } from '../utils/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/httpError.js';

export async function assertDriveAccess(user, driveId, { write = false } = {}) {
  const d = (await query('SELECT * FROM recruitment_drives WHERE id = $1', [driveId])).rows[0];
  if (!d) throw notFound('Drive not found');
  if (user.role === 'coordinator') return d;
  if (user.role === 'company') {
    if (d.company_id !== user.companyId) throw forbidden('This drive belongs to another company.');
    if (write && !['draft', 'collecting_availability'].includes(d.status)) throw forbidden('Only the placement cell can change a drive once scheduling has started.');
    return d;
  }
  if (write) throw forbidden();
  if (user.role === 'interviewer') {
    if (!(await query('SELECT 1 FROM drive_interviewers WHERE drive_id = $1 AND interviewer_id = $2', [driveId, user.id])).rows[0]) throw forbidden();
    return d;
  }
  if (user.role === 'candidate') {
    if (!(await query('SELECT 1 FROM drive_candidates WHERE drive_id = $1 AND candidate_id = $2', [driveId, user.id])).rows[0]) throw forbidden();
    return d;
  }
  throw forbidden();
}

const driveOut = (d) => ({
  id: d.id,
  companyId: d.company_id,
  companyName: d.company_name,
  name: d.name,
  description: d.description,
  status: d.status,
  approvalStatus: d.approval_status,
  timezone: d.timezone,
  startDate: d.start_date,
  endDate: d.end_date,
  dayStart: String(d.day_start).slice(0, 5),
  dayEnd: String(d.day_end).slice(0, 5),
  slotMinutes: d.slot_minutes,
  defaultDurationMinutes: d.default_duration_minutes,
  bufferMinutes: d.buffer_minutes,
  modePolicy: d.mode_policy,
  selfBookingEnabled: d.self_booking_enabled,
  bookingDeadline: d.booking_deadline,
  rescheduleDeadline: d.reschedule_deadline,
  eligibility: d.eligibility,
  isDemo: d.is_demo,
  publishedAt: d.published_at,
  counts: d.counts,
});


export async function listCompanies(user) {
  const { rows } = await query(
    `SELECT c.*, (SELECT count(*)::int FROM recruitment_drives d WHERE d.company_id = c.id) AS drive_count
       FROM companies c WHERE ($1 = 'coordinator' OR c.id = $2) ORDER BY c.kind, c.name`,
    [user.role, user.companyId || null],
  );
  return rows;
}

export async function createCompany(user, b) {
  const { rows } = await query(
    `INSERT INTO companies (name, kind, description, website, industry, location) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.name, b.kind || 'company', b.description || null, b.website || null, b.industry || null, b.location || null],
  );
  await audit(null, { actorId: user.id, action: 'company.create', entityType: 'company', entityId: rows[0].id });
  return rows[0];
}

export async function updateCompany(user, id, b) {
  if (user.role === 'company' && user.companyId !== id) throw forbidden();
  const { rows } = await query(
    `UPDATE companies SET name = COALESCE($2,name), description = COALESCE($3,description), website = COALESCE($4,website),
            industry = COALESCE($5,industry), location = COALESCE($6,location) WHERE id = $1 RETURNING *`,
    [id, b.name ?? null, b.description ?? null, b.website ?? null, b.industry ?? null, b.location ?? null],
  );
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}


const COUNTS = `
  (SELECT json_build_object(
     'candidates', (SELECT count(*)::int FROM drive_candidates WHERE drive_id = d.id),
     'interviewers', (SELECT count(*)::int FROM drive_interviewers WHERE drive_id = d.id),
     'rounds', (SELECT count(*)::int FROM interview_rounds WHERE drive_id = d.id),
     'rooms', (SELECT count(*)::int FROM rooms WHERE drive_id = d.id),
     'sessions', (SELECT count(*)::int FROM interview_sessions WHERE drive_id = d.id AND status NOT IN ('cancelled')),
     'needsAttention', (SELECT count(*)::int FROM drive_candidates WHERE drive_id = d.id AND pipeline_status IN ('awaiting_booking','needs_rebooking')))) AS counts`;

export async function listDrives(user) {
  let where = 'TRUE';
  const params = [];
  if (user.role === 'company') {
    where = 'd.company_id = $1';
    params.push(user.companyId);
  } else if (user.role === 'interviewer') {
    where = 'EXISTS (SELECT 1 FROM drive_interviewers x WHERE x.drive_id = d.id AND x.interviewer_id = $1)';
    params.push(user.id);
  } else if (user.role === 'candidate') {
    where = 'EXISTS (SELECT 1 FROM drive_candidates x WHERE x.drive_id = d.id AND x.candidate_id = $1)';
    params.push(user.id);
  }
  const { rows } = await query(
    `SELECT d.*, c.name AS company_name, ${COUNTS} FROM recruitment_drives d JOIN companies c ON c.id = d.company_id
      WHERE ${where} ORDER BY d.start_date DESC, d.name`,
    params,
  );
  return rows.map(driveOut);
}

export async function getDrive(user, id) {
  await assertDriveAccess(user, id);
  const d = (await query(`SELECT d.*, c.name AS company_name, ${COUNTS} FROM recruitment_drives d JOIN companies c ON c.id = d.company_id WHERE d.id = $1`, [id])).rows[0];
  const rounds = (await query(
    `SELECT r.*, COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name)) FROM round_required_skills rs JOIN skills s ON s.id = rs.skill_id WHERE rs.round_id = r.id), '[]') AS skills,
            COALESCE((SELECT json_agg(json_build_object('skillId', s.id, 'name', s.name, 'minCount', p.min_count)) FROM round_panel_requirements p JOIN skills s ON s.id = p.skill_id WHERE p.round_id = r.id), '[]') AS panel_requirements,
            (SELECT EXISTS (SELECT 1 FROM evaluation_rubrics er WHERE er.round_id = r.id)) AS has_rubric
       FROM interview_rounds r WHERE r.drive_id = $1 ORDER BY r.position`,
    [id],
  )).rows.map((r) => ({
    id: r.id, position: r.position, name: r.name, durationMinutes: r.duration_minutes, panelSize: r.panel_size, allowedModes: r.allowed_modes,
    minRoomCapacity: r.min_room_capacity, requiredEquipment: r.required_equipment, passThreshold: r.pass_threshold, requiresReview: r.requires_review,
    bookingPolicy: r.booking_policy, prerequisiteRoundId: r.prerequisite_round_id, skills: r.skills, panelRequirements: r.panel_requirements, hasRubric: r.has_rubric,
  }));
  const rooms = (await query('SELECT * FROM rooms WHERE drive_id = $1 ORDER BY name', [id])).rows;
  return { ...driveOut(d), rounds, rooms: user.role === 'candidate' ? undefined : rooms };
}

const DEFAULT_PIPELINE = [
  { name: 'Coding Round', duration: 30, panel: 1, skills: ['Coding'], threshold: 60, review: false, policy: 'self_book',
    rubric: [['Problem Solving', 'Approach, correctness and edge cases', 40], ['Code Quality', 'Readability, structure, naming', 40], ['Communication', 'Explains thinking clearly', 20]] },
  { name: 'Technical Interview', duration: 45, panel: 2, skills: ['DSA'], threshold: 65, review: true, policy: 'self_book',
    rubric: [['Technical Depth', 'Fundamentals and domain knowledge', 40], ['System Thinking', 'Design trade-offs and scalability', 35], ['Communication', 'Clarity under questioning', 25]] },
  { name: 'HR Interview', duration: 30, panel: 1, skills: ['HR'], threshold: 60, review: true, policy: 'self_book',
    rubric: [['Culture Fit', 'Values and team collaboration', 40], ['Motivation', 'Interest in role and company', 30], ['Professionalism', 'Maturity and conduct', 30]] },
];

export async function createDrive(user, b, ip) {
  const companyId = user.role === 'company' ? user.companyId : b.companyId;
  if (!companyId) throw badRequest('Choose a company for this drive.');
  const id = await withTransaction(async (client) => {
    const d = (await client.query(
      `INSERT INTO recruitment_drives (company_id, name, description, status, approval_status, timezone, start_date, end_date, day_start, day_end, slot_minutes,
              default_duration_minutes, buffer_minutes, mode_policy, self_booking_enabled, booking_deadline, reschedule_deadline, eligibility, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [companyId, b.name, b.description || null, user.role === 'company' ? 'pending' : 'approved', b.timezone, b.startDate, b.endDate, b.dayStart, b.dayEnd, b.slotMinutes,
        b.defaultDurationMinutes, b.bufferMinutes, b.modePolicy, b.selfBookingEnabled, b.bookingDeadline || null, b.rescheduleDeadline || null, JSON.stringify(b.eligibility || {}), user.id],
    )).rows[0].id;
    if (b.defaultPipeline) {
      const skills = new Map((await client.query('SELECT id, name FROM skills')).rows.map((s) => [s.name, s.id]));
      let prev = null;
      let pos = 1;
      for (const r of DEFAULT_PIPELINE) {
        const rid = (await client.query(
          `INSERT INTO interview_rounds (drive_id, position, name, duration_minutes, panel_size, pass_threshold, requires_review, booking_policy, prerequisite_round_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [d, pos++, r.name, r.duration, r.panel, r.threshold, r.review, r.policy, prev],
        )).rows[0].id;
        for (const s of r.skills) await client.query('INSERT INTO round_required_skills (round_id, skill_id) VALUES ($1,$2)', [rid, skills.get(s)]);
        const rub = (await client.query('INSERT INTO evaluation_rubrics (round_id, name) VALUES ($1,$2) RETURNING id', [rid, `${r.name} rubric`])).rows[0].id;
        let p = 1;
        for (const [name, description, weight] of r.rubric) await client.query('INSERT INTO rubric_criteria (rubric_id, position, name, description, weight) VALUES ($1,$2,$3,$4,$5)', [rub, p++, name, description, weight]);
        prev = rid;
      }
    }
    await audit(client, { actorId: user.id, action: 'drive.create', entityType: 'drive', entityId: d, ip });
    return d;
  });
  return getDrive(user, id);
}

export async function updateDrive(user, id, b, ip) {
  const cur = await assertDriveAccess(user, id, { write: true });
  const map = {
    name: 'name', description: 'description', timezone: 'timezone', startDate: 'start_date', endDate: 'end_date', dayStart: 'day_start', dayEnd: 'day_end', slotMinutes: 'slot_minutes',
    defaultDurationMinutes: 'default_duration_minutes', bufferMinutes: 'buffer_minutes', modePolicy: 'mode_policy', selfBookingEnabled: 'self_booking_enabled',
    bookingDeadline: 'booking_deadline', rescheduleDeadline: 'reschedule_deadline',
  };
  const sets = [];
  const vals = [id];
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) {
      vals.push(b[k]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (b.eligibility !== undefined) {
    vals.push(JSON.stringify(b.eligibility));
    sets.push(`eligibility = $${vals.length}`);
  }
  if (b.status !== undefined) {
    if (user.role !== 'coordinator') throw forbidden('Only the placement cell can change drive status.');
    vals.push(b.status);
    sets.push(`status = $${vals.length}`);
  }
  if (!sets.length) return getDrive(user, id);
  const touchesTime = ['startDate', 'endDate', 'dayStart', 'dayEnd', 'timezone', 'slotMinutes'].some((k) => b[k] !== undefined);
  if (touchesTime && (await query(`SELECT 1 FROM interview_sessions WHERE drive_id = $1 AND status IN ('scheduled','in_progress','completed') LIMIT 1`, [id])).rows[0])
    throw conflict('Interviews already exist for this drive. Cancel them before changing dates, working hours or time zone.');
  await query(`UPDATE recruitment_drives SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  await audit(null, { actorId: user.id, action: 'drive.update', entityType: 'drive', entityId: id, details: { fields: Object.keys(b), from: cur.status }, ip });
  return getDrive(user, id);
}

export async function approveDrive(user, id, approve) {
  const { rows } = await query(`UPDATE recruitment_drives SET approval_status = $2, updated_at = now() WHERE id = $1 RETURNING id`, [id, approve ? 'approved' : 'rejected']);
  if (!rows[0]) throw notFound('Drive not found');
  await audit(null, { actorId: user.id, action: approve ? 'drive.approve' : 'drive.reject', entityType: 'drive', entityId: id });
  return getDrive(user, id);
}

async function writeRoundRelations(client, roundId, b) {
  if (b.skillIds) {
    await client.query('DELETE FROM round_required_skills WHERE round_id = $1', [roundId]);
    for (const s of new Set(b.skillIds)) await client.query('INSERT INTO round_required_skills (round_id, skill_id) VALUES ($1,$2)', [roundId, s]);
  }
  if (b.panelRequirements) {
    await client.query('DELETE FROM round_panel_requirements WHERE round_id = $1', [roundId]);
    for (const p of b.panelRequirements) await client.query('INSERT INTO round_panel_requirements (round_id, skill_id, min_count) VALUES ($1,$2,$3) ON CONFLICT (round_id, skill_id) DO UPDATE SET min_count = $3', [roundId, p.skillId, p.minCount]);
  }
}

export async function createRound(user, driveId, b) {
  await assertDriveAccess(user, driveId, { write: true });
  const id = await withTransaction(async (client) => {
    const pos = b.position ?? (await client.query('SELECT COALESCE(max(position),0)+1 AS p FROM interview_rounds WHERE drive_id = $1', [driveId])).rows[0].p;
    const prev = (await client.query('SELECT id FROM interview_rounds WHERE drive_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1', [driveId, pos])).rows[0];
    const rid = (await client.query(
      `INSERT INTO interview_rounds (drive_id, position, name, duration_minutes, panel_size, allowed_modes, min_room_capacity, required_equipment, pass_threshold, requires_review, booking_policy, prerequisite_round_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [driveId, pos, b.name, b.durationMinutes, b.panelSize, b.allowedModes, b.minRoomCapacity || null, b.requiredEquipment, b.passThreshold, b.requiresReview, b.bookingPolicy, b.prerequisiteRoundId ?? prev?.id ?? null],
    )).rows[0].id;
    await writeRoundRelations(client, rid, b);
    return rid;
  });
  return { id };
}

export async function updateRound(user, roundId, b) {
  const r = (await query('SELECT drive_id FROM interview_rounds WHERE id = $1', [roundId])).rows[0];
  if (!r) throw notFound('Round not found');
  await assertDriveAccess(user, r.drive_id, { write: true });
  const map = { name: 'name', durationMinutes: 'duration_minutes', panelSize: 'panel_size', allowedModes: 'allowed_modes', minRoomCapacity: 'min_room_capacity', requiredEquipment: 'required_equipment', passThreshold: 'pass_threshold', requiresReview: 'requires_review', bookingPolicy: 'booking_policy', prerequisiteRoundId: 'prerequisite_round_id' };
  const sets = [];
  const vals = [roundId];
  for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`); }
  if ((b.durationMinutes !== undefined || b.panelSize !== undefined) && (await query(`SELECT 1 FROM interview_sessions WHERE round_id = $1 AND status IN ('scheduled','in_progress','completed') LIMIT 1`, [roundId])).rows[0])
    throw conflict('Interviews already exist for this round. Cancel them before changing its duration or panel size.');
  await withTransaction(async (client) => {
    if (sets.length) await client.query(`UPDATE interview_rounds SET ${sets.join(', ')} WHERE id = $1`, vals);
    await writeRoundRelations(client, roundId, b);
  });
  return { id: roundId };
}

export async function deleteRound(user, roundId) {
  const r = (await query('SELECT drive_id FROM interview_rounds WHERE id = $1', [roundId])).rows[0];
  if (!r) throw notFound('Round not found');
  await assertDriveAccess(user, r.drive_id, { write: true });
  if ((await query('SELECT 1 FROM interview_sessions WHERE round_id = $1 LIMIT 1', [roundId])).rows[0]) throw conflict('This round already has interviews and cannot be deleted.');
  await query('DELETE FROM interview_rounds WHERE id = $1', [roundId]);
}

export { saveRubric };

export async function listRooms(user, driveId) {
  await assertDriveAccess(user, driveId);
  return (await query(
    `SELECT r.*, COALESCE((SELECT json_agg(json_build_object('id', b.id, 'startsAt', b.starts_at, 'endsAt', b.ends_at, 'reason', b.reason) ORDER BY b.starts_at) FROM room_availability b WHERE b.room_id = r.id), '[]') AS blocks
       FROM rooms r WHERE r.drive_id = $1 ORDER BY r.name`,
    [driveId],
  )).rows;
}

export async function createRoom(user, driveId, b) {
  await assertDriveAccess(user, driveId, { write: true });
  const { rows } = await query(`INSERT INTO rooms (drive_id, name, location, capacity, equipment, accessible) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [driveId, b.name, b.location || null, b.capacity, b.equipment, b.accessible]);
  return rows[0];
}

export async function updateRoom(user, roomId, b) {
  const room = (await query('SELECT drive_id FROM rooms WHERE id = $1', [roomId])).rows[0];
  if (!room) throw notFound('Room not found');
  await assertDriveAccess(user, room.drive_id, { write: true });
  const { rows } = await query(
    `UPDATE rooms SET name = COALESCE($2,name), location = COALESCE($3,location), capacity = COALESCE($4,capacity), equipment = COALESCE($5,equipment),
            accessible = COALESCE($6,accessible), is_active = COALESCE($7,is_active) WHERE id = $1 RETURNING *`,
    [roomId, b.name ?? null, b.location ?? null, b.capacity ?? null, b.equipment ?? null, b.accessible ?? null, b.isActive ?? null],
  );
  return rows[0];
}

export async function addRoomBlock(user, roomId, b) {
  const room = (await query('SELECT drive_id FROM rooms WHERE id = $1', [roomId])).rows[0];
  if (!room) throw notFound('Room not found');
  await assertDriveAccess(user, room.drive_id, { write: true });
  const clash = (await query(`SELECT 1 FROM interview_sessions WHERE room_id = $1 AND status IN ('scheduled','in_progress') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)') LIMIT 1`, [roomId, b.startsAt, b.endsAt])).rows[0];
  if (clash) throw conflict('Interviews are already booked in this room during that period. Reschedule them first.');
  return (await query('INSERT INTO room_availability (room_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING *', [roomId, b.startsAt, b.endsAt, b.reason || null])).rows[0];
}

export async function deleteRoomBlock(user, blockId) {
  const r = (await query('SELECT ra.id, r.drive_id FROM room_availability ra JOIN rooms r ON r.id = ra.room_id WHERE ra.id = $1', [blockId])).rows[0];
  if (!r) throw notFound('Block not found');
  await assertDriveAccess(user, r.drive_id, { write: true });
  await query('DELETE FROM room_availability WHERE id = $1', [blockId]);
}

export async function listDriveCandidates(user, driveId) {
  await assertDriveAccess(user, driveId);
  if (user.role === 'candidate' || user.role === 'interviewer') throw forbidden();
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, cp.reg_no, cp.department, cp.branch, cp.grad_year, dc.pipeline_status, dc.current_round_id, rd.name AS current_round,
            (SELECT count(*)::int FROM availability_rules ar WHERE ar.user_id = u.id) AS availability_rules,
            (SELECT json_build_object('id', s.id, 'startsAt', s.starts_at, 'mode', s.mode, 'status', s.status, 'result', s.result_status, 'score', s.final_score)
               FROM interview_sessions s WHERE s.candidate_id = u.id AND s.drive_id = dc.drive_id AND s.status <> 'cancelled' ORDER BY s.starts_at DESC LIMIT 1) AS latest_session
       FROM drive_candidates dc JOIN users u ON u.id = dc.candidate_id LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       LEFT JOIN interview_rounds rd ON rd.id = dc.current_round_id WHERE dc.drive_id = $1 ORDER BY u.name`,
    [driveId],
  );
  return rows;
}

export async function listDriveInterviewers(user, driveId) {
  await assertDriveAccess(user, driveId);
  if (user.role === 'candidate' || user.role === 'interviewer') throw forbidden();
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, ip.daily_capacity, ip.min_break_minutes, ip.modes, c.name AS company_name,
            COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM interviewer_skills isk JOIN skills s ON s.id = isk.skill_id WHERE isk.user_id = u.id), '[]') AS skills,
            (SELECT count(*)::int FROM availability_rules ar WHERE ar.user_id = u.id) AS availability_rules,
            (SELECT count(*)::int FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id WHERE a.interviewer_id = u.id AND a.active AND s.drive_id = di.drive_id) AS interviews
       FROM drive_interviewers di JOIN users u ON u.id = di.interviewer_id JOIN interviewer_profiles ip ON ip.user_id = u.id LEFT JOIN companies c ON c.id = ip.company_id
      WHERE di.drive_id = $1 ORDER BY u.name`,
    [driveId],
  );
  return rows;
}

export async function addMembers(user, driveId, kind, { ids, all }) {
  const d = await assertDriveAccess(user, driveId, { write: true });
  const role = kind === 'candidates' ? 'candidate' : 'interviewer';
  let list = ids || [];
  if (all) list = (await query('SELECT id FROM users WHERE role = $1 AND is_active', [role])).rows.map((r) => r.id);
  let added = 0;
  await withTransaction(async (client) => {
    for (const uid of list) {
      const ok = (await client.query('SELECT 1 FROM users WHERE id = $1 AND role = $2', [uid, role])).rows[0];
      if (!ok) continue;
      const r = kind === 'candidates'
        ? await client.query('INSERT INTO drive_candidates (drive_id, candidate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [driveId, uid])
        : await client.query('INSERT INTO drive_interviewers (drive_id, interviewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [driveId, uid]);
      added += r.rowCount;
    }
    await audit(client, { actorId: user.id, action: `drive.add_${kind}`, entityType: 'drive', entityId: driveId, details: { added } });
  });
  void d;
  return { added };
}

export async function removeMember(user, driveId, kind, uid) {
  await assertDriveAccess(user, driveId, { write: true });
  if ((await query(`SELECT 1 FROM interview_sessions s LEFT JOIN interview_assignments a ON a.session_id = s.id
                      WHERE s.drive_id = $1 AND s.status IN ('scheduled','in_progress') AND (s.candidate_id = $2 OR a.interviewer_id = $2) LIMIT 1`, [driveId, uid])).rows[0])
    throw conflict('This person has upcoming interviews in the drive. Cancel or reschedule them first.');
  if (kind === 'candidates') await query('DELETE FROM drive_candidates WHERE drive_id = $1 AND candidate_id = $2', [driveId, uid]);
  else await query('DELETE FROM drive_interviewers WHERE drive_id = $1 AND interviewer_id = $2', [driveId, uid]);
}

export async function setCandidateStatus(user, driveId, candidateId, status, note) {
  const r = await query(`UPDATE drive_candidates SET pipeline_status = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2 RETURNING candidate_id`, [driveId, candidateId, status]);
  if (!r.rows[0]) throw notFound('Candidate is not part of this drive');
  await audit(null, { actorId: user.id, action: 'pipeline.override', entityType: 'candidate', entityId: candidateId, details: { driveId, status, note: note || null } });
  return { ok: true };
}

export async function getPipeline(user, driveId) {
  await assertDriveAccess(user, driveId);
  if (!['coordinator', 'company'].includes(user.role)) throw forbidden();
  const { rows } = await query(
    `SELECT u.id AS candidate_id, u.name, u.email, cp.reg_no, cp.branch, dc.pipeline_status, dc.current_round_id, rd.name AS round_name, rd.position AS round_position,
            (SELECT json_build_object('id', s.id, 'startsAt', s.starts_at, 'mode', s.mode, 'status', s.status, 'result', s.result_status, 'score', s.final_score)
               FROM interview_sessions s WHERE s.candidate_id = u.id AND s.drive_id = dc.drive_id AND s.status <> 'cancelled' ORDER BY s.starts_at DESC LIMIT 1) AS session
       FROM drive_candidates dc JOIN users u ON u.id = dc.candidate_id LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       LEFT JOIN interview_rounds rd ON rd.id = dc.current_round_id WHERE dc.drive_id = $1 ORDER BY u.name`,
    [driveId],
  );
  return rows.map((r) => ({
    candidateId: r.candidate_id, name: r.name, email: user.role === 'coordinator' ? r.email : undefined, regNo: r.reg_no, branch: r.branch,
    status: r.pipeline_status, roundId: r.current_round_id, roundName: r.round_name, session: r.session && user.role === 'company' ? { ...r.session, score: undefined } : r.session,
  }));
}

export { pool };
