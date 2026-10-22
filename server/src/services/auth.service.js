import bcrypt from 'bcrypt';
import env from '../config/env.js';
import { pool, query, withTransaction } from '../config/database.js';
import { oauthClient, LOGIN_SCOPES } from '../config/google.js';
import { randomToken, hashToken } from '../utils/tokens.js';
import { queueEmail, renderEmail } from './notification.service.js';
import { audit } from '../utils/audit.js';
import { HttpError, badRequest, unauthorized, forbidden } from '../utils/httpError.js';

const ROUNDS = env.NODE_ENV === 'test' ? 4 : 11;
const DUMMY = bcrypt.hashSync('not-a-real-password', ROUNDS);

export const hashPassword = (pw) => bcrypt.hash(pw, ROUNDS);

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.company_id ?? u.companyId ?? null, isDemo: u.is_demo ?? u.isDemo ?? false });

export async function registerCandidate({ name, email, password, regNo, department, branch, gradYear }, ip) {
  const exists = (await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
  if (exists) throw new HttpError(409, 'An account with this email already exists. Try signing in instead.');
  const hash = await hashPassword(password);
  const user = await withTransaction(async (client) => {
    const u = (await client.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'candidate',$3) RETURNING *`, [email.toLowerCase(), name, hash])).rows[0];
    await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [u.id]);
    await client.query('INSERT INTO candidate_profiles (user_id, reg_no, department, branch, grad_year) VALUES ($1,$2,$3,$4,$5)', [u.id, regNo || null, department || null, branch || null, gradYear || null]);
    await audit(client, { actorId: u.id, action: 'auth.register', entityType: 'user', entityId: u.id, ip });
    return u;
  });
  return user;
}

export async function login({ email, password }, ip) {
  const u = (await query('SELECT u.*, cm.company_id FROM users u LEFT JOIN company_memberships cm ON cm.user_id = u.id WHERE lower(u.email) = lower($1)', [email])).rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash || DUMMY);
  if (!u || !u.password_hash || !ok || !u.is_active) {
    await audit(null, { action: 'auth.login_failed', entityType: 'user', details: { email }, ip });
    throw unauthorized('Incorrect email or password.');
  }
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  await audit(null, { actorId: u.id, action: 'auth.login', entityType: 'user', entityId: u.id, ip });
  return u;
}

export async function createResetToken(userId, purpose = 'reset', hours = 1) {
  const token = randomToken(32);
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL AND purpose = $2`, [userId, purpose]);
  await query(`INSERT INTO password_reset_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval)`, [userId, hashToken(token), purpose, String(hours)]);
  return token;
}

export async function forgotPassword(email) {
  const u = (await query('SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND is_active', [email])).rows[0];
  const out = { sent: true };
  if (!u) return out; // do not reveal whether the account exists
  const token = await createResetToken(u.id, 'reset', 1);
  const url = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  await queueEmail(null, {
    to: u.email,
    subject: 'Reset your Recruitly password',
    html: renderEmail({ title: 'Reset your password', intro: 'Use the button below to choose a new password. The link expires in 1 hour. If you did not request this, you can ignore this email.', cta: { label: 'Choose a new password', url } }),
  });
  if (env.DEMO_MODE && !env.smtpEnabled && !env.isProd) out.devResetLink = url;
  return out;
}

export async function resetPassword({ token, password }, ip) {
  const row = (await query(`SELECT * FROM password_reset_tokens WHERE token_hash = $1`, [hashToken(token)])).rows[0];
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) throw badRequest('This link is invalid or has expired. Request a new one.');
  const hash = await hashPassword(password);
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $2, is_active = true, updated_at = now() WHERE id = $1', [row.user_id, hash]);
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await audit(client, { actorId: row.user_id, action: row.purpose === 'invite' ? 'auth.accept_invite' : 'auth.reset_password', entityType: 'user', entityId: row.user_id, ip });
  });
  return { ok: true };
}

