
import http from 'node:http';
import env from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool, closePool } from './config/database.js';

async function main() {
  try {
    await pool.query('SELECT 1');
    console.log('[db] PostgreSQL connected.');

    await migrate();

    const app = createApp();
    const server = http.createServer(app);

    server.listen(env.PORT, () => {
      console.log(
        `\nRecruitly API listening on ${env.BACKEND_URL} (${env.NODE_ENV})`
      );
      console.log(
        `Demo mode: ${env.DEMO_MODE ? 'ON' : 'off'} | ` +
        `Google sign-in: ${env.googleOAuthEnabled ? 'on' : 'off'} | ` +
        `Google Calendar: ${env.googleCalendarActive ? 'on' : 'off'} | ` +
        `SMTP: ${env.smtpEnabled ? 'on' : 'off (emails logged only)'}\n`
      );
    });

    const stop = () => {
      server.close(() => {
        closePool().finally(() => process.exit(0));
      });
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error('[startup] Failed to start Recruitly:', error.message);
    await closePool().catch(() => {});
    process.exitCode = 1;
  }
}

main();
