import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prepareTestEnv, Api } from './helpers/testdb.js';

await prepareTestEnv();
const { createApp } = await import('../src/app.js');
const { seedDemo } = await import('../src/db/seed.js');
const { query, pool, closePool } = await import('../src/config/database.js');
const { createBookingToken } = await import('../src/services/booking.service.js');

let server;
let base;
let seed;
let driveId;
const coord = () => new Api(base);
const as = async (email) => {
  const a = new Api(base);
  await a.login(email);
  return a;
};
const tokenOf = (url) => url.split('/book/')[1];

before(async () => {
  seed = await seedDemo({ reset: true, quiet: true });
  driveId = seed.driveId;
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

test('authentication, CSRF and role checks', async () => {
  const anon = new Api(base);
  assert.equal((await anon.get('/api/drives')).status, 401);
  const bad = await anon.post('/api/auth/login', { email: 'demo.coordinator@recruitly.demo', password: 'wrong-password1' });
  assert.equal(bad.status, 401);
  assert.ok(!JSON.stringify(bad.body).includes('password_hash'));

  const c = await as('demo.coordinator@recruitly.demo');
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.role, 'coordinator');

  const noHeader = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: c.cookie } });
  assert.equal(noHeader.status, 403);

  const cand = await as('demo.candidate01@recruitly.demo');
  assert.equal((await cand.get('/api/users?role=candidate')).status, 403);
  assert.equal((await cand.post(`/api/drives/${driveId}/schedules/generate`, {})).status, 403);

  const reg = new Api(base);
  const r = await reg.post('/api/auth/register', { name: 'Eve Attacker', email: 'eve@example.com', password: 'Passw0rdX1', role: 'coordinator' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'candidate');
  assert.equal((await reg.get('/api/imports/templates/candidates')).status, 403);

  const orbit = await as('demo.recruiter@orbit.demo');
  assert.equal((await orbit.get(`/api/drives/${driveId}`)).status, 403);
  const list = await orbit.get('/api/drives');
  assert.ok(list.data.every((d) => d.companyName === 'Orbit Systems'));
  assert.equal((await orbit.get(`/api/drives/${driveId}/rankings`)).status, 403);
  const nw = await as('demo.company@northwind.demo');
  assert.equal((await nw.get(`/api/drives/${driveId}`)).status, 200);
});

