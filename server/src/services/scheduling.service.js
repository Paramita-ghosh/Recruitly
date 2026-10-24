import env from '../config/env.js';
import { pool, query, withTransaction, lockDrive } from '../config/database.js';
import { loadProblem, targetsForRound, ACTIVE_STATUSES } from './loadProblem.js';
import { solveSchedule } from '../scheduling/scheduleSolver.js';
import { scoreSchedule } from '../scheduling/scoreSchedule.js';
import { validateSchedule } from '../scheduling/constraintValidator.js';
import { ScheduleState, buildOptions, roomNeedFor } from '../scheduling/core.js';
import { placeSession, updateSessionPlacement, listSessionDetails, presentSession, getSessionDetail } from './session.service.js';
import { notify, notifyMany } from './notification.service.js';
import { syncSession } from './calendar.service.js';
import { createBookingToken, sendBookingInvite } from './booking.service.js';
import { emitToRole } from '../realtime/socket.js';
import { audit } from '../utils/audit.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { fmtWhen, iso } from '../utils/format.js';
import { MIN } from '../scheduling/timeUtils.js';

export function validateDriveConfig(problem, round) {
  const errors = [];
  const warnings = [];
  if (!problem.rounds.length) errors.push('Add at least one interview round before generating a schedule.');
  if (!problem.interviewers.length) errors.push('Assign interviewers to this drive.');
  if (!problem.candidates.length) errors.push('Add candidates to this drive.');
  if (round) {
    const qualified = problem.interviewers.filter((iv) => (round.requiredSkillIds || []).every((s) => iv.skillSet.has(s)));
    if (qualified.length < round.panelSize) errors.push(`Round "${round.name}" needs a panel of ${round.panelSize} but only ${qualified.length} interviewer(s) have the required skills.`);
    const needsRooms = (round.allowedModes || []).includes('offline') && problem.drive.modePolicy !== 'online_only';
    if (needsRooms && !problem.rooms.some((r) => r.isActive !== false && r.capacity >= roomNeedFor(round)) && !(round.allowedModes || []).includes('online'))
      errors.push(`Round "${round.name}" is offline-only but no room has capacity for ${roomNeedFor(round)} people.`);
    if (needsRooms && !problem.rooms.length) warnings.push('No rooms configured: offline interviews cannot be scheduled.');
  }
  return { errors, warnings };
}

function toEngineAssignment(row) {
  return {
    key: row.id,
    candidateId: row.candidate_id,
    roundId: row.round_id,
    start: row.starts_at.getTime(),
    end: row.ends_at.getTime(),
    mode: row.mode,
    roomId: row.room_id,
    interviewerIds: row.interviewers.map((i) => i.id),
  };
}

