import jwt from 'jsonwebtoken';
import env from '../config/env.js';

/** Short-lived signed `state` for the calendar-connect OAuth round trip (binds the callback to a coordinator). */
export const jwtState = {
  sign: (userId) => jwt.sign({ u: userId, k: 'cal' }, env.JWT_SECRET, { expiresIn: '10m' }),
  verify: (state) => {
    try {
      const p = jwt.verify(state, env.JWT_SECRET);
      return p.k === 'cal' ? p.u : null;
    } catch {
      return null;
    }
  },
};
