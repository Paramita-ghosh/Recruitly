import { Router } from 'express';
import env from '../config/env.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import * as cal from '../services/calendar.service.js';
import { hashToken } from '../utils/tokens.js';
import { jwtState } from '../utils/oauthState.js';

const router = Router();
const ok = (res, data) => res.json({ success: true, data });

router.get('/status', authenticate, authorize('coordinator'), asyncHandler(async (req, res) => ok(res, await cal.integrationStatus(req.user.id))));

router.get('/google/connect', authenticate, authorize('coordinator'), asyncHandler(async (req, res) => {
  if (!env.googleCalendarActive) throw new HttpError(501, 'Google Calendar is not enabled. Set GOOGLE_CALENDAR_ENABLED=true and the Google credentials in backend/.env.');
  ok(res, { url: cal.calendarConnectUrl(jwtState.sign(req.user.id)) });
}));

router.get('/google/callback', asyncHandler(async (req, res) => {
  const back = (q) => res.redirect(`${env.FRONTEND_URL}/coordinator/settings?${q}`);
  try {
    const userId = jwtState.verify(String(req.query.state || ''));
    if (!req.query.code || !userId) return back('calendar=error');
    await cal.saveCalendarTokens(userId, String(req.query.code));
    back('calendar=connected');
  } catch (e) {
    console.error('[calendar] connect failed', e.message);
    back('calendar=error');
  }
}));
void hashToken;
export default router;