export async function generateSchedule(user, driveId, { roundId, budget } = {}, ip) {
  const result = await withTransaction(async (client) => {
    await lockDrive(client, driveId);
    const first = await client.query('SELECT id FROM interview_rounds WHERE drive_id = $1 ORDER BY position LIMIT 1', [driveId]);
    const rid = roundId || first.rows[0]?.id;
    if (!rid) throw badRequest('Add at least one interview round first.');

    // Replace the previous unpublished solver output for this round; confirmed / booked / published sessions are kept.
    await client.query(
      `DELETE FROM interview_sessions WHERE drive_id = $1 AND round_id = $2 AND source = 'solver' AND published = false
         AND status = 'scheduled' AND result_status = 'pending' AND confirmed_at IS NULL`,
      [driveId, rid],
    );
    const { problem, drive } = await loadProblem(client, driveId);
    const round = problem.roundById.get(rid);
    if (!round) throw notFound('Round not found in this drive');
    const cfg = validateDriveConfig(problem, round);
    if (cfg.errors.length) throw badRequest(cfg.errors[0], cfg.errors);

    const targets = targetsForRound(problem, round);
    const solved = solveSchedule(problem, {
      roundId: rid,
      candidateIds: targets.map((c) => c.id),
      budget: { maxMs: env.SCHEDULER_MAX_MS, maxNodes: env.SCHEDULER_MAX_NODES, ...budget },
    });

    for (const a of solved.assignments) {
      await placeSession(client, { driveId, roundId: rid, candidateId: a.candidateId, start: a.start, end: a.end, mode: a.mode, roomId: a.roomId, interviewerIds: a.interviewerIds, source: 'solver' });
      await client.query(
        `UPDATE drive_candidates SET pipeline_status = 'scheduled', current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`,
        [driveId, a.candidateId, rid],
      );
    }
    for (const u of solved.unscheduled) {
      await client.query(
        `UPDATE drive_candidates SET pipeline_status = CASE WHEN pipeline_status = 'eligible' THEN 'awaiting_booking' ELSE pipeline_status END,
                current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`,
        [driveId, u.candidateId, rid],
      );
    }

    const roundSessions = [...problem.existing.filter((s) => s.driveId === driveId && s.roundId === rid), ...solved.assignments];
    const quality = scoreSchedule(problem, roundSessions, { totalCandidates: targets.length + problem.existing.filter((s) => s.driveId === driveId && s.roundId === rid).length, roundIds: [rid] });
    if (['draft', 'collecting_availability', 'ready_to_schedule'].includes(drive.status)) {
      await client.query(`UPDATE recruitment_drives SET status = 'schedule_generated', updated_at = now() WHERE id = $1`, [driveId]);
    }
    const run = await client.query(
      `INSERT INTO schedule_runs (drive_id, round_id, status, requested_by, stats, quality, unscheduled) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [driveId, rid, solved.status, user.id, JSON.stringify({ ...solved.stats, requested: targets.length }), JSON.stringify(quality), JSON.stringify(solved.unscheduled)],
    );
    await audit(client, { actorId: user.id, action: 'schedule.generate', entityType: 'drive', entityId: driveId, details: { roundId: rid, status: solved.status, scheduled: solved.assignments.length, unscheduled: solved.unscheduled.length, score: quality.score }, ip });
    return {
      runId: run.rows[0].id,
      createdAt: run.rows[0].created_at,
      roundId: rid,
      status: solved.status,
      stats: { ...solved.stats, requested: targets.length },
      quality,
      scheduledCount: solved.assignments.length,
      unscheduled: solved.unscheduled,
      warnings: cfg.warnings,
    };
  });
  emitToRole('coordinator', 'schedule:generated', { driveId, roundId: result.roundId, status: result.status });
  return result;
}

export async function getSchedule(user, driveId, { roundId } = {}) {
  const params = [driveId];
  let where = 's.drive_id = $1 AND s.status <> \'cancelled\'';
  if (roundId) {
    params.push(roundId);
    where += ' AND s.round_id = $2';
  }
  const rows = await listSessionDetails(null, where, params);
  return rows.map((r) => presentSession(r, user));
}

export async function qualityReport(driveId, roundId) {
  const { problem } = await loadProblem(pool, driveId, { notBefore: 0 });
  const rid = roundId || problem.rounds[0]?.id;
  if (!rid) return null;
  const mine = problem.existing.filter((s) => s.driveId === driveId && s.roundId === rid);
  const total = problem.candidates.filter((c) => !['failed'].includes(c.pipelineStatus) || mine.some((s) => s.candidateId === c.id)).length;
  const quality = scoreSchedule(problem, mine, { totalCandidates: Math.max(total, mine.length), roundIds: [rid] });
  const lastRun = (await query('SELECT id, status, stats, created_at FROM schedule_runs WHERE drive_id = $1 AND round_id = $2 ORDER BY created_at DESC LIMIT 1', [driveId, rid])).rows[0];
  return { roundId: rid, quality, lastRun: lastRun || null, sessions: mine.length };
}

export async function latestUnscheduled(driveId, roundId) {
  const rid = roundId || (await query('SELECT id FROM interview_rounds WHERE drive_id = $1 ORDER BY position LIMIT 1', [driveId])).rows[0]?.id;
  if (!rid) return { roundId: null, items: [], runAt: null, status: null };
  const run = (await query('SELECT * FROM schedule_runs WHERE drive_id = $1 AND round_id = $2 ORDER BY created_at DESC LIMIT 1', [driveId, rid])).rows[0];
  if (!run) return { roundId: rid, items: [], runAt: null, status: null };
  // Hide candidates that have since been booked.
  const booked = new Set((await query(`SELECT candidate_id FROM interview_sessions WHERE drive_id = $1 AND round_id = $2 AND status = ANY($3)`, [driveId, rid, ACTIVE_STATUSES])).rows.map((r) => r.candidate_id));
  const items = run.unscheduled.filter((u) => !booked.has(u.candidateId));
  return { roundId: rid, items, runAt: run.created_at, status: run.status, proven: items.filter((i) => i.proven).length };
}

function splitForValidation(problem, driveId) {
  const mine = problem.existing.filter((s) => s.driveId === driveId);
  return {
    assignments: mine.filter((s) => ['scheduled', 'in_progress'].includes(s.status)),
    history: problem.existing.filter((s) => !(s.driveId === driveId && ['scheduled', 'in_progress'].includes(s.status))),
  };
}

export async function validateCurrent(driveId) {
  const { problem } = await loadProblem(pool, driveId, { notBefore: 0 });
  const { assignments, history } = splitForValidation(problem, driveId);
  const v = validateSchedule(problem, assignments, { existing: history });
  return {
    valid: v.valid,
    checked: assignments.length,
    violations: v.violations.map((x) => ({ ...x, session: x.key })),
    checkedAt: new Date().toISOString(),
  };
}

export async function publishSchedule(user, driveId, ip) {
  const published = await withTransaction(async (client) => {
    await lockDrive(client, driveId);
    const { problem, drive } = await loadProblem(client, driveId, { notBefore: 0 });
    const { assignments, history } = splitForValidation(problem, driveId);
    const v = validateSchedule(problem, assignments, { existing: history });
    if (!v.valid) throw conflict('The schedule has hard-constraint violations and cannot be published.', v.violations.slice(0, 20), 'INVALID_SCHEDULE');
    const upd = await client.query(
      `UPDATE interview_sessions SET published = true, updated_at = now() WHERE drive_id = $1 AND status = 'scheduled' AND published = false RETURNING id, candidate_id, round_id`,
      [driveId],
    );
    await client.query(
      `UPDATE recruitment_drives SET status = CASE WHEN status IN ('draft','collecting_availability','ready_to_schedule','schedule_generated') THEN 'published' ELSE status END,
              published_at = COALESCE(published_at, now()), updated_at = now() WHERE id = $1`,
      [driveId],
    );
    await audit(client, { actorId: user.id, action: 'schedule.publish', entityType: 'drive', entityId: driveId, details: { sessions: upd.rows.length }, ip });
    return { rows: upd.rows, drive };
  });

  const ids = published.rows.map((r) => r.id);
  setImmediate(async () => {
    for (const r of published.rows) {
      try {
        const link = await createBookingToken({ candidateId: r.candidate_id, driveId, roundId: r.round_id });
        await notifySessionParticipants(r.id, 'published', { bookingPath: `/book/${link.token}` });
        await syncSession(r.id);
      } catch (e) {
        console.error('[publish] post-processing failed for', r.id, e.message);
      }
    }
    try {
      const open = await query(
        `SELECT dc.candidate_id, dc.current_round_id FROM drive_candidates dc
          WHERE dc.drive_id = $1 AND dc.pipeline_status = 'awaiting_booking' AND dc.current_round_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = dc.candidate_id AND s.round_id = dc.current_round_id AND s.status = ANY($2))`,
        [driveId, ACTIVE_STATUSES],
      );
      for (const o of open.rows) await sendBookingInvite({ candidateId: o.candidate_id, driveId, roundId: o.current_round_id });
    } catch (e) {
      console.error('[publish] booking invites failed', e.message);
    }
  });
  emitToRole('coordinator', 'schedule:published', { driveId, count: ids.length });
  return { published: ids.length };
}

export async function notifySessionParticipants(sessionId, kind, extra = {}) {
  const s = await getSessionDetail(null, sessionId);
  const when = fmtWhen(s.starts_at, s.timezone);
  const where = s.mode === 'offline' ? `${s.room_name || 'Room TBC'}${s.room_location ? `, ${s.room_location}` : ''}` : 'Online';
  const rows = [['Company', s.company_name], ['Round', s.round_name], ['When', `${when} (${s.timezone})`], ['Mode', s.mode === 'offline' ? 'In person' : 'Online'], ['Where', where]];
  const copy = {
    published: { cat: 'schedule', title: 'Your interview is scheduled', body: `${s.round_name} with ${s.company_name} on ${when}.`, subject: `Interview scheduled: ${s.company_name} – ${s.round_name}`, intro: 'Your interview has been scheduled. Please review the details below and confirm or change your slot if needed.' },
    cancelled: { cat: 'cancellation', title: 'Interview cancelled', body: `Your ${s.round_name} interview with ${s.company_name} on ${when} was cancelled.`, subject: `Interview cancelled: ${s.company_name}`, intro: 'This interview has been cancelled.' },
    rescheduled: { cat: 'reschedule', title: 'Interview rescheduled', body: `${s.round_name} with ${s.company_name} is now on ${when}.`, subject: `Interview updated: ${s.company_name} – ${s.round_name}`, intro: 'Your interview details have changed. Please note the new schedule below.' },
    booked: { cat: 'booking', title: 'Booking confirmed', body: `${s.round_name} with ${s.company_name} on ${when}.`, subject: `Booking confirmed: ${s.company_name} – ${s.round_name}`, intro: 'Your interview slot is confirmed.' },
    rebook: { cat: 'reschedule', title: 'Please rebook your interview', body: `Your ${s.round_name} interview with ${s.company_name} needs a new slot.`, subject: `Action needed: rebook your ${s.company_name} interview`, intro: 'We could not keep your original slot. Please choose a new time using your booking link.' },
  }[kind];
  if (!copy) return;
  const candLink = extra.bookingPath || '/candidate/interviews';
  await notify({
    userId: s.candidate_id,
    category: copy.cat,
    title: copy.title,
    body: copy.body,
    link: candLink,
    dedupeKey: `${kind}:${s.id}:v${s.version}:c`,
    email: { subject: copy.subject, intro: copy.intro, rows, cta: kind === 'cancelled' ? 'Open Recruitly' : 'View interview' },
  });
  for (const iv of s.interviewers) {
    await notify({
      userId: iv.id,
      category: copy.cat,
      title: kind === 'published' ? `New interview: ${s.candidate_name}` : `${copy.title}: ${s.candidate_name}`,
      body: `${s.round_name} · ${when} · ${where}`,
      link: `/interviewer/interviews/${s.id}`,
      dedupeKey: `${kind}:${s.id}:v${s.version}:i`,
      email: { subject: `${copy.subject} (${s.candidate_name})`, intro: copy.intro, rows: [['Candidate', s.candidate_name], ...rows], cta: 'View interview' },
    });
  }
}

export async function overrideSession(user, sessionId, body, ip) {
  const updated = await withTransaction(async (client) => {
    const cur = await client.query('SELECT drive_id, round_id, candidate_id, status, result_status FROM interview_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    const sess = cur.rows[0];
    if (!sess) throw notFound('Interview not found');
    await lockDrive(client, sess.drive_id);
    if (!['scheduled', 'needs_rebooking'].includes(sess.status) || sess.result_status !== 'pending') throw badRequest('Only scheduled interviews without results can be overridden.');
    const { problem } = await loadProblem(client, sess.drive_id, { notBefore: 0, excludeSessionIds: [sessionId] });
    const round = problem.roundById.get(sess.round_id);
    const proposed = {
      key: sessionId,
      candidateId: sess.candidate_id,
      roundId: sess.round_id,
      start: new Date(body.startsAt).getTime(),
      end: new Date(body.startsAt).getTime() + round.durationMinutes * MIN,
      mode: body.mode,
      roomId: body.mode === 'offline' ? body.roomId || null : null,
      interviewerIds: [...new Set(body.interviewerIds)].sort(),
    };
    const v = validateSchedule(problem, [proposed]);
    if (!v.valid) throw conflict(`Override rejected: ${v.violations[0].message}`, v.violations, 'OVERRIDE_INVALID');
    await updateSessionPlacement(client, sessionId, { ...proposed, source: 'override' });
    await client.query(`UPDATE interview_sessions SET status = 'scheduled' WHERE id = $1`, [sessionId]);
    await client.query(`UPDATE drive_candidates SET pipeline_status = 'scheduled', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [sess.drive_id, sess.candidate_id]);
    await audit(client, { actorId: user.id, action: 'schedule.override', entityType: 'session', entityId: sessionId, details: { to: proposed, note: body.note || null }, ip });
    return sess;
  });
  setImmediate(async () => {
    try {
      await notifySessionParticipants(sessionId, 'rescheduled');
      await syncSession(sessionId);
    } catch (e) {
      console.error('[override] post-processing', e.message);
    }
  });
  return { ok: true, driveId: updated.drive_id };
}

