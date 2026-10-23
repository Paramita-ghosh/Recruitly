import { query } from '../config/database.js';
import { iso } from '../utils/format.js';
import { notFound } from '../utils/httpError.js';

/**
 * Create or replace a session for (candidate, round). A row left in `needs_rebooking` is re-used so that
 * history (reschedule changes, tokens) stays attached to one interview.
 */
export async function placeSession(client, s) {
  const { driveId, roundId, candidateId, start, end, mode, roomId, interviewerIds, source = 'solver', published = false, confirmed = false } = s;
  const existing = await client.query(
    `SELECT id FROM interview_sessions WHERE candidate_id = $1 AND round_id = $2 AND status IN ('needs_rebooking','scheduled') FOR UPDATE`,
    [candidateId, roundId],
  );
  let id;
  if (existing.rows[0]) {
    id = existing.rows[0].id;
    await client.query('DELETE FROM interview_assignments WHERE session_id = $1', [id]);
    await client.query(
      `UPDATE interview_sessions SET starts_at = $2, ends_at = $3, mode = $4, room_id = $5, status = 'scheduled', source = $6,
              published = $7, confirmed_at = $8, result_status = 'pending', version = version + 1, updated_at = now() WHERE id = $1`,
      [id, iso(start), iso(end), mode, roomId || null, source, published, confirmed ? new Date().toISOString() : null],
    );
  } else {
    const r = await client.query(
      `INSERT INTO interview_sessions (drive_id, round_id, candidate_id, starts_at, ends_at, mode, room_id, source, published, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [driveId, roundId, candidateId, iso(start), iso(end), mode, roomId || null, source, published, confirmed ? new Date().toISOString() : null],
    );
    id = r.rows[0].id;
  }
  for (const ivId of interviewerIds) {
    await client.query(
      `INSERT INTO interview_assignments (session_id, interviewer_id, during) VALUES ($1,$2,tstzrange($3::timestamptz,$4::timestamptz,'[)'))`,
      [id, ivId, iso(start), iso(end)],
    );
  }
  return id;
}

/** Move/modify an existing session in place (override, reschedule, booking change). */
export async function updateSessionPlacement(client, sessionId, { start, end, mode, roomId, interviewerIds, source }) {
  // Drop the old panel first so the sync trigger never moves a stale assignment into a conflicting slot.
  await client.query('DELETE FROM interview_assignments WHERE session_id = $1', [sessionId]);
  await client.query(
    `UPDATE interview_sessions SET starts_at = $2, ends_at = $3, mode = $4, room_id = $5, source = $6, version = version + 1, updated_at = now() WHERE id = $1`,
    [sessionId, iso(start), iso(end), mode, roomId || null, source],
  );
  for (const ivId of interviewerIds) {
    await client.query(
      `INSERT INTO interview_assignments (session_id, interviewer_id, during) VALUES ($1,$2,tstzrange($3::timestamptz,$4::timestamptz,'[)'))`,
      [sessionId, ivId, iso(start), iso(end)],
    );
  }
}

const DETAIL_SQL = `
  SELECT s.*, d.name AS drive_name, d.timezone, d.company_id, d.created_by AS drive_created_by, d.reschedule_deadline, d.booking_deadline,
         c.name AS company_name, rd.name AS round_name, rd.position AS round_position, rd.duration_minutes, rd.pass_threshold, rd.requires_review,
         cu.name AS candidate_name, cu.email AS candidate_email, rm.name AS room_name, rm.location AS room_location,
         ce.meeting_url, ce.provider AS calendar_provider, ce.sync_status, ce.conference_status, ce.last_error AS calendar_error, ce.external_event_id,
         COALESCE((SELECT json_agg(json_build_object('id', iu.id, 'name', iu.name, 'email', iu.email) ORDER BY iu.name)
                     FROM interview_assignments a JOIN users iu ON iu.id = a.interviewer_id
                    WHERE a.session_id = s.id AND a.active), '[]') AS interviewers
    FROM interview_sessions s
    JOIN recruitment_drives d ON d.id = s.drive_id
    JOIN companies c ON c.id = d.company_id
    JOIN interview_rounds rd ON rd.id = s.round_id
    JOIN users cu ON cu.id = s.candidate_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN calendar_events ce ON ce.session_id = s.id`;

export async function getSessionDetail(db, id) {
  const { rows } = await (db || { query }).query(`${DETAIL_SQL} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw notFound('Interview not found');
  return rows[0];
}

export async function listSessionDetails(db, where, params) {
  const { rows } = await (db || { query }).query(`${DETAIL_SQL} WHERE ${where} ORDER BY s.starts_at, s.id`, params);
  return rows;
}

/** Shape a detail row for API output, removing fields a viewer must not see. */
export function presentSession(row, viewer) {
  const isCoord = viewer.role === 'coordinator';
  const isCandidate = viewer.role === 'candidate';
  const isAssignedIv = viewer.role === 'interviewer' && row.interviewers.some((i) => i.id === viewer.id);
  const isCompany = viewer.role === 'company' && viewer.companyId === row.company_id;
  const showMeeting = isCoord || isAssignedIv || (isCandidate && row.candidate_id === viewer.id) || isCompany;
  const out = {
    id: row.id,
    driveId: row.drive_id,
    driveName: row.drive_name,
    companyName: row.company_name,
    roundId: row.round_id,
    roundName: row.round_name,
    roundPosition: row.round_position,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    mode: row.mode,
    roomId: row.room_id,
    roomName: row.room_name,
    roomLocation: row.room_location,
    status: row.status,
    published: row.published,
    confirmedAt: row.confirmed_at,
    source: row.source,
    version: row.version,
    interviewers: isCandidate ? row.interviewers.map((i) => ({ id: i.id, name: i.name })) : row.interviewers,
    meetingUrl: showMeeting ? row.meeting_url : null,
    meetingIsDemo: row.calendar_provider === 'mock',
    calendar: isCoord
      ? { provider: row.calendar_provider, syncStatus: row.sync_status, conferenceStatus: row.conference_status, error: row.calendar_error }
      : undefined,
  };
  if (isCoord || isAssignedIv) {
    out.candidateEmail = row.candidate_email;
  }
  if (isCoord || isCompany || (isCandidate && row.result_published)) {
    out.resultStatus = row.result_published || isCoord || isCompany ? row.result_status : undefined;
    out.resultPublished = row.result_published;
  }
  if (isCoord) {
    out.finalScore = row.final_score;
    out.resultNote = row.result_note;
  }
  return out;
}
