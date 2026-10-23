import { createEvent } from 'ics';
import env from '../config/env.js';
import { pool, withTransaction } from '../config/database.js';
import { oauthClient, google, CALENDAR_SCOPES } from '../config/google.js';
import { decrypt, encrypt } from '../utils/tokens.js';
import { getSessionDetail } from './session.service.js';
import { fmtWhen } from '../utils/format.js';
import { badRequest } from '../utils/httpError.js';

const ACTIVE = ['scheduled', 'in_progress', 'completed', 'no_show'];

const toArr = (d) => {
  const x = new Date(d);
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes()];
};

function describe(s) {
  const lines = [
    `${s.company_name} – ${s.drive_name}`,
    `Round: ${s.round_name}`,
    `When: ${fmtWhen(s.starts_at, s.timezone)} (${s.timezone})`,
    s.mode === 'offline' ? `Where: ${s.room_name || 'Room to be confirmed'}${s.room_location ? `, ${s.room_location}` : ''}` : `Where: Online${s.meeting_url ? ` – ${s.meeting_url}` : ' (meeting link will be shared)'}`,
    `Panel: ${s.interviewers.map((i) => i.name).join(', ')}`,
    '',
    'Please join 5 minutes early and keep a photo ID handy.',
  ];
  return lines.join('\n');
}

/** Build a downloadable ICS. The UID is stable per interview so updates/cancellations replace the original. */
export async function buildIcs(sessionId, { forViewer } = {}) {
  const s = await getSessionDetail(null, sessionId);
  const cancelled = ['cancelled', 'needs_rebooking'].includes(s.status);
  const showUrl = forViewer !== false;
  const { error, value } = createEvent({
    uid: `interview-${s.id}@recruitly`,
    sequence: s.version,
    productId: 'recruitly/interviews',
    title: `${s.company_name}: ${s.round_name} interview`,
    description: describe(s),
    start: toArr(s.starts_at),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: toArr(s.ends_at),
    endInputType: 'utc',
    endOutputType: 'utc',
    location: s.mode === 'offline' ? [s.room_name, s.room_location].filter(Boolean).join(', ') || 'On campus' : 'Online',
    url: showUrl && s.meeting_url ? s.meeting_url : undefined,
    status: cancelled ? 'CANCELLED' : 'CONFIRMED',
    method: cancelled ? 'CANCEL' : 'PUBLISH',
    organizer: { name: 'Recruitly', email: env.EMAIL_FROM.match(/<(.+)>/)?.[1] || 'no-reply@recruitly.local' },
    alarms: [{ action: 'display', description: 'Interview starts soon', trigger: { minutes: 30, before: true } }],
  });
  if (error) throw badRequest('Could not build the calendar file');
  return { filename: `interview-${s.id.slice(0, 8)}.ics`, content: value };
}

// ───────────── Google Calendar / Meet ─────────────
export function calendarConnectUrl(userId) {
  const client = oauthClient(env.googleCalendarCallbackUrl);
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: CALENDAR_SCOPES, state: userId, include_granted_scopes: true });
}

export async function saveCalendarTokens(userId, code) {
  const client = oauthClient(env.googleCalendarCallbackUrl);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw badRequest('Google did not return a refresh token. Remove Recruitly from your Google account permissions and try again.');
  client.setCredentials(tokens);
  let email = null;
  try {
    const info = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    email = info.data.email;
  } catch {
    /* optional */
  }
  await pool.query(
    `INSERT INTO calendar_integrations (user_id, account_email, refresh_token_enc, access_token_enc, expiry_at, status)
     VALUES ($1,$2,$3,$4,$5,'connected')
     ON CONFLICT (user_id) DO UPDATE SET account_email = $2, refresh_token_enc = $3, access_token_enc = $4, expiry_at = $5, status = 'connected', updated_at = now()`,
    [userId, email, encrypt(tokens.refresh_token), encrypt(tokens.access_token), tokens.expiry_date ? new Date(tokens.expiry_date) : null],
  );
}

