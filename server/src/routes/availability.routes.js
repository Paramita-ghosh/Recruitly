import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest } from '../utils/httpError.js';
import { availabilitySchema, exceptionSchema } from '../utils/schemas.js';
import * as av from '../services/availability.service.js';
import { assertDriveAccess } from '../services/drive.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const target = (req) => req.query.userId || req.body?.userId || req.user.id;

router.get('/overview', authorize('coordinator'), asyncHandler(async (req, res) => {
  if (!req.query.driveId) throw badRequest('driveId is required');
  await assertDriveAccess(req.user, String(req.query.driveId));
  ok(res, await av.overview(String(req.query.driveId)));
}));
router.get('/busy', asyncHandler(async (req, res) => {
  const uid = target(req);
  av.assertSelfOrCoordinator(req.user, uid);
  ok(res, await av.busySessions(uid, req.user.id === uid ? req.user.role : String(req.query.role || 'candidate')));
}));
router.get('/', asyncHandler(async (req, res) => {
  const uid = target(req);
  av.assertSelfOrCoordinator(req.user, uid);
  ok(res, await av.getAvailability(uid));
}));
router.put('/', validate(availabilitySchema), asyncHandler(async (req, res) => ok(res, await av.saveRules(req.user, target(req), req.body.rules, req.ip))));
router.post('/exceptions', validate(exceptionSchema), asyncHandler(async (req, res) => ok(res, await av.addException(req.user, target(req), req.body), 201)));
router.delete('/exceptions/:id', asyncHandler(async (req, res) => ok(res, await av.deleteException(req.user, target(req), req.params.id))));

export default router;
