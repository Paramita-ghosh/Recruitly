import env from '../config/env.js';
import { pool, query, withTransaction, lockDrive } from '../config/database.js';
import { loadProblem, ACTIVE_STATUSES } from './loadProblem.js';
import { ScheduleState, candidateStarts, buildOptions, permittedModes } from '../scheduling/core.js';
import { feasibleSlots } from '../scheduling/slotGenerator.js';
import { validateSchedule } from '../scheduling/constraintValidator.js';
import { placeSession, getSessionDetail, presentSession } from './session.service.js';
import { notify } from './notification.service.js';
import { notifySessionParticipants } from './scheduling.service.js';
import { syncSession } from './calendar.service.js';
import { randomToken, hashToken } from '../utils/tokens.js';
import { audit } from '../utils/audit.js';
import { HttpError, notFound, badRequest, conflict } from '../utils/httpError.js';
import { fmtWhen } from '../utils/format.js';
import { MIN } from '../scheduling/timeUtils.js';

const INVALID = 'This booking link is invalid or has expired. Please ask the placement cell for a new one.';
export const SLOT_TAKEN = 'This slot was just booked by someone else. Please select another available time.';

export async function createBookingToken({ candidateId, driveId, roundId }, db = pool) {
  const drive = (await db.query('SELECT end_date, booking_deadline, reschedule_deadline, timezone FROM recruitment_drives WHERE id = $1', [driveId])).rows[0];
  if (!drive) throw notFound('Drive not found');
  const fallback = new Date(`${drive.end_date}T23:59:59Z`).getTime() + 7 * 86400000;
  const expires = new Date(Math.max(fallback, drive.reschedule_deadline ? new Date(drive.reschedule_deadline).getTime() : 0, drive.booking_deadline ? new Date(drive.booking_deadline).getTime() : 0));
  const token = randomToken(32);
  await db.query(`UPDATE booking_tokens SET revoked_at = now() WHERE candidate_id = $1 AND drive_id = $2 AND round_id = $3 AND revoked_at IS NULL`, [candidateId, driveId, roundId]);
  await db.query(`INSERT INTO booking_tokens (token_hash, candidate_id, drive_id, round_id, expires_at) VALUES ($1,$2,$3,$4,$5)`, [hashToken(token), candidateId, driveId, roundId, expires.toISOString()]);
  return { token, url: `${env.FRONTEND_URL}/book/${token}`, expiresAt: expires };
}

export async function revokeBookingToken(token) {
  await query('UPDATE booking_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]);
}

async function resolveToken(db, token, { touch = false } = {}) {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 100) throw new HttpError(404, INVALID, undefined, 'BAD_TOKEN');
  const { rows } = await db.query(
    `SELECT bt.*, u.name AS candidate_name FROM booking_tokens bt JOIN users u ON u.id = bt.candidate_id AND u.is_active WHERE bt.token_hash = $1`,
    [hashToken(token)],
  );
  const t = rows[0];
  if (!t || t.revoked_at || new Date(t.expires_at) < new Date()) throw new HttpError(404, INVALID, undefined, 'BAD_TOKEN');
  if (touch) await db.query('UPDATE booking_tokens SET last_used_at = now() WHERE id = $1', [t.id]);
  return t;
}

async function currentSession(db, candidateId, roundId) {
  const { rows } = await db.query(
    `SELECT id FROM interview_sessions WHERE candidate_id = $1 AND round_id = $2 AND status = ANY($3) ORDER BY created_at DESC LIMIT 1`,
    [candidateId, roundId, [...ACTIVE_STATUSES]],
  );
  return rows[0]?.id || null;
}