test('database constraints reject overlapping reservations and invalid rubric weights', async () => {
  const s = (await query(`SELECT * FROM interview_sessions WHERE status = 'scheduled' AND room_id IS NOT NULL LIMIT 1`)).rows[0];
  const other = (await query(`SELECT id FROM users WHERE role = 'candidate' AND id <> $1 LIMIT 1`, [s.candidate_id])).rows[0];
  const round = (await query(`SELECT id FROM interview_rounds WHERE drive_id = $1 AND position = 3`, [driveId])).rows[0];
  await assert.rejects(
    query(`INSERT INTO interview_sessions (drive_id, round_id, candidate_id, starts_at, ends_at, mode, room_id) VALUES ($1,$2,$3,$4,$5,'offline',$6)`, [s.drive_id, round.id, other.id, new Date(s.starts_at.getTime() + 60000), new Date(s.ends_at.getTime() + 60000), s.room_id]),
    (e) => e.code === '23P01',
    'overlapping room booking must violate the exclusion constraint',
  );
  const rub = (await query('SELECT id FROM evaluation_rubrics LIMIT 1')).rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO rubric_criteria (rubric_id, name, weight) VALUES ($1,'Extra',10)`, [rub.id]);
    await assert.rejects(client.query('COMMIT'), /weights must total 100/);
  } finally {
    client.release();
  }
});

test('generated schedule is valid, explained and independently verified', async () => {
  const c = await as('demo.coordinator@recruitly.demo');
  const sched = (await c.get(`/api/drives/${driveId}/schedules`)).data;
  assert.ok(sched.length >= 56, `expected most candidates scheduled, got ${sched.length}`);
  const v = (await c.post(`/api/drives/${driveId}/schedules/validate`)).data;
  assert.equal(v.valid, true, JSON.stringify(v.violations.slice(0, 3)));

  const q = (await c.get(`/api/drives/${driveId}/schedules/quality`)).data;
  assert.equal(q.quality.valid, true);
  assert.ok(q.quality.score > 50 && q.quality.score <= 100);
  assert.equal(Object.keys(q.quality.components).length, 6);

  const un = (await c.get(`/api/drives/${driveId}/unscheduled`)).data;
  const byName = Object.fromEntries(un.items.map((i) => [i.name, i]));
  assert.equal(byName['Zoya Khan'].primary, 'candidate_no_availability');
  assert.equal(byName['Tanvi Arora'].primary, 'candidate_no_fit');
  assert.ok(un.items.every((i) => i.reasons.length > 0 && typeof i.reasons[0].message === 'string'));

  const dup = await query(`SELECT count(*)::int AS n FROM interview_assignments a JOIN interview_assignments b ON a.interviewer_id = b.interviewer_id AND a.id < b.id AND a.active AND b.active AND a.during && b.during`);
  assert.equal(dup.rows[0].n, 0, 'no interviewer overlaps');
  const rooms = await query(`SELECT count(*)::int AS n FROM interview_sessions a JOIN interview_sessions b ON a.room_id = b.room_id AND a.id < b.id AND a.status IN ('scheduled','completed') AND b.status IN ('scheduled','completed') AND a.during && b.during`);
  assert.equal(rooms.rows[0].n, 0, 'no room overlaps');
  const cap = await query(`SELECT count(*)::int AS n FROM (SELECT a.interviewer_id, (s.starts_at AT TIME ZONE 'Asia/Kolkata')::date AS d, count(*) AS c FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id WHERE a.active GROUP BY 1,2) x JOIN interviewer_profiles ip ON ip.user_id = x.interviewer_id WHERE x.c > ip.daily_capacity`);
  assert.equal(cap.rows[0].n, 0, 'daily capacity respected');
  const mode = await query(`SELECT count(*)::int AS n FROM interview_sessions WHERE status = 'scheduled' AND ((mode = 'online' AND room_id IS NOT NULL) OR (mode = 'offline' AND room_id IS NULL))`);
  assert.equal(mode.rows[0].n, 0, 'offline has room, online has none');
  const skill = await query(`SELECT count(*)::int AS n FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id JOIN round_required_skills rs ON rs.round_id = s.round_id
    WHERE a.active AND NOT EXISTS (SELECT 1 FROM interviewer_skills k WHERE k.user_id = a.interviewer_id AND k.skill_id = rs.skill_id)`);
  assert.equal(skill.rows[0].n, 0, 'required skills satisfied');

  const panels = await query(`SELECT s.id FROM interview_sessions s JOIN interview_rounds r ON r.id = s.round_id WHERE r.name = 'Technical Interview' AND s.status IN ('scheduled','in_progress','completed')
    AND NOT EXISTS (SELECT 1 FROM interview_assignments a JOIN interviewer_skills k ON k.user_id = a.interviewer_id JOIN skills sk ON sk.id = k.skill_id WHERE a.session_id = s.id AND sk.name = 'System Design')`);
  assert.equal(panels.rows.length, 0);
});

test('coordinator override re-validates hard constraints', async () => {
  const c = await as('demo.coordinator@recruitly.demo');
  const s = (await query(`SELECT s.id, s.starts_at, s.mode, s.room_id, (SELECT array_agg(interviewer_id) FROM interview_assignments WHERE session_id = s.id AND active) AS ivs
    FROM interview_sessions s WHERE s.round_id = (SELECT id FROM interview_rounds WHERE drive_id = $1 AND position = 1) AND s.status = 'scheduled' AND s.result_status = 'pending' AND s.mode = 'online' LIMIT 1`, [driveId])).rows[0];
  const r = await c.patch(`/api/sessions/${s.id}/override`, { startsAt: new Date(s.starts_at.getTime() - 8 * 3600000).toISOString(), mode: 'online', interviewerIds: s.ivs });
  assert.equal(r.status, 409);
  const hr = (await query(`SELECT id FROM users WHERE email = 'demo.iv5@recruitly.demo'`)).rows[0];
  const r2 = await c.patch(`/api/sessions/${s.id}/override`, { startsAt: new Date(s.starts_at).toISOString(), mode: 'online', interviewerIds: [hr.id] });
  assert.equal(r2.status, 409);
  assert.match(r2.body.error.message, /skill|mode|available/i);
});

test('candidate sees only their own published interview; ICS and calendar status are honest', async () => {
  const a = await as('demo.candidate01@recruitly.demo');
  const mine = (await a.get('/api/interviews')).data;
  assert.ok(mine.length >= 1 && mine.every((i) => i.candidateId === mine[0].candidateId));
  const iv = mine[0];
  const other = (await query(`SELECT s.id FROM interview_sessions s WHERE s.candidate_id <> $1 AND s.published LIMIT 1`, [iv.candidateId])).rows[0];
  assert.equal((await a.get(`/api/interviews/${other.id}`)).status, 403);
  assert.equal((await a.get(`/api/interviews/${other.id}/ics`)).status, 403);

  const ics = await a.get(`/api/interviews/${iv.id}/ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.body, /BEGIN:VCALENDAR/);
  assert.match(ics.body, new RegExp(`UID:interview-${iv.id}@recruitly`));

  const n = (await a.get('/api/notifications')).data;
  assert.ok(n.unread > 0 && n.items.some((x) => x.category === 'schedule'));
  await a.patch(`/api/notifications/${n.items[0].id}/read`);
  assert.equal((await a.get('/api/notifications')).data.unread, n.unread - 1);

  const rows = await query(`SELECT provider, sync_status, conference_status, meeting_url, mode FROM calendar_events ce JOIN interview_sessions s ON s.id = ce.session_id`);
  assert.ok(rows.rows.length > 0);
  assert.ok(rows.rows.every((r) => r.provider === 'mock' && r.sync_status === 'mock'));
  assert.ok(rows.rows.filter((r) => r.mode === 'online').every((r) => r.conference_status === 'mock' && r.meeting_url.includes('/demo-meeting/')));
  assert.ok(rows.rows.every((r) => !String(r.meeting_url || '').includes('meet.google.com')));
  const emails = await query(`SELECT status, count(*)::int AS n FROM email_outbox GROUP BY 1`);
  assert.ok(emails.rows.every((e) => e.status !== 'sent'), 'emails are never reported as sent without SMTP');
});

