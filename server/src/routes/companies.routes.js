import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/httpError.js';
import { companySchema } from '../utils/schemas.js';
import * as drives from '../services/drive.service.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/', authorize('coordinator', 'company'), asyncHandler(async (req, res) => ok(res, await drives.listCompanies(req.user))));
router.post('/', authorize('coordinator'), validate(companySchema), asyncHandler(async (req, res) => ok(res, await drives.createCompany(req.user, req.body), 201)));
router.patch('/:id', authorize('coordinator', 'company'), validate(companySchema.partial()), asyncHandler(async (req, res) => ok(res, await drives.updateCompany(req.user, req.params.id, req.body))));

export default router;
