import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

/** Points the process at a separate "<db>_test" database (created on demand) before the app is imported. */
export async function prepareTestEnv() {
  const envFile = path.resolve(import.meta.dirname, '../../.env');
  const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
  const base = new URL(process.env.DATABASE_URL || parsed.DATABASE_URL || 'postgresql://recruitly:recruitly@localhost:5432/recruitly');
  const name = `${base.pathname.slice(1).replace(/_test$/, '')}_test`;
  const admin = new pg.Client({ connectionString: (() => { const u = new URL(base); u.pathname = '/postgres'; return u.toString(); })() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rows[0]) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  base.pathname = `/${name}`;
  process.env.DATABASE_URL = base.toString();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || parsed.JWT_SECRET || 'test-secret-for-recruitly-0123456789';
  process.env.DEMO_MODE = 'true';
  process.env.SMTP_HOST = '';
  process.env.GOOGLE_CALENDAR_ENABLED = 'false';
  return process.env.DATABASE_URL;
}

export class Api {
  constructor(base) {
    this.base = base;
    this.cookie = null;
  }

  async req(method, url, body, { form, headers = {} } = {}) {
    const h = { 'x-requested-with': 'recruitly', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}${url}`, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [kv] = c.split(';');
      if (kv.startsWith('recruitly_token=')) this.cookie = kv.endsWith('=') ? null : kv;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, body: data, data: data?.data, headers: res.headers };
  }

  get = (u) => this.req('GET', u);
  post = (u, b) => this.req('POST', u, b ?? {});
  put = (u, b) => this.req('PUT', u, b);
  patch = (u, b) => this.req('PATCH', u, b);

  async login(email, password = 'Recruitly@Demo1') {
    this.cookie = null;
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }
}
