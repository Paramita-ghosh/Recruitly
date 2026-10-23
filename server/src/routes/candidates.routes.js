import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler, forbidden, notFound } from '../utils/httpError.js';
import { query } from '../config/database.js';
import * as av from '../services/availability.service.js';
import * as booking from '../services/booking.service.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { uuid } from '../utils/schemas.js';

const router = Router();
router.use(authenticate);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/candidates', authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await av.listUsers('candidate', req.query.search ? String(req.query.search).slice(0, 80) : null))));

/** Coordinators see any candidate; a company only sees candidates inside its own drives. */
router.get('/candidates/:id', authorize('coordinator', 'company'), asyncHandler(async (req, res) => {
  if (req.user.role === 'company') {
    const link = await query(`SELECT 1 FROM drive_candidates dc JOIN recruitment_drives d ON d.id = dc.drive_id WHERE dc.candidate_id = $1 AND d.company_id = $2`, [req.params.id, req.user.companyId]);
    if (!link.rows[0]) throw forbidden('This candidate is not part of any of your drives.');
  }
  const p = await av.getProfile(req.params.id);
  if (p.role !== 'candidate') throw notFound('Candidate not found');
  ok(res, { id: p.id, name: p.name, email: p.email, ...p.candidate, ...(req.user.role === 'coordinator' ? { phone: p.phone } : {}) });
}));

// A signed-in candidate fetches their own booking link (ownership enforced by the service).
router.post('/candidate/booking-link', authorize('candidate'), validate(z.object({ driveId: uuid, roundId: uuid.optional() })), asyncHandler(async (req, res) => {
  const l = await booking.candidateOwnLink(req.user, req.body.driveId, req.body.roundId);
  ok(res, { url: l.url, expiresAt: l.expiresAt });
}));

export default router;
