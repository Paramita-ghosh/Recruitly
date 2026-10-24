import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest } from '../utils/httpError.js';
import { generateSchema, overrideSchema, previewRescheduleSchema } from '../utils/schemas.js';
import { assertDriveAccess } from '../services/drive.service.js';
import * as sch from '../services/scheduling.service.js';
import * as rs from '../services/reschedule.service.js';
import * as bk from '../services/booking.service.js';
import * as ev from '../services/evaluation.service.js';
import { query } from '../config/database.js';
import { z } from 'zod';
import { uuid } from '../utils/schemas.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const coord = authorize('coordinator');

router.post('/drives/:driveId/schedules/generate', coord, validate(generateSchema), asyncHandler(async (req, res) => ok(res, await sch.generateSchedule(req.user, req.params.driveId, req.body, req.ip))));
router.get('/drives/:driveId/schedules', authorize('coordinator', 'company'), asyncHandler(async (req, res) => {
  await assertDriveAccess(req.user, req.params.driveId);
  const rows = await sch.getSchedule(req.user, req.params.driveId, { roundId: req.query.roundId });
  ok(res, req.user.role === 'company' ? rows.filter((r) => r.published) : rows);
}));
router.post('/drives/:driveId/schedules/validate', coord, asyncHandler(async (req, res) => ok(res, await sch.validateCurrent(req.params.driveId))));
router.get('/drives/:driveId/schedules/quality', coord, asyncHandler(async (req, res) => ok(res, await sch.qualityReport(req.params.driveId, req.query.roundId))));
router.get('/drives/:driveId/unscheduled', coord, asyncHandler(async (req, res) => ok(res, await sch.latestUnscheduled(req.params.driveId, req.query.roundId))));
router.post('/drives/:driveId/schedules/publish', coord, asyncHandler(async (req, res) => ok(res, await sch.publishSchedule(req.user, req.params.driveId, req.ip))));
router.get('/drives/:driveId/schedule-runs', coord, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id, round_id, status, stats, quality, created_at FROM schedule_runs WHERE drive_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.driveId]);
  ok(res, rows);
}));
router.post('/drives/:driveId/results/publish', coord, asyncHandler(async (req, res) => ok(res, await ev.publishResults(req.user, req.params.driveId))));

router.post('/drives/:driveId/booking-links', coord, validate(z.object({ roundId: uuid, candidateIds: z.array(uuid).optional() })), asyncHandler(async (req, res) => ok(res, await bk.issueLinks(req.user, req.params.driveId, req.body))));
router.post('/booking-links', coord, validate(z.object({ driveId: uuid, roundId: uuid, candidateId: uuid })), asyncHandler(async (req, res) => {
  const l = await bk.coordinatorLink(req.user, req.body);
  ok(res, { url: l.url, expiresAt: l.expiresAt });
}));

router.get('/sessions/:sessionId/override-options', coord, asyncHandler(async (req, res) => {
  if (!req.query.startsAt) throw badRequest('startsAt is required');
  ok(res, await sch.overrideOptions(req.params.sessionId, String(req.query.startsAt)));
}));
router.patch('/sessions/:sessionId/override', coord, validate(overrideSchema), asyncHandler(async (req, res) => ok(res, await sch.overrideSession(req.user, req.params.sessionId, req.body, req.ip))));
router.post('/sessions/:sessionId/cancel', coord, asyncHandler(async (req, res) => ok(res, await sch.cancelSession(req.user, req.params.sessionId, req.body?.reason, req.ip))));

router.post('/drives/:driveId/reschedules/preview', coord, validate(previewRescheduleSchema), asyncHandler(async (req, res) => ok(res, await rs.previewReschedule(req.user, req.params.driveId, req.body), 201)));
router.get('/drives/:driveId/reschedules', coord, asyncHandler(async (req, res) => ok(res, await rs.listRuns(req.params.driveId))));
router.get('/drives/:driveId/reschedules/:runId', coord, asyncHandler(async (req, res) => ok(res, await rs.getRun(null, req.params.runId))));
router.post('/drives/:driveId/reschedules/:runId/approve', coord, asyncHandler(async (req, res) => ok(res, await rs.approveReschedule(req.user, req.params.driveId, req.params.runId, req.ip))));
router.post('/drives/:driveId/reschedules/:runId/discard', coord, asyncHandler(async (req, res) => { await rs.discardReschedule(req.user, req.params.driveId, req.params.runId); ok(res, { ok: true }); }));

export default router;