export async function getBooking(token) {
  const t = await resolveToken(pool, token, { touch: true });
  const { problem, drive } = await loadProblem(pool, t.drive_id);
  const round = problem.roundById.get(t.round_id);
  if (!round) throw new HttpError(404, INVALID);
  const company = (await query('SELECT name FROM companies WHERE id = $1', [drive.company_id])).rows[0];
  const sid = await currentSession(pool, t.candidate_id, t.round_id);
  const now = Date.now();
  const sessionRow = sid ? await getSessionDetail(null, sid) : null;
  const rescheduleOpen = !drive.reschedule_deadline || new Date(drive.reschedule_deadline).getTime() > now;
  const bookingOpen = !drive.booking_deadline || new Date(drive.booking_deadline).getTime() > now;
  const viewer = { id: t.candidate_id, role: 'candidate' };
  const progress = (
    await query(
      `SELECT r.id, r.name, r.position, s.status, s.result_status, s.result_published, s.starts_at
         FROM interview_rounds r LEFT JOIN interview_sessions s ON s.round_id = r.id AND s.candidate_id = $2 AND s.status <> 'cancelled'
        WHERE r.drive_id = $1 ORDER BY r.position`,
      [t.drive_id, t.candidate_id],
    )
  ).rows.map((r) => ({ id: r.id, name: r.name, position: r.position, status: r.status || 'not_started', result: r.result_published ? r.result_status : null, startsAt: r.starts_at }));
  const confirmed = Boolean(sessionRow?.confirmed_at);
  return {
    candidate: { name: t.candidate_name },
    drive: { id: drive.id, name: drive.name, company: company.name, timezone: drive.timezone, bookingDeadline: drive.booking_deadline, rescheduleDeadline: drive.reschedule_deadline, selfBooking: drive.self_booking_enabled },
    round: { id: round.id, name: round.name, durationMinutes: round.durationMinutes, modes: permittedModes(problem, round), position: round.position },
    session: sessionRow ? { ...presentSession(sessionRow, viewer), confirmed } : null,
    canBook: !sessionRow && drive.self_booking_enabled && bookingOpen,
    canConfirm: Boolean(sessionRow) && !confirmed && sessionRow.status === 'scheduled',
    canReschedule: Boolean(sessionRow) && sessionRow.status === 'scheduled' && sessionRow.result_status === 'pending' && rescheduleOpen && drive.self_booking_enabled,
    deadlines: { bookingOpen, rescheduleOpen },
    progress,
    expiresAt: t.expires_at,
  };
}

export async function getSlots(token) {
  const t = await resolveToken(pool, token);
  const sid = await currentSession(pool, t.candidate_id, t.round_id);
  const { problem, drive } = await loadProblem(pool, t.drive_id, { excludeSessionIds: sid ? [sid] : [] });
  if (!drive.self_booking_enabled) return { days: [], total: 0 };
  const round = problem.roundById.get(t.round_id);
  const cand = problem.candById.get(t.candidate_id);
  if (!round || !cand) throw new HttpError(404, INVALID);
  const slots = feasibleSlots(problem, round, cand, new ScheduleState(problem));
  const byDay = new Map();
  for (const s of slots) {
    if (!byDay.has(s.dayKey)) byDay.set(s.dayKey, []);
    // Resource details (panel, room) are deliberately not exposed before booking.
    byDay.get(s.dayKey).push({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), modes: s.modes, preferredMode: s.best.mode });
  }
  return { timezone: drive.timezone, total: slots.length, days: [...byDay].map(([date, list]) => ({ date, slots: list })) };
}