test('self-booking: token security, valid slots, booking, regeneration', async () => {
  const cand = await as('demo.candidate02@recruitly.demo');
  const link = await cand.post('/api/candidate/booking-link', { driveId });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const token = tokenOf(link.data.url);
  const stored = await query('SELECT token_hash FROM booking_tokens WHERE revoked_at IS NULL AND candidate_id = (SELECT id FROM users WHERE email = $1)', ['demo.candidate02@recruitly.demo']);
  assert.ok(stored.rows[0].token_hash !== token && stored.rows[0].token_hash.length === 64, 'only the hash is stored');

  const anon = new Api(base);
  assert.equal((await anon.get('/api/bookings/not-a-real-token-not-a-real-token')).status, 404);
  const info = (await anon.get(`/api/bookings/${token}`)).data;
  assert.equal(info.canBook, true);
  assert.equal(info.drive.company, 'Northwind Labs');
  assert.ok(!JSON.stringify(info).includes('@recruitly.demo'), 'no emails exposed on the booking page');

  const slots = (await anon.get(`/api/bookings/${token}/slots`)).data;
  assert.ok(slots.total > 0);
  const slot = slots.days[0].slots[0];
  assert.ok(slot.modes.length >= 1);
  const ok = await anon.post(`/api/bookings/${token}/confirm`, { startsAt: slot.start, mode: slot.modes[0] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = (await anon.get(`/api/bookings/${token}`)).data;
  assert.equal(after.session.confirmed, true);
  assert.equal(after.session.startsAt, slot.start);
  assert.equal((await anon.get(`/api/bookings/${token}/ics`)).status, 200);

  const bad = await anon.post(`/api/bookings/${token}/reschedule`, { startsAt: new Date(Date.parse(slot.start) + 7 * 60000).toISOString() });
  assert.equal(bad.status, 409);

  const link2 = await cand.post('/api/candidate/booking-link', { driveId });
  assert.notEqual(tokenOf(link2.data.url), token);
  assert.equal((await anon.get(`/api/bookings/${token}`)).status, 404);
  await query(`UPDATE booking_tokens SET expires_at = now() - interval '1 minute' WHERE candidate_id = (SELECT id FROM users WHERE email = 'demo.candidate02@recruitly.demo')`);
  assert.equal((await anon.get(`/api/bookings/${tokenOf(link2.data.url)}`)).status, 404, 'expired token rejected');
});

test('concurrent bookings of the same scarce slot: exactly one succeeds', async () => {
  const tag = Date.now();
  const day = new Date(Date.now() + 8 * 86400000);
  const dateStr = day.toISOString().slice(0, 10);
  const wd = day.getUTCDay();
  const co = (await query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`RaceCo ${tag}`])).rows[0].id;
  const mk = async (email, role, name) => (await query(`INSERT INTO users (email, name, role) VALUES ($1,$2,$3) RETURNING id`, [email, name, role])).rows[0].id;
  const iv = await mk(`race.iv.${tag}@x.test`, 'interviewer', 'Race Interviewer');
  await query(`INSERT INTO interviewer_profiles (user_id, company_id, daily_capacity, modes) VALUES ($1,$2,5,'online_only')`, [iv, co]);
  await query(`INSERT INTO availability_rules (user_id, weekday, start_time, end_time) VALUES ($1,$2,'10:00','10:30')`, [iv, wd]);
  const drive = (await query(`INSERT INTO recruitment_drives (company_id, name, start_date, end_date, status) VALUES ($1,'Race drive',$2,$2,'published') RETURNING id`, [co, dateStr])).rows[0].id;
  const round = (await query(`INSERT INTO interview_rounds (drive_id, position, name, duration_minutes, panel_size) VALUES ($1,1,'Only',30,1) RETURNING id`, [drive])).rows[0].id;
  await query('INSERT INTO drive_interviewers (drive_id, interviewer_id) VALUES ($1,$2)', [drive, iv]);
  const tokens = [];
  for (let i = 0; i < 6; i += 1) {
    const c = await mk(`race.c${i}.${tag}@x.test`, 'candidate', `Racer ${i}`);
    await query('INSERT INTO availability_rules (user_id, weekday, start_time, end_time) VALUES ($1,$2,\'09:00\',\'17:00\')', [c, wd]);
    await query('INSERT INTO drive_candidates (drive_id, candidate_id, pipeline_status) VALUES ($1,$2,\'awaiting_booking\')', [drive, c]);
    tokens.push((await createBookingToken({ candidateId: c, driveId: drive, roundId: round })).token);
  }
  const anon = new Api(base);
  const slots = (await anon.get(`/api/bookings/${tokens[0]}/slots`)).data;
  assert.equal(slots.total, 1, 'single 10:00 slot is bookable');
  const startsAt = slots.days[0].slots[0].start;
  const results = await Promise.all(tokens.map((t) => new Api(base).post(`/api/bookings/${t}/confirm`, { startsAt })));
  const okN = results.filter((r) => r.status === 200).length;
  const conflicts = results.filter((r) => r.status === 409);
  assert.equal(okN, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(conflicts.length, 5);
  assert.ok(conflicts.every((r) => r.body.error.message === 'This slot was just booked by someone else. Please select another available time.'));
  const n = await query(`SELECT count(*)::int AS n FROM interview_sessions WHERE drive_id = $1 AND status = 'scheduled'`, [drive]);
  assert.equal(n.rows[0].n, 1);
  const loser = tokens.find((_, i) => results[i].status === 409);
  assert.equal((await anon.get(`/api/bookings/${loser}/slots`)).data.total, 0);
});

test('interviewer cancellation → minimal-disruption preview → approval → accurate change report', async () => {
  const c = await as('demo.coordinator@recruitly.demo');
  const iv = (await query(`SELECT id FROM users WHERE email = 'demo.iv1@recruitly.demo'`)).rows[0];
  const day = (await query('SELECT start_date FROM recruitment_drives WHERE id = $1', [driveId])).rows[0].start_date;
  const snap = async () => new Map((await query(`SELECT s.id, s.starts_at, s.mode, s.room_id, (SELECT array_agg(interviewer_id ORDER BY interviewer_id) FROM interview_assignments WHERE session_id = s.id AND active) AS ivs FROM interview_sessions s WHERE s.drive_id = $1 AND s.status = 'scheduled'`, [driveId])).rows.map((r) => [r.id, r]));
  const before = await snap();

  const cancel = await c.post(`/api/interviewers/${iv.id}/cancel-availability`, { date: day, reason: 'Family emergency' });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  const plan = cancel.data.plans[0];
  assert.ok(plan.summary.affected > 0);
  const run = (await c.get(`/api/drives/${driveId}/reschedules/${plan.runId}`)).data;
  assert.equal(run.valid, true);
  assert.equal(run.status, 'preview');
  assert.ok(run.changes.length >= plan.summary.affected, 'every affected interview is covered by the plan');
  const extra = run.changes.filter((x) => x.type === 'moved_for_capacity').length;
  assert.equal(run.changes.length, plan.summary.affected + extra);
  const rebook = run.changes.filter((x) => x.type === 'needs_rebooking');
  assert.equal(plan.summary.needsRebooking, rebook.length);
  assert.ok(rebook.every((x) => x.after === null && x.needsManual), 'unresolvable interviews are flagged for manual rebooking');
  const manualN = run.changes.filter((x) => x.type === 'manual_review').length;
  assert.equal(plan.summary.manualReview, manualN);
  const localDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  assert.ok(run.changes.filter((x) => !['needs_rebooking', 'manual_review'].includes(x.type)).every((x) => x.after && !(localDay(x.after.startsAt) === String(day).slice(0, 10) && x.after.interviewers.some((i) => i.id === iv.id))), 'the cancelled interviewer is never used inside the cancelled window');
  assert.equal((await snap()).size, before.size, 'preview changes nothing');

  const approved = await c.post(`/api/drives/${driveId}/reschedules/${plan.runId}/approve`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const after = await snap();
  const changedIds = new Set(run.changes.map((x) => x.sessionId));
  for (const [id, b] of before) {
    if (changedIds.has(id)) continue;
    const a = after.get(id);
    assert.ok(a, `unrelated session ${id} must remain scheduled`);
    assert.equal(+a.starts_at, +b.starts_at);
    assert.equal(a.room_id, b.room_id);
    assert.deepEqual(a.ivs, b.ivs);
  }
  for (const ch of approved.data.changes) {
    if (ch.type === 'manual_review') continue;
    if (ch.type === 'needs_rebooking') {
      assert.ok(!after.has(ch.sessionId));
      continue;
    }
    const a = after.get(ch.sessionId);
    assert.equal(a.starts_at.toISOString(), ch.after.startsAt, 'change report matches persisted state');
    assert.deepEqual(a.ivs, ch.after.interviewers.map((i) => i.id).sort());
    assert.ok(['mock', 'cancelled', 'not_applied'].includes(ch.calendarStatus));
    assert.equal(ch.notificationStatus, 'sent');
  }
  const manual = new Set(run.changes.filter((x) => x.type === 'manual_review').map((x) => x.sessionId));
  const stillThere = await query(`SELECT s.id FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id WHERE a.interviewer_id = $1 AND a.active AND s.status = 'scheduled' AND (s.starts_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`, [iv.id, day]);
  assert.ok(stillThere.rows.every((r) => manual.has(r.id)), 'cancelled interviewer only keeps locked (manual-review) interviews');
  const post = (await c.post(`/api/drives/${driveId}/schedules/validate`)).data;
  assert.ok(post.violations.every((x) => manual.has(x.session)), `only manual-review interviews may remain invalid: ${JSON.stringify(post.violations.slice(0, 3))}`);
  if (manual.size === 0) assert.equal(post.valid, true);
  assert.equal((await c.post(`/api/drives/${driveId}/reschedules/${plan.runId}/approve`)).status, 400, 'a plan cannot be applied twice');
});

test('pipeline progression: passes advance, failures stop', async () => {
  const rows = (await query(`SELECT s.result_status, dc.pipeline_status, dc.current_round_id, r.position,
      EXISTS (SELECT 1 FROM interview_sessions t JOIN interview_rounds tr ON tr.id = t.round_id WHERE t.candidate_id = s.candidate_id AND tr.position = 2 AND t.status <> 'cancelled') AS has_tech
    FROM interview_sessions s JOIN interview_rounds r ON r.id = s.round_id JOIN drive_candidates dc ON dc.candidate_id = s.candidate_id AND dc.drive_id = s.drive_id WHERE r.position = 1 AND s.result_status IN ('passed','failed')`)).rows;
  assert.ok(rows.some((r) => r.result_status === 'passed') && rows.some((r) => r.result_status === 'failed'));
  for (const r of rows) {
    if (r.result_status === 'failed') {
      assert.equal(r.pipeline_status, 'failed');
      assert.equal(r.has_tech, false, 'failed candidates never reach the next round');
    } else assert.equal(r.position, 1);
  }
  const passedWithoutNext = rows.filter((r) => r.result_status === 'passed' && !r.has_tech);
  for (const r of passedWithoutNext) assert.equal(r.pipeline_status, 'awaiting_booking', 'passed candidates without a slot are sent a booking link');
});

test('evaluations: blinding is enforced server-side and weighted scoring is correct', async () => {
  const sess = (await query(`SELECT s.id, s.candidate_id, (SELECT array_agg(interviewer_id ORDER BY interviewer_id) FROM interview_assignments WHERE session_id = s.id AND active) AS ivs
    FROM interview_sessions s JOIN interview_rounds r ON r.id = s.round_id WHERE r.position = 2 AND s.status IN ('scheduled','in_progress') AND (SELECT count(*) FROM evaluations e WHERE e.session_id = s.id) = 1 ORDER BY s.starts_at LIMIT 1`)).rows[0];
  if (!sess) console.error('DEBUG', JSON.stringify((await query(`SELECT s.status, s.result_status, count(e.id) AS evals FROM interview_sessions s JOIN interview_rounds r ON r.id=s.round_id LEFT JOIN evaluations e ON e.session_id=s.id WHERE r.position=2 GROUP BY s.id ORDER BY s.starts_at LIMIT 6`)).rows));
  assert.ok(sess, 'seed leaves a technical interview with one submitted evaluation');
  const emailOf = async (id) => (await query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
  const submitted = (await query('SELECT interviewer_id FROM evaluations WHERE session_id = $1', [sess.id])).rows[0].interviewer_id;
  const pending = sess.ivs.find((i) => i !== submitted);

  const A = await as(await emailOf(submitted));
  const B = await as(await emailOf(pending));
  const viewA = (await A.get(`/api/interviews/${sess.id}/evaluation`)).data;
  assert.equal(viewA.blinded, true, 'even the submitter cannot see others until the panel is complete');
  assert.equal(viewA.others, null);
  const viewB = (await B.get(`/api/interviews/${sess.id}/evaluation`)).data;
  assert.equal(viewB.mine, null);
  assert.equal(viewB.others, null);
  assert.ok(!JSON.stringify(viewB).includes('Demo technical evaluation'), 'comments are never leaked');

  const outsider = await as('demo.iv5@recruitly.demo');
  assert.equal((await outsider.get(`/api/interviews/${sess.id}/evaluation`)).status, 403);
  assert.equal((await outsider.post(`/api/interviews/${sess.id}/evaluation`, { scores: [] })).status, 400);
  assert.equal((await (await as('demo.candidate01@recruitly.demo')).get(`/api/interviews/${sess.id}/evaluation`)).status, 403);

  const crit = viewB.rubric.criteria;
  const full = (n) => crit.map((c) => ({ criterionId: c.id, score: n }));
  assert.equal((await B.post(`/api/interviews/${sess.id}/evaluation`, { scores: full(9) })).status, 400);
  assert.equal((await B.post(`/api/interviews/${sess.id}/evaluation`, { scores: full(3).slice(1) })).status, 400);

  const scores = [5, 3, 1].map((s, i) => ({ criterionId: crit[i].id, score: s }));
  const sub = await B.post(`/api/interviews/${sess.id}/evaluation`, { scores, comments: 'Private comment', recommendation: 'no' });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.data.weightedScore, 57.5);
  assert.equal(sub.data.panelComplete, true);
  const afterB = (await B.get(`/api/interviews/${sess.id}/evaluation`)).data;
  assert.equal(afterB.blinded, false);
  assert.equal(afterB.others.length, 1, 'released once everyone has submitted');
  const sessionRow = (await query('SELECT result_status, final_score FROM interview_sessions WHERE id = $1', [sess.id])).rows[0];
  assert.ok(['provisional_pass', 'provisional_fail'].includes(sessionRow.result_status), 'review round stays provisional');

  const c = await as('demo.coordinator@recruitly.demo');
  const fin = await c.post(`/api/interviews/${sess.id}/result`, { decision: 'pass', note: 'Strong overall' });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  const dc = (await query(`SELECT pipeline_status, r.position FROM drive_candidates dc JOIN interview_rounds r ON r.id = dc.current_round_id WHERE dc.candidate_id = $1`, [sess.candidate_id])).rows[0];
  assert.equal(dc.position, 3);
  assert.equal(dc.pipeline_status, 'awaiting_booking');
  assert.equal((await c.post(`/api/interviews/${sess.id}/result`, { decision: 'fail' })).status, 409, 'finalised results cannot be silently flipped');
});

test('ranking matrix: deterministic ties, no comments, authorised roles only', async () => {
  const c = await as('demo.coordinator@recruitly.demo');
  const r = (await c.get(`/api/drives/${driveId}/rankings`)).data;
  assert.ok(r.rows.length >= 10);
  for (let i = 1; i < r.rows.length; i += 1) {
    assert.ok(r.rows[i - 1].overall >= r.rows[i].overall, 'sorted by score');
    if (r.rows[i - 1].overall === r.rows[i].overall) assert.equal(r.rows[i].rank, r.rows[i - 1].rank, 'equal scores share a rank');
    else assert.ok(r.rows[i].rank > r.rows[i - 1].rank);
  }
  assert.ok(!JSON.stringify(r).includes('Demo evaluation') && !JSON.stringify(r).includes('Private comment'));
  const again = (await c.get(`/api/drives/${driveId}/rankings`)).data;
  assert.deepEqual(again.rows.map((x) => x.candidateId), r.rows.map((x) => x.candidateId), 'stable ordering');
  assert.equal((await (await as('demo.company@northwind.demo')).get(`/api/drives/${driveId}/rankings`)).status, 200);
  assert.equal((await (await as('demo.candidate01@recruitly.demo')).get(`/api/drives/${driveId}/rankings`)).status, 403);
  assert.equal((await (await as('demo.iv1@recruitly.demo')).get(`/api/drives/${driveId}/rankings`)).status, 403);
});

test('CSV import previews, flags duplicates, and never creates predictable passwords', async () => {
  const c = await as('demo.coordinator@recruitly.demo');
  const csv = ['name,email,registration_number,department,branch,graduation_year,eligible_drives',
    'New Person,new.person@example.edu,REG9001,Engineering,CSE,2027,Northwind Labs – Campus Hiring 2026',
    'Dup Person,demo.candidate01@recruitly.demo,REG9002,Engineering,CSE,2027,',
    'Bad Email,not-an-email,REG9003,Engineering,CSE,2027,',
    'Formula Guy,formula@example.edu,REG9004,Eng,CSE,2027,Unknown Drive'].join('\n');
  const form = () => { const f = new FormData(); f.append('file', new Blob([csv], { type: 'text/csv' }), 'candidates.csv'); return f; };
  const prev = await c.req('POST', '/api/imports/candidates?mode=preview', undefined, { form: form() });
  assert.equal(prev.status, 200, JSON.stringify(prev.body));
  assert.deepEqual(prev.data.summary, { total: 4, valid: 1, invalid: 2, duplicates: 1 });
  assert.ok(prev.data.errorCsv.includes('Dup Person'));
  const commit = await c.req('POST', '/api/imports/candidates?mode=commit', undefined, { form: form() });
  assert.equal(commit.data.summary.created, 1);
  const u = (await query(`SELECT id, password_hash FROM users WHERE email = 'new.person@example.edu'`)).rows[0];
  assert.equal(u.password_hash, null);
  assert.equal((await query('SELECT count(*)::int AS n FROM drive_candidates WHERE candidate_id = $1', [u.id])).rows[0].n, 1);
  const bad = new Api(base);
  assert.equal((await bad.post('/api/auth/login', { email: 'new.person@example.edu', password: 'Recruitly@Demo1' })).status, 401);
  const wrongType = new FormData();
  wrongType.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png');
  assert.equal((await c.req('POST', '/api/imports/candidates?mode=preview', undefined, { form: wrongType })).status, 400);
});

test('forgot / reset password flow', async () => {
  const a = new Api(base);
  const f = await a.post('/api/auth/forgot-password', { email: 'demo.candidate10@recruitly.demo' });
  assert.equal(f.status, 200);
  const none = await a.post('/api/auth/forgot-password', { email: 'nobody@nowhere.test' });
  assert.equal(none.data.message, f.data.message, 'does not reveal whether an account exists');
  const token = new URL(f.data.devResetLink).searchParams.get('token');
  assert.equal((await a.post('/api/auth/reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await a.post('/api/auth/reset-password', { token, password: 'BrandNew123' })).status, 200);
  assert.equal((await a.post('/api/auth/reset-password', { token, password: 'BrandNew123' })).status, 400, 'tokens are single use');
  assert.equal((await new Api(base).post('/api/auth/login', { email: 'demo.candidate10@recruitly.demo', password: 'BrandNew123' })).status, 200);
});
