import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { query, withTransaction } from '../config/database.js';
import { sendInvite } from './auth.service.js';
import { audit } from '../utils/audit.js';
import { badRequest } from '../utils/httpError.js';
import { csvSafe } from '../utils/format.js';

export const CANDIDATE_COLUMNS = ['name', 'email', 'registration_number', 'department', 'branch', 'graduation_year', 'eligible_drives'];
export const INTERVIEWER_COLUMNS = ['name', 'email', 'company', 'skills', 'daily_capacity', 'modes', 'preferred_mode'];

const ALIASES = {
  reg_no: 'registration_number', regno: 'registration_number', registration: 'registration_number', 'registration number': 'registration_number',
  'graduation year': 'graduation_year', grad_year: 'graduation_year', year: 'graduation_year', drives: 'eligible_drives', 'eligible drives': 'eligible_drives',
  'daily capacity': 'daily_capacity', capacity: 'daily_capacity', 'preferred mode': 'preferred_mode', skill_tags: 'skills', 'skill tags': 'skills',
};
const norm = (h) => {
  const k = String(h).trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[k] || k.replace(/ /g, '_');
};

export function parseCsv(buffer, expected) {
  let records;
  try {
    records = parse(buffer, { columns: (h) => h.map(norm), skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } catch (e) {
    throw badRequest(`Could not read the CSV file: ${e.message}`);
  }
  if (!records.length) throw badRequest('The CSV file has no data rows.');
  if (records.length > 2000) throw badRequest('Please import at most 2,000 rows at a time.');
  const headers = Object.keys(records[0]);
  const missing = ['name', 'email'].filter((c) => !headers.includes(c));
  if (missing.length) throw badRequest(`Missing required column(s): ${missing.join(', ')}. Expected columns: ${expected.join(', ')}`);
  return records;
}

const email = z.string().email();
const candidateRow = z.object({
  name: z.string().min(2, 'Name is too short'),
  email,
  registration_number: z.string().optional(),
  department: z.string().optional(),
  branch: z.string().optional(),
  graduation_year: z.coerce.number().int().min(2000).max(2100).optional().or(z.literal('').transform(() => undefined)),
  eligible_drives: z.string().optional(),
});
const MODE = { offline: 'offline', online: 'online', both: 'both' };
const interviewerRow = z.object({
  name: z.string().min(2, 'Name is too short'),
  email,
  company: z.string().optional(),
  skills: z.string().optional(),
  daily_capacity: z.coerce.number().int().min(1).max(30).optional().or(z.literal('').transform(() => undefined)),
  modes: z.string().optional(),
  preferred_mode: z.string().optional(),
});

function modeFrom(modes, preferred) {
  const m = MODE[(modes || 'both').toLowerCase()];
  if (!m) return { error: 'modes must be offline, online or both' };
  const p = preferred ? preferred.toLowerCase() : null;
  if (p && !['offline', 'online'].includes(p)) return { error: 'preferred_mode must be offline or online' };
  if (m === 'offline') return { value: 'offline_only' };
  if (m === 'online') return { value: 'online_only' };
  return { value: p === 'online' ? 'both_prefer_online' : 'both_prefer_offline' };
}

/** Validate every row and flag duplicates (in the file and in the database). Nothing is written. */
export async function previewImport(kind, buffer) {
  const records = parseCsv(buffer, kind === 'candidates' ? CANDIDATE_COLUMNS : INTERVIEWER_COLUMNS);
  const schema = kind === 'candidates' ? candidateRow : interviewerRow;
  const emails = records.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
  const existing = new Set((await query('SELECT lower(email) AS e FROM users WHERE lower(email) = ANY($1)', [emails])).rows.map((r) => r.e));
  const regs = kind === 'candidates' ? records.map((r) => r.registration_number).filter(Boolean) : [];
  const existingRegs = new Set(regs.length ? (await query('SELECT reg_no FROM candidate_profiles WHERE reg_no = ANY($1)', [regs])).rows.map((r) => r.reg_no) : []);
  const drives = new Map((await query('SELECT id, lower(name) AS n FROM recruitment_drives')).rows.map((d) => [d.n, d.id]));
  const companies = new Map((await query('SELECT id, lower(name) AS n FROM companies')).rows.map((c) => [c.n, c.id]));
  const skills = new Map((await query('SELECT id, lower(name) AS n FROM skills')).rows.map((s) => [s.n, s.id]));
  const seen = new Set();
  const seenRegs = new Set();
  const rows = records.map((raw, i) => {
    const line = i + 2;
    const errors = [];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) parsed.error.issues.forEach((x) => errors.push(`${x.path.join('.')}: ${x.message}`));
    const e = String(raw.email || '').toLowerCase();
    let status = 'new';
    if (e && existing.has(e)) status = 'duplicate_existing';
    else if (e && seen.has(e)) status = 'duplicate_in_file';
    if (e) seen.add(e);
    const data = parsed.success ? { ...parsed.data } : {};
    if (kind === 'candidates') {
      const reg = raw.registration_number;
      if (reg && (existingRegs.has(reg) || seenRegs.has(reg)) && status === 'new') status = 'duplicate_existing';
      if (reg) seenRegs.add(reg);
      data.driveIds = [];
      for (const name of String(raw.eligible_drives || '').split(';').map((s) => s.trim()).filter(Boolean)) {
        const id = drives.get(name.toLowerCase());
        if (id) data.driveIds.push(id);
        else errors.push(`Unknown drive "${name}"`);
      }
    } else {
      const m = modeFrom(raw.modes, raw.preferred_mode);
      if (m.error) errors.push(m.error);
      data.modesValue = m.value;
      if (raw.company) {
        const cid = companies.get(raw.company.toLowerCase());
        if (cid) data.companyId = cid;
        else errors.push(`Unknown company "${raw.company}"`);
      }
      data.skillIds = [];
      for (const s of String(raw.skills || '').split(';').map((x) => x.trim()).filter(Boolean)) {
        const id = skills.get(s.toLowerCase());
        if (id) data.skillIds.push(id);
        else errors.push(`Unknown skill "${s}"`);
      }
    }
    return { line, raw, data, errors, status: errors.length ? 'invalid' : status };
  });
  const summary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === 'new').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    duplicates: rows.filter((r) => r.status.startsWith('duplicate')).length,
  };
  return { rows, summary };
}