async function organizerClient(driveCreatorId) {
  const { rows } = await pool.query(
    `SELECT ci.* FROM calendar_integrations ci JOIN users u ON u.id = ci.user_id
      WHERE ci.status = 'connected' AND u.role = 'coordinator'
      ORDER BY (ci.user_id = $1) DESC, ci.updated_at DESC LIMIT 1`,
    [driveCreatorId],
  );
  const ci = rows[0];
  if (!ci) return null;
  const client = oauthClient(env.googleCalendarCallbackUrl);
  client.setCredentials({ refresh_token: decrypt(ci.refresh_token_enc) });
  return { client, integration: ci };
}

async function recordCalendar(db, sessionId, patch) {
  const cols = { provider: 'mock', external_event_id: null, meeting_url: null, conference_status: 'not_requested', sync_status: 'pending', last_error: null, ...patch };
  await db.query(
    `INSERT INTO calendar_events (session_id, provider, external_event_id, meeting_url, conference_status, sync_status, last_error, attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1)
     ON CONFLICT (session_id, provider) DO UPDATE SET external_event_id = COALESCE($3, calendar_events.external_event_id),
       meeting_url = COALESCE($4, calendar_events.meeting_url), conference_status = $5, sync_status = $6, last_error = $7,
       attempts = calendar_events.attempts + 1, updated_at = now()`,
    [sessionId, cols.provider, cols.external_event_id, cols.meeting_url, cols.conference_status, cols.sync_status, cols.last_error],
  );
}

function googleBody(s) {
  const attendees = [{ email: s.candidate_email }, ...s.interviewers.map((i) => ({ email: i.email }))];
  const body = {
    summary: `${s.company_name}: ${s.round_name} interview – ${s.candidate_name}`,
    description: describe(s),
    start: { dateTime: new Date(s.starts_at).toISOString(), timeZone: s.timezone },
    end: { dateTime: new Date(s.ends_at).toISOString(), timeZone: s.timezone },
    attendees,
    location: s.mode === 'offline' ? [s.room_name, s.room_location].filter(Boolean).join(', ') : undefined,
    extendedProperties: { private: { recruitlySessionId: s.id } },
  };
  if (s.mode === 'online') {
    body.conferenceData = { createRequest: { requestId: `recruitly-${s.id}-v${s.version}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

function conferenceOutcome(ev) {
  const status = ev.conferenceData?.createRequest?.status?.statusCode;
  if (ev.hangoutLink) return { conference_status: 'created', meeting_url: ev.hangoutLink };
  if (status === 'failure') return { conference_status: 'failed', meeting_url: null };
  return { conference_status: 'pending', meeting_url: null };
}

/**
 * Create / update / cancel the external calendar record for one interview. Idempotent per interview:
 * an advisory lock serialises concurrent syncs and an existing Google event id is updated, never duplicated.
 * `sync_status = 'synced'` is only written after Google confirmed the operation.
 */
export async function syncSession(sessionId) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cal:${sessionId}`]);
    const s = await getSessionDetail(db, sessionId);
    const active = ACTIVE.includes(s.status);

    if (!env.googleCalendarActive) {
      if (!active) {
        await recordCalendar(db, sessionId, { provider: 'mock', sync_status: 'cancelled' });
        return { provider: 'mock', status: 'cancelled' };
      }
      if (env.DEMO_MODE) {
        // Clearly labelled placeholder – NOT a real Google Meet link.
        const url = s.mode === 'online' ? `${env.FRONTEND_URL}/demo-meeting/${s.id}` : null;
        await recordCalendar(db, sessionId, { provider: 'mock', meeting_url: url, conference_status: s.mode === 'online' ? 'mock' : 'not_requested', sync_status: 'mock' });
        return { provider: 'mock', status: 'mock', meetingUrl: url };
      }
      await recordCalendar(db, sessionId, { provider: 'google', sync_status: 'not_configured', last_error: 'Google Calendar integration is not enabled on this server.' });
      return { provider: 'google', status: 'not_configured' };
    }

    const org = await organizerClient(s.drive_created_by);
    if (!org) {
      await recordCalendar(db, sessionId, { provider: 'google', sync_status: 'not_configured', last_error: 'No coordinator has connected a Google account yet.' });
      return { provider: 'google', status: 'not_configured' };
    }
    const cal = google.calendar({ version: 'v3', auth: org.client });
    const existing = (await db.query(`SELECT external_event_id FROM calendar_events WHERE session_id = $1 AND provider = 'google'`, [sessionId])).rows[0];
    try {
      if (!active) {
        if (existing?.external_event_id) await cal.events.delete({ calendarId: 'primary', eventId: existing.external_event_id, sendUpdates: 'all' }).catch((e) => { if (e.code !== 410 && e.code !== 404) throw e; });
        await recordCalendar(db, sessionId, { provider: 'google', sync_status: 'cancelled' });
        return { provider: 'google', status: 'cancelled' };
      }
      let ev;
      if (existing?.external_event_id) {
        ev = (await cal.events.patch({ calendarId: 'primary', eventId: existing.external_event_id, conferenceDataVersion: 1, sendUpdates: 'all', requestBody: googleBody(s) })).data;
      } else {
        ev = (await cal.events.insert({ calendarId: 'primary', conferenceDataVersion: 1, sendUpdates: 'all', requestBody: googleBody(s) })).data;
      }
      const conf = s.mode === 'online' ? conferenceOutcome(ev) : { conference_status: 'not_requested', meeting_url: null };
      await recordCalendar(db, sessionId, { provider: 'google', external_event_id: ev.id, ...conf, sync_status: 'synced' });
      return { provider: 'google', status: 'synced', ...conf };
    } catch (err) {
      const invalid = /invalid_grant|Invalid Credentials|unauthorized/i.test(String(err.message));
      if (invalid) await db.query(`UPDATE calendar_integrations SET status = 'expired', updated_at = now() WHERE id = $1`, [org.integration.id]);
      await recordCalendar(db, sessionId, { provider: 'google', sync_status: 'failed', conference_status: s.mode === 'online' ? 'failed' : 'not_requested', last_error: String(err.message).slice(0, 300) });
      return { provider: 'google', status: 'failed', error: err.message };
    }
  });
}

