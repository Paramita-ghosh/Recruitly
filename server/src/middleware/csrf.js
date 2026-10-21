import { COOKIE } from './authenticate.js';
import { HttpError } from '../utils/httpError.js';

/**
 * CSRF defence for cookie-authenticated, state-changing requests.
 * Browsers cannot attach a custom header cross-site without a CORS preflight, which our CORS policy
 * only allows for FRONTEND_URL. Combined with SameSite=Lax cookies this blocks forged requests.
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.cookies?.[COOKIE]) return next();
  if (req.headers['x-requested-with'] !== 'recruitly') return next(new HttpError(403, 'Missing CSRF header'));
  next();
}
