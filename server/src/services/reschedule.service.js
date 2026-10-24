import { pool, query, withTransaction, lockDrive } from '../config/database.js';
import { loadProblem } from './loadProblem.js';
import { planReschedule } from '../scheduling/rescheduleEngine.js';
import { validateSchedule } from '../scheduling/constraintValidator.js';
import { updateSessionPlacement } from './session.service.js';
import { notify } from './notification.service.js';
import { notifySessionParticipants } from './scheduling.service.js';
import { sendBookingInvite } from './booking.service.js';
import { syncSession } from './calendar.service.js';
import { emitToRole } from '../realtime/socket.js';
import { audit } from '../utils/audit.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { iso, fmtWhen } from '../utils/format.js';
import { zonedToUtcMs, listDates, dateKeyInTz, timeKeyInTz } from '../scheduling/timeUtils.js';

const sig = (changes) => JSON.stringify(changes.map((c) => [c.key, c.type, c.after && [c.after.start, c.after.mode, c.after.roomId, c.after.interviewerIds]]).sort());

const stateJson = (s, p) =>
  s && {
    startsAt: iso(s.start),
    endsAt: iso(s.end),
    mode: s.mode,
    roomId: s.roomId,
    roomName: s.roomId ? p.nameOf(s.roomId) : null,
    interviewers: s.interviewerIds.map((id) => ({ id, name: p.nameOf(id) })),
  };

async function computePlan(db, driveId, { interviewerId, windowStart, windowEnd }) {
  const { problem } = await loadProblem(db, driveId);
  if (!problem.ivById.has(interviewerId)) throw badRequest('That interviewer is not part of this drive.');
  const window = { start: new Date(windowStart).getTime(), end: new Date(windowEnd).getTime() };
  if (!(window.end > window.start)) throw badRequest('The cancellation window is invalid.');
  const plan = planReschedule(problem, { cancelledInterviewerId: interviewerId, window, now: Date.now(), driveId });
  const changedKeys = new Set(plan.changes.filter((c) => c.after).map((c) => c.key));
  const inDrive = plan.finalSessions.filter((s) => s.driveId === driveId || changedKeys.has(s.key));
  const changed = inDrive.filter((s) => changedKeys.has(s.key));
  const others = plan.finalSessions.filter((s) => !changedKeys.has(s.key));
  const v = validateSchedule(plan.problem, changed, { existing: others });
  return { problem, plan, window, validation: v };
}

export async function previewReschedule(user, driveId, input, { exceptionCreated = false } = {}) {
  const { problem, plan, window, validation } = await computePlan(pool, driveId, input);
  const moved = plan.changes.filter((c) => c.candidateMoved && !c.needsManual).length;
  const summary = {
    affected: plan.affectedCount,
    unchanged: plan.unchangedCount,
    substituted: plan.changes.filter((c) => c.type === 'interviewer_substituted').length,
    moved,
    needsRebooking: plan.changes.filter((c) => c.type === 'needs_rebooking').length,
    manualReview: plan.changes.filter((c) => c.type === 'manual_review').length,
    cost: plan.totalCost,
    exceptionCreated,
    signature: sig(plan.changes),
  };
  return withTransaction(async (client) => {
    const run = await client.query(
      `INSERT INTO reschedule_runs (drive_id, interviewer_id, window_start, window_end, reason, valid, summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [driveId, input.interviewerId, iso(window.start), iso(window.end), input.reason || null, validation.valid, JSON.stringify(summary), user.id],
    );
    const runId = run.rows[0].id;
    for (const c of plan.changes) {
      await client.query(
        `INSERT INTO reschedule_changes (run_id, session_id, change_type, before_state, after_state, reason, candidate_moved, interviewer_changed, mode_changed, room_changed, needs_manual, cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [runId, c.key, c.type, JSON.stringify(stateJson(c.before, problem)), c.after ? JSON.stringify(stateJson(c.after, problem)) : null, c.reason, c.candidateMoved, c.interviewerChanged, c.modeChanged, c.roomChanged, c.needsManual, c.cost],
      );
    }
    await audit(client, { actorId: user.id, action: 'reschedule.preview', entityType: 'drive', entityId: driveId, details: { runId, interviewerId: input.interviewerId, ...summary } });
    return getRun(client, runId);
  });
}

