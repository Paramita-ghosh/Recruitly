// DEVELOPMENT-ONLY demo data. Refuses to run in production. All records are flagged is_demo = true.
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import { pool, query, closePool } from '../config/database.js';
import { migrate } from './migrate.js';
import { resetDatabase } from './reset.js';
import { hashPassword } from '../services/auth.service.js';
import * as drives from '../services/drive.service.js';
import { generateSchedule, publishSchedule } from '../services/scheduling.service.js';
import { submitEvaluation, getRubric } from '../services/evaluation.service.js';
import { candidateOwnLink } from '../services/booking.service.js';
import { processOutbox } from '../services/notification.service.js';
import { weekdayOf } from '../scheduling/timeUtils.js';

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Ishaan', 'Saanvi', 'Vihaan', 'Myra', 'Aditya', 'Kiara', 'Reyansh', 'Anika', 'Arnav', 'Tara', 'Dhruv', 'Navya', 'Rudra', 'Prisha', 'Yash', 'Meher', 'Karan', 'Ira', 'Neel', 'Zara', 'Samar', 'Riya', 'Veer', 'Aisha', 'Om', 'Pooja'];
const LAST = ['Sharma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Menon', 'Bose', 'Chopra', 'Joshi', 'Mishra', 'Kulkarni', 'Banerjee', 'Pillai', 'Saxena', 'Thakur', 'Malhotra', 'Desai', 'Sethi', 'Rao', 'Khanna'];
const BRANCHES = ['Computer Science', 'Information Technology', 'Electronics & Communication', 'AI & Data Science'];

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function pickDriveDates() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  for (let i = 0; i < 10; i += 1) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 4) break; 
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const start = fmt(d);
  d.setUTCDate(d.getUTCDate() + 1);
  return { start, end: fmt(d) };
}

