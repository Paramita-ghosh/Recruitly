import { pool, query, withTransaction } from '../config/database.js';
import { loadProblem } from './loadProblem.js';
import { audit } from '../utils/audit.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';

export function assertSelfOrCoordinator(user, userId) {
  if (user.role !== 'coordinator' && user.id !== userId) throw forbidden('You can only manage your own availability.');
}

export async function getAvailability(userId) {
  const rules = (await query(`SELECT id, weekday, to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime", kind FROM availability_rules WHERE user_id = $1 ORDER BY weekday, start_time`, [userId])).rows;
  const exceptions = (await query(`SELECT id, date, to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime", kind, reason FROM availability_exceptions WHERE user_id = $1 ORDER BY date, start_time`, [userId])).rows;
  return { rules, exceptions };
}


export async function saveRules(user, userId, rules, ip) {
  assertSelfOrCoordinator(user, userId);
  const norm = [];
  const byKey = new Map();
  for (const r of rules) {
    const k = `${r.weekday}|${r.kind}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    let cur = null;
    for (const r of list) {
      if (cur && r.startTime <= cur.endTime) cur.endTime = r.endTime > cur.endTime ? r.endTime : cur.endTime;
      else {
        if (cur) norm.push(cur);
        cur = { ...r };
      }
    }
    if (cur) norm.push(cur);
  }
  for (const r of norm) if (r.endTime <= r.startTime) throw badRequest('Each time block must end after it starts.');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM availability_rules WHERE user_id = $1', [userId]);
    for (const r of norm) await client.query('INSERT INTO availability_rules (user_id, weekday, start_time, end_time, kind) VALUES ($1,$2,$3,$4,$5)', [userId, r.weekday, r.startTime, r.endTime, r.kind]);
    await audit(client, { actorId: user.id, action: 'availability.save', entityType: 'user', entityId: userId, details: { blocks: norm.length }, ip });
  });
  return getAvailability(userId);
}

export async function addException(user, userId, b) {
  assertSelfOrCoordinator(user, userId);
  await query('INSERT INTO availability_exceptions (user_id, date, start_time, end_time, kind, reason) VALUES ($1,$2,$3,$4,$5,$6)', [userId, b.date, b.startTime || null, b.endTime || null, b.kind, b.reason || null]);
  return getAvailability(userId);
}

export async function deleteException(user, userId, id) {
  assertSelfOrCoordinator(user, userId);
  const r = await query('DELETE FROM availability_exceptions WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!r.rowCount) throw notFound('Exception not found');
  return getAvailability(userId);
}

/** Upcoming sessions for the grid ("booked" blocks). */
export async function busySessions(userId, role) {
  const sql =
    role === 'interviewer'
      ? `SELECT s.id, s.starts_at, s.ends_at, s.mode, u.name AS who, rd.name AS round FROM interview_assignments a JOIN interview_sessions s ON s.id = a.session_id JOIN users u ON u.id = s.candidate_id JOIN interview_rounds rd ON rd.id = s.round_id WHERE a.interviewer_id = $1 AND a.active AND s.status IN ('scheduled','in_progress') ORDER BY s.starts_at`
      : `SELECT s.id, s.starts_at, s.ends_at, s.mode, c.name AS who, rd.name AS round FROM interview_sessions s JOIN recruitment_drives d ON d.id = s.drive_id JOIN companies c ON c.id = d.company_id JOIN interview_rounds rd ON rd.id = s.round_id WHERE s.candidate_id = $1 AND s.status IN ('scheduled','in_progress') ORDER BY s.starts_at`;
  return (await query(sql, [userId])).rows.map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, mode: r.mode, who: r.who, round: r.round }));
}

/** Coordinator overview: how much availability each participant has entered for a drive. */
export async function overview(driveId) {
  const { problem } = await loadProblem(pool, driveId, { notBefore: 0 });
  const mins = (list) => Math.round(list.reduce((a, x) => a + (x.end - x.start), 0) / 60000);
  const days = (list) => problem.days.filter((d) => list.some((x) => x.end > d.startMs && x.start < d.endMs)).map((d) => d.key);
  const rowFor = (p, role) => ({ userId: p.id, name: p.name, role, minutes: mins(p.availability), days: days(p.availability), preferredMinutes: mins(p.preferred || []), hasAvailability: p.availability.length > 0 });
  return {
    days: problem.days.map((d) => d.key),
    candidates: problem.candidates.map((c) => rowFor(c, 'candidate')),
    interviewers: problem.interviewers.map((i) => ({ ...rowFor(i, 'interviewer'), dailyCapacity: i.dailyCapacity, modes: i.modes, skills: [...i.skillSet].map((s) => problem.skillNames[s]) })),
    totalInterviewerMinutes: mins(problem.interviewers.flatMap((i) => i.availability)),
  };
}

// ───────────── Profiles & interviewer settings ─────────────
export async function getProfile(userId) {
  const u = (await query(
    `SELECT u.id, u.name, u.email, u.role, up.phone, up.bio, up.avatar_url, cp.reg_no, cp.department, cp.branch, cp.grad_year, cp.cgpa,
            ip.daily_capacity, ip.min_break_minutes, ip.modes, ip.title AS iv_title, ip.company_id AS iv_company_id, cm.company_id, cm.title AS cm_title
       FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       LEFT JOIN interviewer_profiles ip ON ip.user_id = u.id LEFT JOIN company_memberships cm ON cm.user_id = u.id WHERE u.id = $1`,
    [userId],
  )).rows[0];
  if (!u) throw notFound('User not found');
  const skills = (await query('SELECT s.id, s.name FROM interviewer_skills isk JOIN skills s ON s.id = isk.skill_id WHERE isk.user_id = $1 ORDER BY s.name', [userId])).rows;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, bio: u.bio, avatarUrl: u.avatar_url,
    candidate: u.role === 'candidate' ? { regNo: u.reg_no, department: u.department, branch: u.branch, gradYear: u.grad_year, cgpa: u.cgpa } : undefined,
    interviewer: u.role === 'interviewer' ? { dailyCapacity: u.daily_capacity, minBreakMinutes: u.min_break_minutes, modes: u.modes, title: u.iv_title, companyId: u.iv_company_id, skills } : undefined,
    company: u.role === 'company' ? { companyId: u.company_id, title: u.cm_title } : undefined,
  };
}

export async function updateProfile(user, userId, b, ip) {
  assertSelfOrCoordinator(user, userId);
  const cur = (await query('SELECT role FROM users WHERE id = $1', [userId])).rows[0];
  if (!cur) throw notFound('User not found');
  await withTransaction(async (client) => {
    if (b.name) await client.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [userId, b.name]);
    await client.query(`INSERT INTO user_profiles (user_id, phone, bio) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET phone = COALESCE($2, user_profiles.phone), bio = COALESCE($3, user_profiles.bio), updated_at = now()`, [userId, b.phone ?? null, b.bio ?? null]);
    if (cur.role === 'candidate' && b.candidate) {
      const c = b.candidate;
      await client.query(
        `INSERT INTO candidate_profiles (user_id, reg_no, department, branch, grad_year, cgpa) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id) DO UPDATE SET reg_no = COALESCE($2, candidate_profiles.reg_no), department = COALESCE($3, candidate_profiles.department),
           branch = COALESCE($4, candidate_profiles.branch), grad_year = COALESCE($5, candidate_profiles.grad_year), cgpa = COALESCE($6, candidate_profiles.cgpa)`,
        [userId, c.regNo || null, c.department || null, c.branch || null, c.gradYear ?? null, c.cgpa ?? null],
      );
    }
    if (cur.role === 'interviewer' && b.interviewer) {
      const i = b.interviewer;
      await client.query(
        `UPDATE interviewer_profiles SET daily_capacity = COALESCE($2, daily_capacity), min_break_minutes = COALESCE($3, min_break_minutes), modes = COALESCE($4, modes), title = COALESCE($5, title) WHERE user_id = $1`,
        [userId, i.dailyCapacity ?? null, i.minBreakMinutes ?? null, i.modes ?? null, i.title ?? null],
      );
      if (i.skillIds) {
        await client.query('DELETE FROM interviewer_skills WHERE user_id = $1', [userId]);
        for (const s of new Set(i.skillIds)) await client.query('INSERT INTO interviewer_skills (user_id, skill_id) VALUES ($1,$2)', [userId, s]);
      }
    }
    await audit(client, { actorId: user.id, action: 'profile.update', entityType: 'user', entityId: userId, ip });
  });
  return getProfile(userId);
}

export async function listSkills() {
  return (await query('SELECT id, name FROM skills ORDER BY name')).rows;
}

export async function listUsers(role, search) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_demo, u.last_login_at, (u.password_hash IS NOT NULL) AS activated,
            cp.reg_no, cp.department, cp.branch, cp.grad_year, ip.modes, ip.daily_capacity, c.name AS company_name,
            COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM interviewer_skills isk JOIN skills s ON s.id = isk.skill_id WHERE isk.user_id = u.id), '[]') AS skills,
            (SELECT count(*)::int FROM availability_rules ar WHERE ar.user_id = u.id) AS availability_blocks
       FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id LEFT JOIN interviewer_profiles ip ON ip.user_id = u.id
       LEFT JOIN companies c ON c.id = ip.company_id
      WHERE u.role = $1 AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR cp.reg_no ILIKE '%' || $2 || '%')
      ORDER BY u.name LIMIT 500`,
    [role, search || null],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, active: r.is_active, activated: r.activated, isDemo: r.is_demo, lastLoginAt: r.last_login_at, regNo: r.reg_no, department: r.department, branch: r.branch, gradYear: r.grad_year, modes: r.modes, dailyCapacity: r.daily_capacity, companyName: r.company_name, skills: r.skills, availabilityBlocks: r.availability_blocks }));
}
