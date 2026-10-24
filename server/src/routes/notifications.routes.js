import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler, notFound } from '../utils/httpError.js';
import { query } from '../config/database.js';

const router = Router();
router.use(authenticate);
const ok = (res, data) => res.json({ success: true, data });
const shape = (n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, link: n.action_link, read: Boolean(n.read_at), createdAt: n.created_at });

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = (await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [req.user.id, limit])).rows;
  const unread = (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n;
  ok(res, { unread, items: rows.map(shape) });
}));
router.post('/read-all', asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  ok(res, { ok: true });
}));
router.patch('/:notificationId/read', asyncHandler(async (req, res) => {
  const r = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.notificationId, req.user.id]);
  if (!r.rows[0]) throw notFound('Notification not found');
  ok(res, shape(r.rows[0]));
}));
export default router;
