import { Router } from 'express';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { query } from '../config/database.js';
import { authenticate, setAuthCookie, clearAuthCookie, signToken } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/httpError.js';
import { loginSchema, registerSchema, forgotSchema, resetSchema } from '../utils/schemas.js';
import * as auth from '../services/auth.service.js';

const router = Router();
const wrap = (user) => ({ success: true, data: { user: auth.publicUser(user) } });

router.get('/config', asyncHandler(async (_req, res) => {
  const data = { googleSignIn: env.googleOAuthEnabled, demoMode: env.DEMO_MODE, calendarMode: env.googleCalendarActive ? 'google' : env.DEMO_MODE ? 'demo' : 'disabled', emailMode: env.smtpEnabled ? 'smtp' : 'log-only' };
  if (env.DEMO_MODE) {
    const { rows } = await query(`SELECT email, name, role FROM users WHERE is_demo AND password_hash IS NOT NULL AND email ~ '^demo\\.(coordinator|company|recruiter|iv[1-6]|candidate0[1-3])@' ORDER BY role, email`);
    data.demoAccounts = rows;
    data.demoPassword = env.DEMO_PASSWORD;
  }
  res.json({ success: true, data });
}));

router.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const u = await auth.registerCandidate(req.body, req.ip);
  setAuthCookie(res, signToken(u));
  res.status(201).json(wrap(u));
}));

router.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const u = await auth.login(req.body, req.ip);
  setAuthCookie(res, signToken(u));
  res.json(wrap(u));
}));

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, data: { ok: true } });
});

router.get('/me', authenticate, (req, res) => res.json({ success: true, data: { user: auth.publicUser(req.user) } }));

router.post('/forgot-password', authLimiter, validate(forgotSchema), asyncHandler(async (req, res) => {
  const out = await auth.forgotPassword(req.body.email);
  res.json({ success: true, data: { ...out, message: 'If an account exists for that email, a reset link has been sent.' } });
}));

router.post('/reset-password', authLimiter, validate(resetSchema), asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body, req.ip);
  res.json({ success: true, data: { ok: true } });
}));

// Google sign-in (state is bound to the browser through an HTTP-only cookie).
router.get('/google', asyncHandler(async (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('g_state', state, { httpOnly: true, secure: env.isProd, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  res.redirect(auth.googleLoginUrl(state));
}));

router.get('/google/callback', asyncHandler(async (req, res) => {
  const fail = (msg) => res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(msg)}`);
  const { code, state, error } = req.query;
  if (error) return fail('Google sign-in was cancelled.');
  if (!code || !state || state !== req.cookies?.g_state) return fail('Google sign-in could not be verified. Please try again.');
  res.clearCookie('g_state');
  try {
    const u = await auth.googleCallback(String(code), req.ip);
    setAuthCookie(res, signToken(u));
    res.redirect(`${env.FRONTEND_URL}/auth/callback`);
  } catch (e) {
    fail(e.status ? e.message : 'Google sign-in failed. Please try again.');
  }
}));

export default router;
