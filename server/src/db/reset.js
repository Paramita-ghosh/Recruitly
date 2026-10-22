import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import { pool, closePool } from '../config/database.js';
import { migrate } from './migrate.js';

export async function resetDatabase() {
  if (env.isProd) throw new Error('Refusing to reset the database in production.');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  resetDatabase()
    .then(() => closePool())
    .catch((e) => {
      console.error(e.message);
      closePool().finally(() => process.exit(1));
    });
}
