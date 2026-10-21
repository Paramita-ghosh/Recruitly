import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../utils/httpError.js';
import { profileSchema, inviteSchema } from '../utils/schemas.js';
import { query } from '../config/database.js';
import * as av from '../services/availability.service.js';
import * as auth from '../services/auth.service.js';
import { audit } from '../utils/audit.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/skills', asyncHandler(async (_req, res) => ok(res, await av.listSkills())));
router.get('/users/me/profile', asyncHandler(async (req, res) => ok(res, await av.getProfile(req.user.id))));
router.patch('/users/me/profile', validate(profileSchema), asyncHandler(async (req, res) => ok(res, await av.updateProfile(req.user, req.user.id, req.body, req.ip))));

router.get('/users', authorize('coordinator'), asyncHandler(async (req, res) => {
  const role = String(req.query.role || 'candidate');
  if (!['candidate', 'interviewer', 'coordinator', 'company'].includes(role)) throw badRequest('Unknown role');
  ok(res, await av.listUsers(role, req.query.search ? String(req.query.search).slice(0, 80) : null));
}));
router.get('/users/:id/profile', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await av.getProfile(req.params.id))));
router.patch('/users/:id/profile', authorize('coordinator'), validate(profileSchema), asyncHandler(async (req, res) => ok(res, await av.updateProfile(req.user, req.params.id, req.body, req.ip))));

router.post('/users/invite', authorize('coordinator'), validate(inviteSchema), asyncHandler(async (req, res) => ok(res, await auth.inviteUser(req.user, req.body, req.ip), 201)));
router.post('/users/:id/resend-invite', authorize('coordinator'), asyncHandler(async (req, res) => {
  const u = (await query('SELECT id, name, email, role, password_hash FROM users WHERE id = $1', [req.params.id])).rows[0];
  if (!u) throw notFound('User not found');
  if (u.password_hash) throw badRequest('This account is already activated.');
  ok(res, await auth.sendInvite(u));
}));
router.patch('/users/:id/active', authorize('coordinator'), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw badRequest('You cannot deactivate your own account.');
  const active = Boolean(req.body?.active);
  const r = await query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, active]);
  if (!r.rows[0]) throw notFound('User not found');
  await audit(null, { actorId: req.user.id, action: active ? 'user.activate' : 'user.deactivate', entityType: 'user', entityId: req.params.id });
  ok(res, { id: req.params.id, active });
}));

export default router;