async function placeBooking(token, { startsAt, mode }, { reschedule = false, ip } = {}) {
  let outcome;
  try {
    outcome = await withTransaction(async (client) => {
      const t = await resolveToken(client, token);
      await lockDrive(client, t.drive_id);
      const sid = await currentSession(client, t.candidate_id, t.round_id);
      const { problem, drive } = await loadProblem(client, t.drive_id, { excludeSessionIds: sid ? [sid] : [] });
      const round = problem.roundById.get(t.round_id);
      const cand = problem.candById.get(t.candidate_id);
      if (!round || !cand) throw new HttpError(404, INVALID);
      if (!drive.self_booking_enabled) throw badRequest('Self-booking is not enabled for this drive.');
      const now = Date.now();
      if (!sid && drive.booking_deadline && new Date(drive.booking_deadline).getTime() < now) throw badRequest('The booking deadline has passed.');
      if (sid && drive.reschedule_deadline && new Date(drive.reschedule_deadline).getTime() < now) throw badRequest('The rescheduling deadline has passed.');
      if (reschedule && !sid) throw badRequest('There is no existing interview to reschedule.');
      if (sid) {
        const cur = (await client.query('SELECT status, result_status FROM interview_sessions WHERE id = $1', [sid])).rows[0];
        if (cur.status !== 'scheduled' || cur.result_status !== 'pending') throw badRequest('This interview can no longer be changed.');
      }

      const start = new Date(startsAt).getTime();
      const state = new ScheduleState(problem);
      if (!candidateStarts(problem, round, cand, state).includes(start)) throw conflict(SLOT_TAKEN, undefined, 'SLOT_TAKEN');
      let options = buildOptions(problem, round, cand, start, state);
      if (mode) options = options.filter((o) => o.mode === mode);
      if (!options.length) throw conflict(SLOT_TAKEN, undefined, 'SLOT_TAKEN');
      const pick = options[0];
      const proposed = { key: `booking:${t.candidate_id}`, candidateId: t.candidate_id, roundId: t.round_id, start, end: start + round.durationMinutes * MIN, mode: pick.mode, roomId: pick.roomId, interviewerIds: pick.interviewerIds };
      const v = validateSchedule(problem, [proposed]);
      if (!v.valid) throw conflict(SLOT_TAKEN, v.violations, 'SLOT_TAKEN');
      const sessionId = await placeSession(client, { driveId: t.drive_id, roundId: t.round_id, candidateId: t.candidate_id, start, end: proposed.end, mode: pick.mode, roomId: pick.roomId, interviewerIds: pick.interviewerIds, source: 'booking', published: true, confirmed: true });
      await client.query(`UPDATE drive_candidates SET pipeline_status = 'scheduled', current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [t.drive_id, t.candidate_id, t.round_id]);
      await audit(client, { actorId: t.candidate_id, action: sid ? 'booking.reschedule' : 'booking.confirm', entityType: 'session', entityId: sessionId, details: { startsAt, mode: pick.mode }, ip });
      return { sessionId, rescheduled: Boolean(sid) };
    });
  } catch (err) {
    if (err.code === '23P01') throw conflict(SLOT_TAKEN, undefined, 'SLOT_TAKEN'); // exclusion constraint = last line of defence
    throw err;
  }
  setImmediate(async () => {
    try {
      await notifySessionParticipants(outcome.sessionId, outcome.rescheduled ? 'rescheduled' : 'booked');
      await syncSession(outcome.sessionId);
    } catch (e) {
      console.error('[booking] post-processing', e.message);
    }
  });
  return outcome;
}

export const confirmBooking = (token, body, ip) => placeBooking(token, body, { ip });
export const rescheduleBooking = (token, body, ip) => placeBooking(token, body, { reschedule: true, ip });

/** Candidate accepts the slot the solver proposed (no change). */
export async function acceptProposed(token, ip) {
  const outcome = await withTransaction(async (client) => {
    const t = await resolveToken(client, token);
    await lockDrive(client, t.drive_id);
    const sid = await currentSession(client, t.candidate_id, t.round_id);
    if (!sid) throw badRequest('There is no proposed interview to confirm.');
    await client.query(`UPDATE interview_sessions SET confirmed_at = COALESCE(confirmed_at, now()), updated_at = now() WHERE id = $1 AND status = 'scheduled'`, [sid]);
    await audit(client, { actorId: t.candidate_id, action: 'booking.accept', entityType: 'session', entityId: sid, ip });
    return { sessionId: sid };
  });
  setImmediate(() => notifySessionParticipants(outcome.sessionId, 'booked').catch(() => {}));
  return outcome;
}

/** Email + in-app invitation to self-book. Returns the new link (shown once, never stored in clear). */
export async function sendBookingInvite({ candidateId, driveId, roundId }) {
  const link = await createBookingToken({ candidateId, driveId, roundId });
  const info = (await query(
    `SELECT d.name AS drive_name, c.name AS company_name, r.name AS round_name, d.booking_deadline, d.timezone FROM recruitment_drives d
       JOIN companies c ON c.id = d.company_id JOIN interview_rounds r ON r.id = $2 WHERE d.id = $1`,
    [driveId, roundId],
  )).rows[0];
  await notify({
    userId: candidateId,
    category: 'booking',
    title: `Choose your ${info.round_name} slot`,
    body: `${info.company_name} – ${info.drive_name}. Pick a time that suits you.`,
    link: `/book/${link.token}`,
    dedupeKey: `invite:${driveId}:${roundId}:${hashToken(link.token).slice(0, 12)}`,
    email: { subject: `Book your ${info.round_name} interview – ${info.company_name}`, intro: 'Please choose a convenient interview slot using the secure link below.', rows: [['Company', info.company_name], ['Round', info.round_name], ['Deadline', info.booking_deadline ? fmtWhen(info.booking_deadline, info.timezone) : 'As soon as possible']], cta: 'Choose my slot' },
  });
  return link;
}

export async function issueLinks(user, driveId, { roundId, candidateIds }) {
  const targets = await query(
    `SELECT dc.candidate_id FROM drive_candidates dc
      WHERE dc.drive_id = $1 AND ($3::uuid[] IS NULL OR dc.candidate_id = ANY($3))
        AND dc.pipeline_status NOT IN ('failed','passed','completed')
        AND NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = dc.candidate_id AND s.round_id = $2 AND s.status = ANY($4))`,
    [driveId, roundId, candidateIds?.length ? candidateIds : null, ACTIVE_STATUSES],
  );
  const links = [];
  for (const r of targets.rows) {
    const l = await sendBookingInvite({ candidateId: r.candidate_id, driveId, roundId });
    await query(`UPDATE drive_candidates SET pipeline_status = 'awaiting_booking', current_round_id = $3, updated_at = now() WHERE drive_id = $1 AND candidate_id = $2 AND pipeline_status IN ('eligible','awaiting_booking')`, [driveId, r.candidate_id, roundId]);
    links.push({ candidateId: r.candidate_id, url: l.url });
  }
  await audit(null, { actorId: user.id, action: 'booking.issue_links', entityType: 'drive', entityId: driveId, details: { roundId, count: links.length } });
  return { issued: links.length, links };
}

/** A signed-in candidate fetches (regenerates) their own link. Ownership is enforced here. */
export async function candidateOwnLink(user, driveId, roundId) {
  const dc = (await query('SELECT current_round_id FROM drive_candidates WHERE drive_id = $1 AND candidate_id = $2', [driveId, user.id])).rows[0];
  if (!dc) throw notFound('You are not part of this drive.');
  const rid = roundId || dc.current_round_id || (await query('SELECT id FROM interview_rounds WHERE drive_id = $1 ORDER BY position LIMIT 1', [driveId])).rows[0]?.id;
  if (!rid) throw notFound('This drive has no rounds yet.');
  return createBookingToken({ candidateId: user.id, driveId, roundId: rid });
}

export async function coordinatorLink(user, { driveId, roundId, candidateId }) {
  const link = await createBookingToken({ candidateId, driveId, roundId });
  await audit(null, { actorId: user.id, action: 'booking.regenerate_link', entityType: 'candidate', entityId: candidateId, details: { driveId, roundId } });
  return link;
}