export async function inviteUser(actor, { email, name, role, companyId, title }, ip) {
  if (role === 'company' && !companyId) throw badRequest('Choose a company for the recruiter account.');
  const exists = (await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
  if (exists) throw new HttpError(409, 'A user with this email already exists.');
  const user = await withTransaction(async (client) => {
    const u = (await client.query(`INSERT INTO users (email, name, role) VALUES ($1,$2,$3) RETURNING *`, [email.toLowerCase(), name, role])).rows[0];
    await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [u.id]);
    if (role === 'interviewer') await client.query('INSERT INTO interviewer_profiles (user_id, company_id) VALUES ($1,$2)', [u.id, companyId || null]);
    if (role === 'candidate') await client.query('INSERT INTO candidate_profiles (user_id) VALUES ($1)', [u.id]);
    if (role === 'company') await client.query('INSERT INTO company_memberships (user_id, company_id, title) VALUES ($1,$2,$3)', [u.id, companyId, title || null]);
    await audit(client, { actorId: actor.id, action: 'user.invite', entityType: 'user', entityId: u.id, details: { role }, ip });
    return u;
  });
  return sendInvite(user);
}

export async function sendInvite(user) {
  const token = await createResetToken(user.id, 'invite', 72);
  const url = `${env.FRONTEND_URL}/reset-password?token=${token}&invite=1`;
  await queueEmail(null, {
    to: user.email,
    subject: 'You have been invited to Recruitly',
    html: renderEmail({ title: `Welcome, ${user.name}`, intro: `An account has been created for you as ${user.role === 'company' ? 'a recruiter' : `an ${user.role}`}. Set your password to activate it. This link expires in 72 hours.`, cta: { label: 'Activate my account', url } }),
  });
  const out = { userId: user.id, invited: true };
  if (env.DEMO_MODE && !env.smtpEnabled && !env.isProd) out.devInviteLink = url;
  return out;
}

// ───────────── Google sign-in ─────────────
export function googleLoginUrl(state) {
  if (!env.googleOAuthEnabled) throw new HttpError(501, 'Google sign-in is not configured on this server.');
  return oauthClient(env.googleCallbackUrl).generateAuthUrl({ access_type: 'online', scope: LOGIN_SCOPES, state, prompt: 'select_account' });
}


export async function googleCallback(code, ip) {
  if (!env.googleOAuthEnabled) throw new HttpError(501, 'Google sign-in is not configured on this server.');
  const client = oauthClient(env.googleCallbackUrl);
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw forbidden('Your Google email address is not verified.');
  return withTransaction(async (db) => {
    let u = (await db.query('SELECT u.*, cm.company_id FROM users u LEFT JOIN company_memberships cm ON cm.user_id = u.id WHERE u.google_id = $1', [p.sub])).rows[0];
    if (!u) {
      u = (await db.query('SELECT u.*, cm.company_id FROM users u LEFT JOIN company_memberships cm ON cm.user_id = u.id WHERE lower(u.email) = lower($1)', [p.email])).rows[0];
      if (u) await db.query('UPDATE users SET google_id = $2 WHERE id = $1', [u.id, p.sub]);
    }
    if (!u) {
      u = (await db.query(`INSERT INTO users (email, name, role, google_id) VALUES ($1,$2,'candidate',$3) RETURNING *`, [p.email.toLowerCase(), p.name || p.email, p.sub])).rows[0];
      await db.query('INSERT INTO user_profiles (user_id, avatar_url) VALUES ($1,$2)', [u.id, p.picture || null]);
      await db.query('INSERT INTO candidate_profiles (user_id) VALUES ($1)', [u.id]);
    }
    if (!u.is_active) throw forbidden('This account is disabled.');
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
    await audit(db, { actorId: u.id, action: 'auth.google_login', entityType: 'user', entityId: u.id, ip });
    return u;
  });
}

export { pool };
