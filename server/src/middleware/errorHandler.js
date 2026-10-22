import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import env from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { message: `Route not found: ${req.method} ${req.path}` } });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        message: err.issues[0] ? `${err.issues[0].path.join('.') || 'input'}: ${err.issues[0].message}` : 'Invalid input',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: { message: 'Malformed JSON body' } });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: { message: 'File is too large (max 2 MB).' } });

  // PostgreSQL errors are mapped to safe messages; SQL text is never returned.
  if (err?.code === '23P01')
    return res.status(409).json({ success: false, error: { message: 'That time is no longer available. Please choose another slot.', code: 'SLOT_TAKEN' } });
  if (err?.code === '23505') return res.status(409).json({ success: false, error: { message: 'A record with these details already exists.' } });
  if (err?.code === '23503') return res.status(400).json({ success: false, error: { message: 'A referenced record does not exist.' } });
  if (err?.code === '23514') {
    const m = /Rubric weights/.test(err.message) ? err.message : 'A value is outside the allowed range.';
    return res.status(400).json({ success: false, error: { message: m } });
  }
  if (err?.code === '22P02') return res.status(400).json({ success: false, error: { message: 'Invalid identifier format.' } });

  console.error('[error]', req.method, req.originalUrl, err?.stack || err);
  res.status(500).json({
    success: false,
    error: { message: 'Something went wrong on our side. Please try again.', ...(env.isProd ? {} : { debug: err?.message }) },
  });
}
