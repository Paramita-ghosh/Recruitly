import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, forbidden } from '../utils/httpError.js';
import { cancelAvailabilitySchema } from '../utils/schemas.js';
import * as av from '../services/availability.service.js';
import * as rs from '../services/reschedule.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/interviewers', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await av.listUsers('interviewer', req.query.search ? String(req.query.search).slice(0, 80) : null))));

router.post('/interviewers/:interviewerId/cancel-availability', authorize('coordinator', 'interviewer'), validate(cancelAvailabilitySchema), asyncHandler(async (req, res) => {
  if (req.user.role === 'interviewer' && req.user.id !== req.params.interviewerId) throw forbidden('You can only cancel your own availability.');
  ok(res, await rs.cancelAvailability(req.user, req.params.interviewerId, req.body));
}));

export default router;
