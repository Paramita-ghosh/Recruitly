import cron from 'node-cron';
import { query } from '../config/database.js';
import { notify } from '../services/notification.service.js';
import { fmtWhen } from '../utils/format.js';
import { pollPendingConferences } from '../services/calendar.service.js';
import { processOutbox } from '../services/notification.service.js';

/** Sends 24h and 1h reminders. The dupdatedupe key makes the job safe to run repeatedly / on several instances. */
export async function sendReminders() {
  let sent = 0;
  for (const [label, from, to] of [['24h', 23.5, 24.5], ['1h', 0.5, 1.5]]) {
    const { rows } = await query(
      `SELECT s.id, s.candidate_id, s.starts_at, s.mode, d.timezone, c.name AS company, rd.name AS round, cu.name AS candidate_name,
              COALESCE((SELECT json_agg(a.interviewer_id) FROM interview_assignments a WHERE a.session_id = s.id AND a.active), '[]') AS ivs
         FROM interview_sessions s JOIN recruitment_drives d ON d.id = s.drive_id JOIN companies c ON c.id = d.company_id
         JOIN interview_rounds rd ON rd.id = s.round_id JOIN users cu ON cu.id = s.candidate_id
        WHERE s.status = 'scheduled' AND s.published AND s.starts_at BETWEEN now() + ($1 || ' hours')::interval AND now() + ($2 || ' hours')::interval`,
      [String(from), String(to)],
    );
    for (const s of rows) {
      const when = fmtWhen(s.starts_at, s.timezone);
      const r = await notify({ userId: s.candidate_id, category: 'reminder', title: `Interview ${label === '24h' ? 'tomorrow' : 'in about an hour'}`, body: `${s.round} with ${s.company} – ${when}`, link: '/candidate/interviews', dedupeKey: `reminder:${s.id}:${label}`, email: { subject: `Reminder: ${s.company} ${s.round} interview – ${when}`, intro: 'This is a friendly reminder about your upcoming interview.', rows: [['Company', s.company], ['Round', s.round], ['When', when], ['Mode', s.mode === 'offline' ? 'In person' : 'Online']], cta: 'View details' } });
      if (r) sent += 1;
      for (const iv of s.ivs) {
        const r2 = await notify({ userId: iv, category: 'reminder', title: `Interview ${label === '24h' ? 'tomorrow' : 'in about an hour'}: ${s.candidate_name}`, body: `${s.round} – ${when}`, link: `/interviewer/interviews/${s.id}`, dedupeKey: `reminder:${s.id}:${label}:i` });
        if (r2) sent += 1;
      }
    }
  }
  return sent;
}

export function startJobs() {
  const guard = (name, fn) => async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[job:${name}]`, e.message);
    }
  };
  cron.schedule('*/15 * * * * *', guard('outbox', () => processOutbox()));
  cron.schedule('*/10 * * * *', guard('reminders', sendReminders));
  cron.schedule('*/2 * * * *', guard('meet-poll', pollPendingConferences));
  console.log('[jobs] scheduled: email outbox (15s), reminders (10m), Meet conference polling (2m)');
}
