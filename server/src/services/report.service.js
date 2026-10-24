import { stringify } from 'csv-stringify/sync';
import { query } from '../config/database.js';
import { assertDriveAccess } from './drive.service.js';
import { listSessionDetails, presentSession } from './session.service.js';
import { forbidden } from '../utils/httpError.js';
import { csvSafe, fmtWhen } from '../utils/format.js';

const UPCOMING = `s.status IN ('scheduled','in_progress') AND s.ends_at > now()`;

export async function dashboard(user) {
  if (user.role === 'coordinator') {
    const drive = (await query(`SELECT d.id, d.name, d.status, d.timezone, c.name AS company_name FROM recruitment_drives d JOIN companies c ON c.id = d.company_id WHERE d.status <> 'cancelled' ORDER BY d.start_date DESC LIMIT 1`)).rows[0] || null;
    const stats = (await query(
      `SELECT (SELECT count(*)::int FROM recruitment_drives WHERE status NOT IN ('cancelled','completed')) AS active_drives,
              (SELECT count(*)::int FROM users WHERE role = 'candidate' AND is_active) AS candidates,
              (SELECT count(*)::int FROM users WHERE role = 'interviewer' AND is_active) AS interviewers,
              (SELECT count(*)::int FROM interview_sessions s WHERE ${UPCOMING}) AS upcoming,
              (SELECT count(*)::int FROM drive_candidates WHERE pipeline_status IN ('awaiting_booking','needs_rebooking')) AS needs_attention,
              (SELECT count(*)::int FROM interview_sessions WHERE result_status IN ('provisional_pass','provisional_fail')) AS awaiting_review`,
    )).rows[0];
    const upcoming = (await listSessionDetails(null, `${UPCOMING.replace(/s\./g, 's.')} AND s.status <> 'cancelled'`, [])).slice(0, 8).map((r) => presentSession(r, user));
    let pipeline = [];
    let perDay = [];
    let quality = null;
    if (drive) {
      pipeline = (await query('SELECT pipeline_status AS status, count(*)::int AS count FROM drive_candidates WHERE drive_id = $1 GROUP BY 1', [drive.id])).rows;
      perDay = (await query(
        `SELECT to_char((s.starts_at AT TIME ZONE d.timezone)::date, 'YYYY-MM-DD') AS day, s.mode, count(*)::int AS count
           FROM interview_sessions s JOIN recruitment_drives d ON d.id = s.drive_id WHERE s.drive_id = $1 AND s.status <> 'cancelled' GROUP BY 1,2 ORDER BY 1`, [drive.id],
      )).rows;
      quality = (await query('SELECT quality, status, created_at FROM schedule_runs WHERE drive_id = $1 ORDER BY created_at DESC LIMIT 1', [drive.id])).rows[0] || null;
    }
    return { role: 'coordinator', drive, stats: { activeDrives: stats.active_drives, candidates: stats.candidates, interviewers: stats.interviewers, upcoming: stats.upcoming, needsAttention: stats.needs_attention, awaitingReview: stats.awaiting_review }, upcoming, pipeline, perDay, quality };
  }

  if (user.role === 'interviewer') {
    const upcoming = (await listSessionDetails(null, `s.id IN (SELECT session_id FROM interview_assignments WHERE interviewer_id = $1 AND active) AND s.published AND ${UPCOMING}`, [user.id])).map((r) => presentSession(r, user));
    const pending = (await listSessionDetails(null, `s.id IN (SELECT session_id FROM interview_assignments WHERE interviewer_id = $1 AND active) AND s.published AND s.status IN ('scheduled','in_progress','completed') AND s.result_status NOT IN ('passed','failed') AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id AND e.interviewer_id = $1)`, [user.id])).map((r) => presentSession(r, user));
    const done = (await query('SELECT count(*)::int AS n FROM evaluations WHERE interviewer_id = $1', [user.id])).rows[0].n;
    const perDay = (await query(`SELECT to_char((s.starts_at AT TIME ZONE d.timezone)::date, 'YYYY-MM-DD') AS day, count(*)::int AS count FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id JOIN recruitment_drives d ON d.id = s.drive_id WHERE a.interviewer_id = $1 AND a.active AND s.published AND s.status <> 'cancelled' GROUP BY 1 ORDER BY 1`, [user.id])).rows;
    return { role: 'interviewer', stats: { upcoming: upcoming.length, pendingEvaluations: pending.length, submitted: done }, upcoming: upcoming.slice(0, 8), pending: pending.slice(0, 8), perDay };
  }

  if (user.role === 'candidate') {
    const upcoming = (await listSessionDetails(null, `s.candidate_id = $1 AND s.published AND ${UPCOMING}`, [user.id])).map((r) => presentSession(r, user));
    const drives = (await query(
      `SELECT d.id, d.name, c.name AS company_name, dc.pipeline_status, dc.current_round_id, rd.name AS round_name,
              (SELECT count(*)::int FROM interview_rounds WHERE drive_id = d.id) AS total_rounds
         FROM drive_candidates dc JOIN recruitment_drives d ON d.id = dc.drive_id JOIN companies c ON c.id = d.company_id LEFT JOIN interview_rounds rd ON rd.id = dc.current_round_id
        WHERE dc.candidate_id = $1 ORDER BY d.start_date DESC`, [user.id],
    )).rows.map((d) => ({ id: d.id, name: d.name, companyName: d.company_name, status: d.pipeline_status, roundName: d.round_name, totalRounds: d.total_rounds }));
    const hasAvail = (await query('SELECT count(*)::int AS n FROM availability_rules WHERE user_id = $1', [user.id])).rows[0].n > 0;
    return { role: 'candidate', upcoming, drives, hasAvailability: hasAvail };
  }

  const drives = (await query(
    `SELECT d.id, d.name, d.status, d.approval_status, d.start_date, d.end_date,
            (SELECT json_object_agg(s, n) FROM (SELECT pipeline_status AS s, count(*)::int AS n FROM drive_candidates WHERE drive_id = d.id GROUP BY 1) x) AS funnel
       FROM recruitment_drives d WHERE d.company_id = $1 ORDER BY d.start_date DESC`, [user.companyId],
  )).rows.map((d) => ({ id: d.id, name: d.name, status: d.status, approvalStatus: d.approval_status, startDate: d.start_date, endDate: d.end_date, funnel: d.funnel || {} }));
  const upcoming = (await listSessionDetails(null, `s.drive_id IN (SELECT id FROM recruitment_drives WHERE company_id = $1) AND s.published AND ${UPCOMING}`, [user.companyId])).map((r) => presentSession(r, user));
  return { role: 'company', drives, upcoming: upcoming.slice(0, 8), stats: { upcoming: upcoming.length } };
}

