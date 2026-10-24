import { Router } from 'express';
import env from '../config/env.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../utils/httpError.js';
import { query } from '../config/database.js';
import * as rep from '../services/report.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data) => res.json({ success: true, data });

router.get('/dashboard', asyncHandler(async (req, res) => ok(res, await rep.dashboard(req.user))));
router.get('/drives/:driveId/reports/summary', authorize('coordinator', 'company'), asyncHandler(async (req, res) => ok(res, await rep.driveSummary(req.user, req.params.driveId))));
router.get('/drives/:driveId/reports/export', authorize('coordinator', 'company'), asyncHandler(async (req, res) => {
  const { filename, csv } = await rep.exportSchedule(req.user, req.params.driveId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

router.get('/audit', authorize('coordinator'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = (await query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.name AS actor_name, u.role AS actor_role
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::text IS NULL OR a.action ILIKE $1 || '%') ORDER BY a.id DESC LIMIT $2`,
    [req.query.action ? String(req.query.action).slice(0, 40) : null, limit],
  )).rows;
  ok(res, rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, details: r.details, createdAt: r.created_at, actor: r.actor_name ? `${r.actor_name} (${r.actor_role})` : 'System' })));
}));

router.get('/settings/status', authorize('coordinator'), asyncHandler(async (_req, res) => {
  const outbox = (await query(`SELECT status, count(*)::int AS n FROM email_outbox GROUP BY 1`)).rows;
  ok(res, {
    environment: env.NODE_ENV,
    demoMode: env.DEMO_MODE,
    googleSignIn: env.googleOAuthEnabled,
    googleCalendar: env.googleCalendarActive,
    smtp: env.smtpEnabled,
    schedulerBudget: { maxMs: env.SCHEDULER_MAX_MS, maxNodes: env.SCHEDULER_MAX_NODES },
    emailOutbox: Object.fromEntries(outbox.map((o) => [o.status, o.n])),
  });
}));

export default router;
