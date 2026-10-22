import nodemailer from 'nodemailer';
import env from '../config/env.js';
import { pool, query } from '../config/database.js';
import { emitToUser } from '../realtime/socket.js';
import { escapeHtml } from '../utils/format.js';

export function renderEmail({ title, intro, rows = [], cta, footer }) {
  const rowHtml = rows
    .filter((r) => r && r[1] != null && r[1] !== '')
    .map(([k, v]) => `<tr><td style="padding:8px 0;color:#667085;font-size:13px;width:130px;vertical-align:top">${escapeHtml(k)}</td><td style="padding:8px 0;color:#172033;font-size:14px;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join('');
  const btn = cta
    ? `<p style="margin:28px 0 8px"><a href="${escapeHtml(cta.url)}" style="background:#3563E9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F7FB;font-family:Inter,Segoe UI,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #E5EAF2;overflow:hidden">
<tr><td style="background:#14213D;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;letter-spacing:.2px">Recruitly</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 10px;font-size:20px;color:#172033">${escapeHtml(title)}</h1>
<p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:1.6">${escapeHtml(intro)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E5EAF2">${rowHtml}</table>${btn}
<p style="margin:24px 0 0;color:#98A2B3;font-size:12px">${escapeHtml(footer || 'You are receiving this because of your Recruitly account.')}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export async function queueEmail(db, { to, subject, html, dedupeKey = null }) {
  await (db || pool).query(
    `INSERT INTO email_outbox (to_email, subject, html, dedupe_key) VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
    [to, subject, html, dedupeKey],
  );
}

/**
 * Persist an in-app notification, push it over Socket.IO and (optionally) queue an email.
 * Call AFTER the business transaction has committed. dedupeKey prevents duplicates on retries.
 */
export async function notify({ userId, category, title, body = null, link = null, dedupeKey = null, email = null }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, category, title, body, action_link, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`,
    [userId, category, title, body, link, dedupeKey],
  );
  if (!rows[0]) return null; // duplicate
  emitToUser(userId, 'notification', rows[0]);
  if (email) {
    const u = await query('SELECT email FROM users WHERE id = $1', [userId]);
    if (u.rows[0]) {
      const full = email.link ? (email.link.startsWith('http') ? email.link : `${env.FRONTEND_URL}${email.link}`) : link ? `${env.FRONTEND_URL}${link}` : null;
      await queueEmail(null, {
        to: u.rows[0].email,
        subject: email.subject || title,
        html: renderEmail({ title: email.heading || title, intro: email.intro || body || '', rows: email.rows || [], cta: full ? { label: email.cta || 'Open Recruitly', url: full } : null }),
        dedupeKey: dedupeKey ? `email:${userId}:${dedupeKey}` : null,
      });
    }
  }
  return rows[0];
}

let transporter = null;
function getTransporter() {
  if (!env.smtpEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Deliver pending emails. Without SMTP they are marked `logged_only` – never reported as sent. */
export async function processOutbox(limit = 20) {
  const tx = getTransporter();
  const client = await pool.connect();
  let sent = 0;
  let logged = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const m of rows) {
      if (!tx) {
        logged += 1;
        await client.query(`UPDATE email_outbox SET status = 'logged_only', attempts = attempts + 1 WHERE id = $1`, [m.id]);
        continue;
      }
      try {
        await tx.sendMail({ from: env.EMAIL_FROM, to: m.to_email, subject: m.subject, html: m.html });
        await client.query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [m.id]);
        sent += 1;
      } catch (err) {
        const failed = m.attempts + 1 >= 5;
        await client.query(`UPDATE email_outbox SET status = $2, attempts = attempts + 1, last_error = $3 WHERE id = $1`, [m.id, failed ? 'failed' : 'pending', String(err.message).slice(0, 300)]);
      }
    }
    await client.query('COMMIT');
    if (logged) console.log(`[email] ${logged} email(s) NOT sent: SMTP is not configured (stored as logged_only in email_outbox)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return sent;
}

export async function notifyMany(userIds, payload) {
  for (const id of new Set(userIds)) await notify({ ...payload, userId: id, dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${id}` : null });
}