export async function getRun(db, runId) {
  const run = (await (db || { query }).query(
    `SELECT r.*, u.name AS interviewer_name FROM reschedule_runs r JOIN users u ON u.id = r.interviewer_id WHERE r.id = $1`,
    [runId],
  )).rows[0];
  if (!run) throw notFound('Reschedule plan not found');
  const changes = (await (db || { query }).query(
    `SELECT rc.*, cu.name AS candidate_name, rd.name AS round_name FROM reschedule_changes rc
       JOIN interview_sessions s ON s.id = rc.session_id JOIN users cu ON cu.id = s.candidate_id JOIN interview_rounds rd ON rd.id = s.round_id
      WHERE rc.run_id = $1 ORDER BY (rc.before_state->>'startsAt'), cu.name`,
    [runId],
  )).rows;
  return {
    id: run.id,
    driveId: run.drive_id,
    interviewer: { id: run.interviewer_id, name: run.interviewer_name },
    windowStart: run.window_start,
    windowEnd: run.window_end,
    reason: run.reason,
    status: run.status,
    valid: run.valid,
    summary: run.summary,
    createdAt: run.created_at,
    approvedAt: run.approved_at,
    changes: changes.map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      candidateName: c.candidate_name,
      roundName: c.round_name,
      type: c.change_type,
      before: c.before_state,
      after: c.after_state,
      reason: c.reason,
      candidateMoved: c.candidate_moved,
      interviewerChanged: c.interviewer_changed,
      modeChanged: c.mode_changed,
      roomChanged: c.room_changed,
      needsManual: c.needs_manual,
      calendarStatus: c.calendar_status,
      notificationStatus: c.notification_status,
      cost: c.cost,
    })),
  };
}

export async function listRuns(driveId) {
  const { rows } = await query(
    `SELECT r.id, r.status, r.valid, r.summary, r.created_at, r.approved_at, u.name AS interviewer_name FROM reschedule_runs r
       JOIN users u ON u.id = r.interviewer_id WHERE r.drive_id = $1 ORDER BY r.created_at DESC LIMIT 30`,
    [driveId],
  );
  return rows.map((r) => ({ id: r.id, status: r.status, valid: r.valid, summary: r.summary, createdAt: r.created_at, approvedAt: r.approved_at, interviewerName: r.interviewer_name }));
}

