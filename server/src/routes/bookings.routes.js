import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { bookingLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/httpError.js';
import { bookingSchema } from '../utils/schemas.js';
import * as bk from '../services/booking.service.js';
import { buildIcs } from '../services/calendar.service.js';
import { query } from '../config/database.js';
import { hashToken } from '../utils/tokens.js';
import { notFound } from '../utils/httpError.js';

// Public, token-authenticated endpoints. Tokens are random 256-bit values; only their hash is stored.
const router = Router();
router.use(bookingLimiter);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/:token', asyncHandler(async (req, res) => ok(res, await bk.getBooking(req.params.token))));
router.get('/:token/slots', asyncHandler(async (req, res) => ok(res, await bk.getSlots(req.params.token))));
router.post('/:token/confirm', validate(bookingSchema), asyncHandler(async (req, res) => ok(res, await bk.confirmBooking(req.params.token, req.body, req.ip))));
router.post('/:token/accept', asyncHandler(async (req, res) => ok(res, await bk.acceptProposed(req.params.token, req.ip))));
router.post('/:token/reschedule', validate(bookingSchema), asyncHandler(async (req, res) => ok(res, await bk.rescheduleBooking(req.params.token, req.body, req.ip))));
router.get('/:token/ics', asyncHandler(async (req, res) => {
  const b = await bk.getBooking(req.params.token);
  if (!b.session) throw notFound('No interview to download yet.');
  void query; void hashToken;
  const ics = await buildIcs(b.session.id);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ics.filename}"`);
  res.send(ics.content);
}));

export default router;
