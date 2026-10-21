import rateLimit from 'express-rate-limit';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message } },
    skip: () => process.env.NODE_ENV === 'test',
  });

export const apiLimiter = make(60_000, 600, 'Too many requests. Please slow down.');
export const authLimiter = make(15 * 60_000, 30, 'Too many attempts. Please try again in a few minutes.');
export const bookingLimiter = make(60_000, 60, 'Too many booking requests. Please slow down.');
