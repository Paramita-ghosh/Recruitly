import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:5000'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  TOKEN_ENC_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_CALLBACK_URL: z.string().optional().default(''),
  GOOGLE_CALENDAR_CALLBACK_URL: z.string().optional().default(''),
  GOOGLE_CALENDAR_ENABLED: bool(false),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().optional().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Recruitly <no-reply@recruitly.local>'),

  DEMO_MODE: bool(true),
  DEMO_PASSWORD: z.string().default('Recruitly@Demo1'),
  ALLOW_EARLY_EVALUATION: bool(true),
  SCHEDULER_MAX_MS: z.coerce.number().int().positive().default(4000),
  SCHEDULER_MAX_NODES: z.coerce.number().int().positive().default(20000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
  console.error('Copy backend/.env.example to backend/.env and fill in the values.\n');
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET.length < 32) {
    console.error('[config] JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
  // Demo credentials must never be active in production.
  env.DEMO_MODE = false;
}

env.isProd = env.NODE_ENV === 'production';
env.googleOAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
env.googleCallbackUrl = env.GOOGLE_CALLBACK_URL || `${env.BACKEND_URL}/api/auth/google/callback`;
env.googleCalendarCallbackUrl =
  env.GOOGLE_CALENDAR_CALLBACK_URL || `${env.BACKEND_URL}/api/calendar/google/callback`;
env.smtpEnabled = Boolean(env.SMTP_HOST);
env.googleCalendarActive = env.GOOGLE_CALENDAR_ENABLED && env.googleOAuthEnabled;

export default env;
