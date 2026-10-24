import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler } from '../utils/httpError.js';
import * as ev from '../services/evaluation.service.js';

const router = Router();
router.use(authenticate);
router.get('/drives/:driveId/rankings', authorize('coordinator', 'company'), asyncHandler(async (req, res) => {
  const data = req.user.role === 'company' ? await ev.companySummary(req.user, req.params.driveId) : await ev.rankings(req.user, req.params.driveId);
  res.json({ success: true, data });
}));
export default router;
