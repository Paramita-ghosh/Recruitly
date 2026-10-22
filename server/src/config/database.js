import pg from 'pg';
import env from './env.js';

pg.types.setTypeParser(1082, (v) => v); 
pg.types.setTypeParser(1083, (v) => v); 
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err.message);
});

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function lockDrive(client, driveId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`drive:${driveId}`]);
}

export async function closePool() {
  await pool.end();
}
