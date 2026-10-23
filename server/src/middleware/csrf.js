import { COOKIE } from './authenticate.js';
import { HttpError } from '../utils/httpError.js';


export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.cookies?.[COOKIE]) return next();
  if (req.headers['x-requested-with'] !== 'recruitly') return next(new HttpError(403, 'Missing CSRF header'));
  next();
}