/** Re-check Meet conferences that Google reported as still pending. */
export async function pollPendingConferences() {
  if (!env.googleCalendarActive) return 0;
  const { rows } = await pool.query(
    `SELECT ce.session_id, ce.external_event_id, s.drive_id FROM calendar_events ce
       JOIN interview_sessions s ON s.id = ce.session_id
      WHERE ce.provider = 'google' AND ce.conference_status = 'pending' AND ce.external_event_id IS NOT NULL LIMIT 20`,
  );
  let n = 0;
  for (const r of rows) {
    try {
      const d = await pool.query('SELECT created_by FROM recruitment_drives WHERE id = $1', [r.drive_id]);
      const org = await organizerClient(d.rows[0]?.created_by);
      if (!org) continue;
      const ev = (await google.calendar({ version: 'v3', auth: org.client }).events.get({ calendarId: 'primary', eventId: r.external_event_id })).data;
      const c = conferenceOutcome(ev);
      if (c.conference_status !== 'pending') {
        await pool.query(`UPDATE calendar_events SET conference_status = $2, meeting_url = COALESCE($3, meeting_url), updated_at = now() WHERE session_id = $1 AND provider = 'google'`, [r.session_id, c.conference_status, c.meeting_url]);
        n += 1;
      }
    } catch (e) {
      console.warn('[calendar] conference poll failed', e.message);
    }
  }
  return n;
}

export async function integrationStatus(userId) {
  const { rows } = await pool.query('SELECT account_email, status, updated_at FROM calendar_integrations WHERE user_id = $1', [userId]);
  return {
    googleOAuthConfigured: env.googleOAuthEnabled,
    googleCalendarEnabled: env.googleCalendarActive,
    connected: rows[0]?.status === 'connected',
    accountEmail: rows[0]?.account_email || null,
    status: rows[0]?.status || null,
    mode: env.googleCalendarActive ? 'google' : env.DEMO_MODE ? 'demo' : 'disabled',
  };
}
