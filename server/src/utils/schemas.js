import { z } from 'zod';

export const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time');
const tz = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use at least one letter and one number');

export const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(128) });
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  password,
  regNo: z.string().trim().max(40).optional(),
  department: z.string().trim().max(80).optional(),
  branch: z.string().trim().max(80).optional(),
  gradYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password });
export const inviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  role: z.enum(['interviewer', 'company', 'coordinator', 'candidate']),
  companyId: uuid.optional(),
  title: z.string().max(100).optional(),
});

const driveBase = {
  name: z.string().trim().min(3).max(150),
  description: z.string().max(2000).optional().nullable(),
  companyId: uuid.optional(),
  timezone: tz.default('Asia/Kolkata'),
  startDate: dateStr,
  endDate: dateStr,
  dayStart: hhmm.default('09:00'),
  dayEnd: hhmm.default('17:00'),
  slotMinutes: z.coerce.number().int().min(5).max(120).default(30),
  defaultDurationMinutes: z.coerce.number().int().min(5).max(240).default(30),
  bufferMinutes: z.coerce.number().int().min(0).max(120).default(0),
  modePolicy: z.enum(['any', 'offline_only', 'online_only']).default('any'),
  selfBookingEnabled: z.boolean().default(true),
  bookingDeadline: isoDate.optional().nullable(),
  rescheduleDeadline: isoDate.optional().nullable(),
  eligibility: z.record(z.any()).optional(),
};
const dateOrder = (d) => !d.startDate || !d.endDate || d.endDate >= d.startDate;
const timeOrder = (d) => !d.dayStart || !d.dayEnd || d.dayEnd > d.dayStart;
export const createDriveSchema = z
  .object({ ...driveBase, defaultPipeline: z.boolean().default(true) })
  .refine(dateOrder, { message: 'End date must be on or after the start date', path: ['endDate'] })
  .refine(timeOrder, { message: 'Day end must be after day start', path: ['dayEnd'] });
export const updateDriveSchema = z
  .object(Object.fromEntries(Object.entries(driveBase).map(([k, v]) => [k, v.optional()])))
  .extend({ status: z.enum(['draft', 'collecting_availability', 'ready_to_schedule', 'schedule_generated', 'published', 'in_progress', 'completed', 'cancelled']).optional() })
  .refine(dateOrder, { message: 'End date must be on or after the start date', path: ['endDate'] })
  .refine(timeOrder, { message: 'Day end must be after day start', path: ['dayEnd'] });

const modes = z.array(z.enum(['offline', 'online'])).min(1);
export const roundSchema = z.object({
  name: z.string().trim().min(2).max(80),
  position: z.coerce.number().int().min(1).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(240),
  panelSize: z.coerce.number().int().min(1).max(5).default(1),
  allowedModes: modes.default(['offline', 'online']),
  minRoomCapacity: z.coerce.number().int().min(1).max(50).optional().nullable(),
  requiredEquipment: z.array(z.string().max(40)).default([]),
  passThreshold: z.coerce.number().min(0).max(100).default(60),
  requiresReview: z.boolean().default(false),
  bookingPolicy: z.enum(['auto', 'self_book']).default('self_book'),
  prerequisiteRoundId: uuid.optional().nullable(),
  skillIds: z.array(z.coerce.number().int()).optional(),
  panelRequirements: z.array(z.object({ skillId: z.coerce.number().int(), minCount: z.coerce.number().int().min(1).max(5) })).optional(),
});
export const roundPatchSchema = roundSchema.partial();

export const rubricSchema = z.object({
  name: z.string().trim().min(2).max(100).default('Rubric'),
  scaleMin: z.coerce.number().int().min(0).max(10).default(1),
  scaleMax: z.coerce.number().int().min(2).max(10).default(5),
  criteria: z
    .array(z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(300).optional(), weight: z.coerce.number().gt(0).max(100) }))
    .min(1)
    .max(12),
});