export function errorReportCsv(rows) {
  const bad = rows.filter((r) => r.status !== 'new');
  return stringify(
    bad.map((r) => ({ line: r.line, status: r.status, problems: r.errors.join(' | ') || (r.status.startsWith('duplicate') ? 'Email or registration number already exists' : ''), ...Object.fromEntries(Object.entries(r.raw).map(([k, v]) => [k, csvSafe(v)])) })),
    { header: true },
  );
}

export async function commitImport(user, kind, buffer, ip) {
  const { rows, summary } = await previewImport(kind, buffer);
  const good = rows.filter((r) => r.status === 'new');
  let invited = 0;
  const failures = [];
  for (const r of good) {
    try {
      const user_ = await withTransaction(async (client) => {
        const d = r.data;
        const role = kind === 'candidates' ? 'candidate' : 'interviewer';
        // No password is ever set here: accounts are activated through a secure invitation link.
        const u = (await client.query(`INSERT INTO users (email, name, role) VALUES ($1,$2,$3) RETURNING *`, [d.email.toLowerCase(), d.name, role])).rows[0];
        await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [u.id]);
        if (role === 'candidate') {
          await client.query('INSERT INTO candidate_profiles (user_id, reg_no, department, branch, grad_year) VALUES ($1,$2,$3,$4,$5)', [u.id, d.registration_number || null, d.department || null, d.branch || null, d.graduation_year || null]);
          for (const driveId of d.driveIds) await client.query('INSERT INTO drive_candidates (drive_id, candidate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [driveId, u.id]);
        } else {
          await client.query('INSERT INTO interviewer_profiles (user_id, company_id, daily_capacity, modes) VALUES ($1,$2,$3,$4)', [u.id, d.companyId || null, d.daily_capacity || 6, d.modesValue]);
          for (const s of d.skillIds) await client.query('INSERT INTO interviewer_skills (user_id, skill_id) VALUES ($1,$2)', [u.id, s]);
        }
        return u;
      });
      await sendInvite(user_);
      invited += 1;
    } catch (e) {
      failures.push({ ...r, status: 'invalid', errors: [e.code === '23505' ? 'Duplicate email or registration number' : 'Could not be saved'] });
    }
  }
  const allBad = [...rows.filter((r) => r.status !== 'new'), ...failures];
  await audit(null, { actorId: user.id, action: `import.${kind}`, entityType: 'import', details: { ...summary, created: invited, failed: failures.length }, ip });
  return { summary: { ...summary, created: invited, failed: failures.length, skipped: summary.total - invited }, errorCsv: allBad.length ? errorReportCsv(allBad) : null };
}