export async function approveReschedule(user, driveId, runId, ip) {
  let staleRunId = null;
  const applied = await withTransaction(async (client) => {
    await lockDrive(client, driveId);
    const run = (await client.query('SELECT * FROM reschedule_runs WHERE id = $1 AND drive_id = $2 FOR UPDATE', [runId, driveId])).rows[0];
    if (!run) throw notFound('Reschedule plan not found');
    if (run.status !== 'preview') throw badRequest(`This plan has already been ${run.status}.`);
    if (!run.valid) throw conflict('This plan violates hard constraints and cannot be approved.', undefined, 'PLAN_INVALID');

    const fresh = await computePlan(client, driveId, { interviewerId: run.interviewer_id, windowStart: run.window_start, windowEnd: run.window_end });
    if (!fresh.validation.valid || sig(fresh.plan.changes) !== run.summary.signature) {
      await client.query(`UPDATE reschedule_runs SET status = 'discarded' WHERE id = $1`, [runId]);
      staleRunId = runId;
      return null;
    }
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    if (!run.summary.exceptionCreated) {
      const tz = (await client.query('SELECT timezone FROM recruitment_drives WHERE id = $1', [driveId])).rows[0].timezone;
      const ws = new Date(run.window_start).getTime();
      const we = new Date(run.window_end).getTime();
      const days = listDates(dateKeyInTz(ws, tz), dateKeyInTz(we - 1000, tz));
      for (const day of days) {
        const partial = days.length === 1 && timeKeyInTz(ws, tz) !== '00:00' ? { s: timeKeyInTz(ws, tz), e: dateKeyInTz(we, tz) === day ? timeKeyInTz(we, tz) : null } : null;
        const timed = partial && partial.e && partial.e > partial.s;
        await client.query(
          `INSERT INTO availability_exceptions (user_id, date, start_time, end_time, kind, reason) VALUES ($1,$2,$3,$4,'unavailable',$5)`,
          [run.interviewer_id, day, timed ? partial.s : null, timed ? partial.e : null, run.reason || 'Cancelled via reschedule'],
        );
      }
    }
    const touched = [];
    for (const c of fresh.plan.changes) {
      if (c.type === 'manual_review') continue; // reported only; never modified automatically
      const sess = (await client.query('SELECT candidate_id, round_id FROM interview_sessions WHERE id = $1', [c.key])).rows[0];
      if (c.needsManual) {
        await client.query(`UPDATE interview_sessions SET status = 'needs_rebooking', confirmed_at = NULL, version = version + 1, updated_at = now() WHERE id = $1`, [c.key]);
        await client.query(`UPDATE drive_candidates SET pipeline_status = 'needs_rebooking', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [driveId, sess.candidate_id]);
      } else {
        await updateSessionPlacement(client, c.key, { start: c.after.start, end: c.after.end, mode: c.after.mode, roomId: c.after.roomId, interviewerIds: c.after.interviewerIds, source: 'reschedule' });
      }
      touched.push({ ...c, candidateId: sess.candidate_id, roundId: sess.round_id });
    }
    await client.query(`UPDATE reschedule_runs SET status = 'approved', approved_at = now() WHERE id = $1`, [runId]);
    await audit(client, { actorId: user.id, action: 'reschedule.approve', entityType: 'reschedule_run', entityId: runId, details: { changes: touched.length, ...run.summary, signature: undefined }, ip });
    return { run, touched };
  });

  if (!applied) {
    const refreshed = await previewReschedule(user, driveId, await rerunInput(runId));
    throw conflict('The schedule changed since this preview was created. A refreshed preview has been generated for your review.', { runId: refreshed.id }, 'PLAN_STALE');
  }

  const { run, touched } = applied;
  const cancelled = (await query('SELECT name FROM users WHERE id = $1', [run.interviewer_id])).rows[0];
  for (const c of touched) {
    let notif = 'sent';
    let cal = 'not_applied';
    try {
      if (c.needsManual) {
        await notifySessionParticipants(c.key, 'rebook');
        await sendBookingInvite({ candidateId: c.candidateId, driveId, roundId: c.roundId });
      } else {
        await notifySessionParticipants(c.key, 'rescheduled');
      }
    } catch (e) {
      notif = 'failed';
      console.error('[reschedule] notify failed', e.message);
    }
    try {
      const r = await syncSession(c.key);
      cal = r.status;
    } catch (e) {
      cal = 'failed';
    }
    await query('UPDATE reschedule_changes SET calendar_status = $3, notification_status = $4 WHERE run_id = $1 AND session_id = $2', [runId, c.key, cal, notif]);
  }
  await notify({
    userId: run.interviewer_id,
    category: 'reschedule',
    title: 'Your availability change was applied',
    body: `${touched.length} interview(s) were reassigned or moved.`,
    link: '/interviewer/interviews',
    dedupeKey: `resched-iv:${runId}`,
  });
  emitToRole('coordinator', 'reschedule:approved', { driveId, runId });
  void cancelled;
  return getRun(null, runId);
}

async function rerunInput(runId) {
  const r = (await query('SELECT * FROM reschedule_runs WHERE id = $1', [runId])).rows[0];
  return { interviewerId: r.interviewer_id, windowStart: r.window_start, windowEnd: r.window_end, reason: r.reason };
}

export async function discardReschedule(user, driveId, runId) {
  const r = await query(`UPDATE reschedule_runs SET status = 'discarded' WHERE id = $1 AND drive_id = $2 AND status = 'preview' RETURNING id`, [runId, driveId]);
  if (!r.rows[0]) throw notFound('No pending plan to discard');
  await audit(null, { actorId: user.id, action: 'reschedule.discard', entityType: 'reschedule_run', entityId: runId });
}

export async function cancelAvailability(user, interviewerId, { date, startTime, endTime, reason }) {
  const drives = await query(
    `SELECT d.id, d.timezone, d.name FROM drive_interviewers di JOIN recruitment_drives d ON d.id = di.drive_id
      WHERE di.interviewer_id = $1 AND d.status NOT IN ('cancelled','completed')
        AND $2::date BETWEEN d.start_date AND d.end_date`,
    [interviewerId, date],
  );
  await query(
    `INSERT INTO availability_exceptions (user_id, date, start_time, end_time, kind, reason) VALUES ($1,$2,$3,$4,'unavailable',$5)`,
    [interviewerId, date, startTime || null, endTime || null, reason || 'Cancelled availability'],
  );
  const plans = [];
  for (const d of drives.rows) {
    const start = zonedToUtcMs(date, startTime || '00:00', d.timezone);
    const end = startTime ? zonedToUtcMs(date, endTime, d.timezone) : zonedToUtcMs(date, '23:59', d.timezone) + 60000;
    const run = await previewReschedule(user, d.id, { interviewerId, windowStart: iso(start), windowEnd: iso(end), reason }, { exceptionCreated: true });
    plans.push({ driveId: d.id, driveName: d.name, runId: run.id, summary: run.summary, valid: run.valid });
    if (run.summary.affected > 0) {
      const coords = await query(`SELECT id FROM users WHERE role = 'coordinator' AND is_active`);
      for (const c of coords.rows) {
        await notify({
          userId: c.id,
          category: 'reschedule',
          title: `${run.interviewer.name} cancelled availability`,
          body: `${run.summary.affected} interview(s) affected in ${d.name}. Review the proposed minimal-disruption plan.`,
          link: `/coordinator/drives/${d.id}/reschedule?run=${run.id}`,
          dedupeKey: `cancel-avail:${run.id}`,
        });
      }
    }
  }
  await audit(null, { actorId: user.id, action: 'availability.cancel', entityType: 'user', entityId: interviewerId, details: { date, startTime, endTime, reason, plans: plans.length } });
  void fmtWhen;
  return { recorded: true, plans };
}
