import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, forbidden, badRequest, notFound } from '../utils/httpError.js';
import { evaluationSchema, resultSchema } from '../utils/schemas.js';
import { query } from '../config/database.js';
import { getSessionDetail, listSessionDetails, presentSession } from '../services/session.service.js';
import { buildIcs, syncSession } from '../services/calendar.service.js';
import * as ev from '../services/evaluation.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

function assertAccess(user, row) {
  if (user.role === 'coordinator') return;
  if (!row.published) throw forbidden('This interview has not been published yet.');
  if (user.role === 'candidate' && row.candidate_id === user.id) return;
  if (user.role === 'interviewer' && row.interviewers.some((i) => i.id === user.id)) return;
  if (user.role === 'company' && user.companyId === row.company_id) return;
  throw forbidden('You do not have access to this interview.');
}

router.get('/', asyncHandler(async (req, res) => {
  const scope = String(req.query.scope || 'all');
  const params = [];
  const where = [`s.status <> 'cancelled'`];
  const p = (v) => (params.push(v), `$${params.length}`);
  if (req.user.role === 'candidate') where.push(`s.candidate_id = ${p(req.user.id)}`, 's.published');
  else if (req.user.role === 'interviewer') where.push(`s.id IN (SELECT session_id FROM interview_assignments WHERE interviewer_id = ${p(req.user.id)} AND active)`, 's.published');
  else if (req.user.role === 'company') where.push(`s.drive_id IN (SELECT id FROM recruitment_drives WHERE company_id = ${p(req.user.companyId)})`, 's.published');
  if (req.query.driveId) where.push(`s.drive_id = ${p(String(req.query.driveId))}`);
  if (scope === 'upcoming') where.push(`s.ends_at > now()`, `s.status IN ('scheduled','in_progress')`);
  if (scope === 'past') where.push(`(s.ends_at <= now() OR s.status = 'completed')`);
  if (scope === 'pending_evaluation' && req.user.role === 'interviewer')
    where.push(`s.result_status NOT IN ('passed','failed')`, `s.status IN ('scheduled','in_progress','completed')`, `NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id AND e.interviewer_id = ${p(req.user.id)})`);
  const rows = await listSessionDetails(null, where.join(' AND '), params);
  ok(res, rows.map((r) => presentSession(r, req.user)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getSessionDetail(null, req.params.id);
  assertAccess(req.user, row);
  ok(res, presentSession(row, req.user));
}));

router.get('/:id/ics', asyncHandler(async (req, res) => {
  const row = await getSessionDetail(null, req.params.id);
  assertAccess(req.user, row);
  const ics = await buildIcs(req.params.id);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
  res.send(ics.content);
}));

router.post('/:id/calendar-sync', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await syncSession(req.params.id))));

router.post('/:id/start', authorize('coordinator', 'interviewer'), asyncHandler(async (req, res) => {
  const row = await getSessionDetail(null, req.params.id);
  assertAccess(req.user, row);
  if (row.status !== 'scheduled') throw badRequest('Only scheduled interviews can be started.');
  await query(`UPDATE interview_sessions SET status = 'in_progress', updated_at = now() WHERE id = $1`, [req.params.id]);
  await query(`UPDATE drive_candidates SET pipeline_status = 'in_progress', updated_at = now() WHERE drive_id = $1 AND candidate_id = $2`, [row.drive_id, row.candidate_id]);
  ok(res, { ok: true });
}));

router.get('/:id/evaluation', authorize('coordinator', 'interviewer'), asyncHandler(async (req, res) => ok(res, await ev.getEvaluationView(req.user, req.params.id))));
router.post('/:id/evaluation', authorize('interviewer'), validate(evaluationSchema), asyncHandler(async (req, res) => ok(res, await ev.submitEvaluation(req.user, req.params.id, req.body, req.ip), 201)));
router.post('/:id/result', authorize('coordinator'), validate(resultSchema), asyncHandler(async (req, res) => ok(res, await ev.finalizeResult(req.user, req.params.id, req.body, req.ip))));
router.post('/:id/advance', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await ev.advanceCandidate(req.user, req.params.id, req.ip))));

export { notFound };
export default router;
