import http from 'node:http';
import env from './config/env.js';
//import { createApp } from './app.js';
//import { initSocket } from './realtime/socket.js';
//import { startJobs } from './jobs/reminders.job.js';
//import { migrate } from './db/migrate.js';
//import { pool, closePool } from './config/database.js';

async function main() {
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    console.error(`\n[db] Cannot connect to PostgreSQL (${e.message}).\nCheck DATABASE_URL in backend/.env and that PostgreSQL is running.\n`);
    process.exit(1);
  }
  await migrate();
  const server = http.createServer(createApp());
  initSocket(server);
  server.listen(env.PORT, () => {
    console.log(`\n  Recruitly API listening on ${env.BACKEND_URL}  (${env.NODE_ENV})`);
    console.log(`  Demo mode: ${env.DEMO_MODE ? 'ON' : 'off'} | Google sign-in: ${env.googleOAuthEnabled ? 'on' : 'off'} | Google Calendar: ${env.googleCalendarActive ? 'on' : 'off'} | SMTP: ${env.smtpEnabled ? 'on' : 'off (emails logged only)'}\n`);
  });
  startJobs();
  const stop = () => server.close(() => closePool().finally(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
