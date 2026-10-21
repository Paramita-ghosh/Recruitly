import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { query } from '../config/database.js';
import { unauthorized, asyncHandler } from '../utils/httpError.js';

export const COOKIE = 'recruitly_token';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export const clearAuthCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

async function loadUser(req) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.role, u.is_demo, cm.company_id
       FROM users u LEFT JOIN company_memberships cm ON cm.user_id = u.id
      WHERE u.id = $1 AND u.is_active`,
    [payload.sub],
  );
  if (!rows[0]) throw unauthorized('Your session is no longer valid.');
  const u = rows[0];
  return { id: u.id, email: u.email, name: u.name, role: u.role, companyId: u.company_id, isDemo: u.is_demo };
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const user = await loadUser(req);
  if (!user) throw unauthorized();
  req.user = user;
  next();
});

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  try {
    req.user = (await loadUser(req)) || null;
  } catch {
    req.user = null;
  }
  next();
});