export const roomSchema = z.object({
  name: z.string().trim().min(1).max(60),
  location: z.string().max(120).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(200).default(4),
  equipment: z.array(z.string().max(40)).default([]),
  accessible: z.boolean().default(false),
});
export const roomPatchSchema = roomSchema.partial().extend({ isActive: z.boolean().optional() });
export const roomBlockSchema = z.object({ startsAt: isoDate, endsAt: isoDate, reason: z.string().max(120).optional() }).refine((b) => Date.parse(b.endsAt) > Date.parse(b.startsAt), 'End must be after start');

export const availabilitySchema = z.object({
  userId: uuid.optional(),
  rules: z.array(z.object({ weekday: z.coerce.number().int().min(0).max(6), startTime: hhmm.transform((s) => s.slice(0, 5)), endTime: hhmm.transform((s) => s.slice(0, 5)), kind: z.enum(['available', 'preferred']).default('available') })).max(400),
});
export const exceptionSchema = z
  .object({ userId: uuid.optional(), date: dateStr, startTime: hhmm.optional().nullable(), endTime: hhmm.optional().nullable(), kind: z.enum(['available', 'unavailable']), reason: z.string().max(200).optional() })
  .refine((e) => (!e.startTime && !e.endTime) || (e.startTime && e.endTime && e.endTime > e.startTime), 'Provide both start and end (end after start), or neither for the whole day');
export const cancelAvailabilitySchema = z
  .object({ date: dateStr, startTime: hhmm.optional().nullable(), endTime: hhmm.optional().nullable(), reason: z.string().max(200).optional() })
  .refine((e) => (!e.startTime && !e.endTime) || (e.startTime && e.endTime && e.endTime > e.startTime), 'Provide both start and end (end after start), or neither for the whole day');

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().max(30).optional().nullable(),
  bio: z.string().max(1000).optional().nullable(),
  candidate: z.object({ regNo: z.string().max(40).optional(), department: z.string().max(80).optional(), branch: z.string().max(80).optional(), gradYear: z.coerce.number().int().min(2000).max(2100).optional(), cgpa: z.coerce.number().min(0).max(10).optional() }).optional(),
  interviewer: z.object({ dailyCapacity: z.coerce.number().int().min(1).max(30).optional(), minBreakMinutes: z.coerce.number().int().min(0).max(120).optional(), modes: z.enum(['offline_only', 'online_only', 'both_prefer_offline', 'both_prefer_online']).optional(), title: z.string().max(100).optional(), skillIds: z.array(z.coerce.number().int()).max(20).optional() }).optional(),
});

export const companySchema = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['company', 'college']).optional(), description: z.string().max(1000).optional(), website: z.string().max(200).optional(), industry: z.string().max(80).optional(), location: z.string().max(120).optional() });

export const membersSchema = z.object({ ids: z.array(uuid).max(1000).optional(), all: z.boolean().optional() }).refine((b) => b.all || (b.ids && b.ids.length), 'Choose at least one person');

export const generateSchema = z.object({ roundId: uuid.optional() });
export const bookingSchema = z.object({ startsAt: isoDate, mode: z.enum(['offline', 'online']).optional() });
export const overrideSchema = z.object({ startsAt: isoDate, mode: z.enum(['offline', 'online']), roomId: uuid.optional().nullable(), interviewerIds: z.array(uuid).min(1).max(5), note: z.string().max(300).optional() });
export const previewRescheduleSchema = z.object({ interviewerId: uuid, windowStart: isoDate, windowEnd: isoDate, reason: z.string().max(300).optional() });

export const evaluationSchema = z.object({
  scores: z.array(z.object({ criterionId: uuid, score: z.coerce.number(), comment: z.string().max(500).optional() })).min(1),
  comments: z.string().max(3000).optional(),
  recommendation: z.enum(['strong_yes', 'yes', 'no', 'strong_no']).optional(),
});
export const resultSchema = z.object({ decision: z.enum(['pass', 'fail']), note: z.string().max(500).optional() });
export const statusSchema = z.object({ status: z.enum(['eligible', 'awaiting_booking', 'scheduled', 'in_progress', 'evaluation_pending', 'passed', 'failed', 'needs_rebooking', 'completed']), note: z.string().max(300).optional() });
