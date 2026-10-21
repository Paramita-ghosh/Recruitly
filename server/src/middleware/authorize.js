import { forbidden } from '../utils/httpError.js';

/** Role gate. The role always comes from the database-backed session, never from the client. */
export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