export async function overrideOptions(sessionId, startsAt) {
  const s = (await query('SELECT drive_id, round_id, candidate_id FROM interview_sessions WHERE id = $1', [sessionId])).rows[0];
  if (!s) throw notFound('Interview not found');
  const { problem } = await loadProblem(pool, s.drive_id, { excludeSessionIds: [sessionId] });
  const round = problem.roundById.get(s.round_id);
  const cand = problem.candById.get(s.candidate_id);
  const state = new ScheduleState(problem);
  const start = new Date(startsAt).getTime();
  const opts = buildOptions(problem, round, cand, start, state, { limit: 12 });
  return opts.map((o) => ({ mode: o.mode, roomId: o.roomId, roomName: o.roomId ? problem.nameOf(o.roomId) : null, interviewerIds: o.interviewerIds, interviewers: o.interviewerIds.map((i) => ({ id: i, name: problem.nameOf(i) })) }));
}

export async function cancelSession(user, sessionId, reason, ip) {
  const s = await withTransaction(async (client) => {
    const r = await client.query('SELECT drive_id, candidate_id, round_id, status FROM interview_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!r.rows[0]) throw notFound('Interview not found');
    if (!['scheduled', 'needs_rebooking'].includes(r.rows[0].status)) throw badRequest('Only upcoming interviews can be cancelled.');
    await client.query(`UPDATE interview_sessions SET status = 'cancelled', version = version + 1, updated_at = now() WHERE id = $1`, [sessionId]);
    await client.query(`UPDATE drive_candidates SET pipeline_status = 'awaiting_booking', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [r.rows[0].drive_id, r.rows[0].candidate_id]);
    await audit(client, { actorId: user.id, action: 'session.cancel', entityType: 'session', entityId: sessionId, details: { reason }, ip });
    return r.rows[0];
  });
  setImmediate(async () => {
    try {
      await notifySessionParticipants(sessionId, 'cancelled');
      await syncSession(sessionId);
    } catch (e) {
      console.error('[cancel] post-processing', e.message);
    }
  });
  return s;
}

export { iso };