export async function seedDemo({ reset = false, quiet = false } = {}) {
  if (env.isProd) throw new Error('Refusing to seed demo data in production.');
  const log = (...a) => !quiet && console.log(...a);
  if (reset) await resetDatabase();
  else await migrate({ quiet: true });
  if ((await query(`SELECT 1 FROM users WHERE is_demo LIMIT 1`)).rows[0]) {
    log('[seed] demo data already present. Run `npm run db:reset` first to rebuild it.');
    return null;
  }
  const hash = await hashPassword(env.DEMO_PASSWORD);
  const skills = new Map((await query('SELECT id, name FROM skills')).rows.map((s) => [s.name, s.id]));
  const { start, end } = pickDriveDates();
  const w1 = weekdayOf(start);
  const w2 = weekdayOf(end);

  async function mkUser(email, name, role) {
    const u = (await query(`INSERT INTO users (email, name, role, password_hash, is_demo) VALUES ($1,$2,$3,$4,true) RETURNING id`, [email, name, role, hash])).rows[0];
    await query('INSERT INTO user_profiles (user_id) VALUES ($1)', [u.id]);
    return u.id;
  }
  const rule = (uid, weekday, s, e, kind = 'available') => query('INSERT INTO availability_rules (user_id, weekday, start_time, end_time, kind) VALUES ($1,$2,$3,$4,$5)', [uid, weekday, s, e, kind]);

  await query(`INSERT INTO companies (name, kind, description, location, is_demo) VALUES ('Meridian Institute of Technology – Training & Placement Cell','college','Campus placement cell (demo)','Bengaluru',true)`);
  const northwind = (await query(`INSERT INTO companies (name, description, industry, location, website, is_demo) VALUES ('Northwind Labs','Developer tools and cloud infrastructure (demo company)','Software','Bengaluru','https://northwind.example',true) RETURNING id`)).rows[0].id;
  const orbit = (await query(`INSERT INTO companies (name, description, industry, location, website, is_demo) VALUES ('Orbit Systems','Embedded and IoT platforms (demo company)','Hardware / IoT','Pune','https://orbit.example',true) RETURNING id`)).rows[0].id;

  const coordinator = await mkUser('demo.coordinator@recruitly.demo', 'Priya Natarajan', 'coordinator');
  const nwUser = await mkUser('demo.company@northwind.demo', 'Daniel Okafor', 'company');
  const orbitUser = await mkUser('demo.recruiter@orbit.demo', 'Lena Fischer', 'company');
  await query('INSERT INTO company_memberships (user_id, company_id, title) VALUES ($1,$2,$3),($4,$5,$6)', [nwUser, northwind, 'Talent Acquisition Lead', orbitUser, orbit, 'Campus Recruiter']);

  const IV = [
    { n: 'Meera Iyer', skills: ['Coding', 'DSA', 'Backend'], modes: 'both_prefer_offline', cap: 12, windows: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']] } },
    { n: 'Arjun Rao', skills: ['Coding', 'Web Development', 'Frontend'], modes: 'online_only', cap: 12, windows: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']] } },
    { n: 'Sana Qureshi', skills: ['DSA', 'System Design', 'Database Systems'], modes: 'offline_only', cap: 8, windows: { 1: [['09:00', '17:00']], 2: [['13:00', '17:00']] } },
    { n: 'Vikram Shah', skills: ['DSA', 'Machine Learning', 'Coding'], modes: 'both_prefer_online', cap: 7, windows: { 1: [['09:00', '13:00']], 2: [['13:00', '17:00']] } },
    { n: 'Nisha Kapoor', skills: ['HR', 'Behavioral'], modes: 'both_prefer_offline', cap: 10, windows: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']] } },
    { n: 'Rohan Das', skills: ['HR', 'Behavioral', 'System Design', 'DSA'], modes: 'both_prefer_online', cap: 8, windows: { 1: [['11:00', '17:00']], 2: [['10:00', '17:00']] } },
  ];
  const ivIds = [];
  for (let i = 0; i < IV.length; i += 1) {
    const v = IV[i];
    const id = await mkUser(`demo.iv${i + 1}@recruitly.demo`, v.n, 'interviewer');
    await query('INSERT INTO interviewer_profiles (user_id, company_id, title, daily_capacity, min_break_minutes, modes) VALUES ($1,$2,$3,$4,$5,$6)', [id, northwind, 'Senior Engineer', v.cap, i === 0 ? 0 : 0, v.modes]);
    for (const s of v.skills) await query('INSERT INTO interviewer_skills (user_id, skill_id) VALUES ($1,$2)', [id, skills.get(s)]);
    for (const [day, list] of Object.entries(v.windows)) for (const [s, e] of list) await rule(id, day === '1' ? w1 : w2, s, e);
    ivIds.push(id);
  }

  const candIds = [];
  for (let i = 1; i <= 60; i += 1) {
    const name = i === 59 ? 'Zoya Khan' : i === 60 ? 'Tanvi Arora' : `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`;
    const id = await mkUser(`demo.candidate${pad(i)}@recruitly.demo`, name, 'candidate');
    await query('INSERT INTO candidate_profiles (user_id, reg_no, department, branch, grad_year, cgpa) VALUES ($1,$2,$3,$4,2027,$5)', [id, `MIT27${String(1000 + i)}`, 'Engineering', BRANCHES[i % BRANCHES.length], (6.5 + ((i * 37) % 33) / 10).toFixed(2)]);
    candIds.push(id);
    if (i === 59) continue; // never entered availability
    if (i === 60) {
      await rule(id, w1, '09:00', '09:15'); // too short for any interview
      continue;
    }
    const days = i % 7 === 0 ? [w2] : [w1, w2];
    for (const wd of days) {
      if (i % 5 === 0) await rule(id, wd, '14:00', '17:00');
      else if (i % 11 === 0 && wd === w2) continue;
      else {
        await rule(id, wd, '09:00', '13:00');
        await rule(id, wd, '14:00', '17:00');
      }
      if (i % 3 === 0) await rule(id, wd, '14:00', '16:00', 'preferred');
    }
    if (i % 6 === 1) await query(`INSERT INTO availability_exceptions (user_id, date, start_time, end_time, kind, reason) VALUES ($1,$2,'10:00','12:00','unavailable','Mid-semester exam')`, [id, start]);
    if (i % 9 === 4) await query(`INSERT INTO availability_exceptions (user_id, date, start_time, end_time, kind, reason) VALUES ($1,$2,'14:00','17:00','unavailable','Lab practical')`, [id, end]);
  }

  const coordUser = { id: coordinator, role: 'coordinator' };
  const drive = await drives.createDrive(coordUser, {
    companyId: northwind, name: 'Northwind Labs – Campus Hiring 2026', description: 'Two-day campus drive for Software Engineer roles (demo data).',
    timezone: 'Asia/Kolkata', startDate: start, endDate: end, dayStart: '09:00', dayEnd: '17:00', slotMinutes: 30, defaultDurationMinutes: 30, bufferMinutes: 0,
    modePolicy: 'any', selfBookingEnabled: true, bookingDeadline: new Date(`${start}T02:30:00Z`).toISOString(), rescheduleDeadline: new Date(`${start}T02:30:00Z`).toISOString(),
    eligibility: { minCgpa: 6.5, branches: BRANCHES, shareRankingsWithCompany: true }, defaultPipeline: true,
  });
  await query('UPDATE recruitment_drives SET is_demo = true, status = $2 WHERE id = $1', [drive.id, 'collecting_availability']);
  const [coding, technical, hr] = drive.rounds;
  await drives.updateRound(coordUser, technical.id, { panelSize: 2, skillIds: [skills.get('DSA')], panelRequirements: [{ skillId: skills.get('System Design'), minCount: 1 }], durationMinutes: 30 });
  await drives.updateRound(coordUser, hr.id, { allowedModes: ['offline', 'online'] });
  await drives.addMembers(coordUser, drive.id, 'candidates', { ids: candIds });
  await drives.addMembers(coordUser, drive.id, 'interviewers', { ids: ivIds });
  const rooms = [['Room A – Seminar Hall', 'Block A, Floor 1', 6, ['projector']], ['Room B', 'Block A, Floor 2', 4, []], ['Room C', 'Block B, Floor 1', 4, ['whiteboard']], ['Room D – Boardroom', 'Admin Block', 8, ['projector', 'whiteboard']]];
  for (const [name, location, capacity, equipment] of rooms) await drives.createRoom(coordUser, drive.id, { name, location, capacity, equipment, accessible: true });

  const orbitDrive = await drives.createDrive({ id: orbitUser, role: 'company', companyId: orbit }, {
    name: 'Orbit Systems – Embedded Engineer Drive', description: 'Awaiting placement-cell approval (demo).', timezone: 'Asia/Kolkata', startDate: start, endDate: end, dayStart: '10:00', dayEnd: '16:00',
    slotMinutes: 30, defaultDurationMinutes: 30, bufferMinutes: 0, modePolicy: 'any', selfBookingEnabled: true, defaultPipeline: true,
  });
  await query('UPDATE recruitment_drives SET is_demo = true WHERE id = $1', [orbitDrive.id]);

  log('[seed] generating Coding round schedule…');
  const gen = await generateSchedule(coordUser, drive.id, { roundId: coding.id });
  const freed = [candIds[1], candIds[2]];
  await query(`DELETE FROM interview_sessions WHERE round_id = $1 AND candidate_id = ANY($2)`, [coding.id, freed]);
  await query(`UPDATE drive_candidates SET pipeline_status = 'awaiting_booking', current_round_id = $3 WHERE drive_id = $1 AND candidate_id = ANY($2)`, [drive.id, freed, coding.id]);
  gen.scheduledCount -= freed.length;
  await publishSchedule(coordUser, drive.id);
  await waitFor(async () => (await query(`SELECT count(*)::int AS n FROM calendar_events`)).rows[0].n >= gen.scheduledCount, 20000);
  await waitFor(async () => (await query(`SELECT count(*)::int AS n FROM booking_tokens WHERE candidate_id = ANY($1)`, [freed])).rows[0].n >= 2, 10000);

  env.ALLOW_EARLY_EVALUATION = true;
  const rub = await getRubric(coding.id);
  const PATTERNS = [[5, 5, 4], [4, 4, 4], [2, 1, 2], [4, 3, 4], [3, 3, 3], [5, 4, 5], [4, 4, 5], [2, 2, 3], [5, 5, 5], [4, 5, 4], [3, 2, 3], [4, 4, 4]];
  const sessions = (await query(`SELECT s.id, (SELECT interviewer_id FROM interview_assignments WHERE session_id = s.id AND active LIMIT 1) AS iv FROM interview_sessions s WHERE s.round_id = $1 AND s.status = 'scheduled' ORDER BY s.starts_at, s.id LIMIT 12`, [coding.id])).rows;
  for (let i = 0; i < sessions.length; i += 1) {
    await submitEvaluation({ id: sessions[i].iv, role: 'interviewer' }, sessions[i].id, {
      scores: rub.criteria.map((c, k) => ({ criterionId: c.id, score: PATTERNS[i][k], comment: undefined })),
      comments: 'Demo evaluation.', recommendation: PATTERNS[i][0] >= 4 ? 'yes' : 'no',
    });
  }

  log('[seed] generating Technical round schedule…');
  await generateSchedule(coordUser, drive.id, { roundId: technical.id });
  await publishSchedule(coordUser, drive.id);
  await new Promise((r) => setTimeout(r, 2500)); 
  const techRub = await getRubric(technical.id);
  const techSessions = (await query(`SELECT s.id, COALESCE((SELECT array_agg(interviewer_id ORDER BY interviewer_id) FROM interview_assignments WHERE session_id = s.id AND active), '{}') AS ivs FROM interview_sessions s WHERE s.round_id = $1 AND s.status = 'scheduled' ORDER BY s.starts_at, s.id LIMIT 3`, [technical.id])).rows;
  for (let i = 0; i < techSessions.length; i += 1) {
    const panel = techSessions[i].ivs;
    const who = i === 2 ? panel : [panel[0]]; 
    for (const iv of who) {
      await submitEvaluation({ id: iv, role: 'interviewer' }, techSessions[i].id, { scores: techRub.criteria.map((c) => ({ criterionId: c.id, score: 4 })), comments: 'Demo technical evaluation.', recommendation: 'yes' });
    }
  }
  await query(`UPDATE recruitment_drives SET status = 'in_progress' WHERE id = $1`, [drive.id]);
  await processOutbox(100);

  const open = (await query(`SELECT u.email, u.name FROM drive_candidates dc JOIN users u ON u.id = dc.candidate_id WHERE dc.drive_id = $1 AND dc.pipeline_status = 'awaiting_booking' ORDER BY u.email LIMIT 1`, [drive.id])).rows[0];
  const summary = {
    driveId: drive.id, scheduled: gen.scheduledCount, unscheduled: gen.unscheduled.length + freed.length, quality: gen.quality.score, status: gen.status,
    start, end, password: env.DEMO_PASSWORD, openCandidate: open?.email,
  };
  log(`[seed] done – ${summary.scheduled} scheduled, ${summary.unscheduled} unscheduled, quality ${summary.quality}/100, drive ${start} → ${end}`);
  return summary;
}

async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

void candidateOwnLink;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDemo({ reset: process.argv.includes('--reset') })
    .then((s) => {
      if (s) {
        console.log('\n  Demo logins (password for all: %s)', s.password);
        console.log('    Coordinator : demo.coordinator@recruitly.demo');
        console.log('    Company     : demo.company@northwind.demo   |  demo.recruiter@orbit.demo');
        console.log('    Interviewers: demo.iv1@recruitly.demo … demo.iv6@recruitly.demo');
        console.log('    Candidates  : demo.candidate01@recruitly.demo … demo.candidate60@recruitly.demo');
        if (s.openCandidate) console.log('    Self-booking demo candidate (unscheduled): %s', s.openCandidate);
        console.log('');
      }
      return closePool();
    })
    .catch((e) => {
      console.error(e);
      closePool().finally(() => process.exit(1));
    });
}
export { pool };