export async function driveSummary(user, driveId) {
  const d = await assertDriveAccess(user, driveId);
  if (!['coordinator', 'company'].includes(user.role)) throw forbidden();
  const byRound = (await query(
    `SELECT r.id, r.name, r.position, count(s.id) FILTER (WHERE s.status <> 'cancelled')::int AS scheduled,
            count(s.id) FILTER (WHERE s.result_status = 'passed')::int AS passed, count(s.id) FILTER (WHERE s.result_status = 'failed')::int AS failed,
            avg(s.final_score) AS avg_score
       FROM interview_rounds r LEFT JOIN interview_sessions s ON s.round_id = r.id WHERE r.drive_id = $1 GROUP BY r.id ORDER BY r.position`, [driveId],
  )).rows;
  const funnel = (await query('SELECT pipeline_status AS status, count(*)::int AS count FROM drive_candidates WHERE drive_id = $1 GROUP BY 1', [driveId])).rows;
  const modes = (await query(`SELECT mode, count(*)::int AS count FROM interview_sessions WHERE drive_id = $1 AND status <> 'cancelled' GROUP BY 1`, [driveId])).rows;
  const interviewerLoad = user.role === 'coordinator' ? (await query(
    `SELECT u.name, ip.daily_capacity, count(a.id)::int AS interviews FROM drive_interviewers di JOIN users u ON u.id = di.interviewer_id JOIN interviewer_profiles ip ON ip.user_id = u.id
       LEFT JOIN interview_assignments a ON a.interviewer_id = u.id AND a.active AND a.session_id IN (SELECT id FROM interview_sessions WHERE drive_id = $1)
      WHERE di.drive_id = $1 GROUP BY u.id, ip.user_id ORDER BY u.name`, [driveId],
  )).rows : undefined;
  const roomLoad = user.role === 'coordinator' ? (await query(
    `SELECT r.name, count(s.id)::int AS interviews FROM rooms r LEFT JOIN interview_sessions s ON s.room_id = r.id AND s.status IN ('scheduled','in_progress','completed') WHERE r.drive_id = $1 GROUP BY r.id ORDER BY r.name`, [driveId],
  )).rows : undefined;
  return { drive: { id: d.id, name: d.name, status: d.status }, byRound: byRound.map((r) => ({ ...r, avgScore: r.avg_score })), funnel, modes, interviewerLoad, roomLoad };
}

export async function exportSchedule(user, driveId) {
  const d = await assertDriveAccess(user, driveId);
  if (!['coordinator', 'company'].includes(user.role)) throw forbidden();
  const rows = await listSessionDetails(null, `s.drive_id = $1 AND s.status <> 'cancelled' ${user.role === 'company' ? 'AND s.published' : ''}`, [driveId]);
  const csv = stringify(
    rows.map((r) => ({
      candidate: csvSafe(r.candidate_name),
      email: user.role === 'coordinator' ? csvSafe(r.candidate_email) : '',
      round: r.round_name,
      date_time: fmtWhen(r.starts_at, r.timezone),
      duration_min: r.duration_minutes,
      mode: r.mode,
      room: csvSafe(r.room_name || ''),
      interviewers: csvSafe(r.interviewers.map((i) => i.name).join('; ')),
      status: r.status,
      result: user.role === 'coordinator' || r.result_published ? r.result_status : '',
    })),
    { header: true },
  );
  return { filename: `${d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-schedule.csv`, csv };
}
