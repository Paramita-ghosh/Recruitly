import { pool } from '../config/database.js';

export async function audit(db, { actorId = null, action, entityType = null, entityId = null, details = {}, ip = null }) {
  await (db || pool).query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId, action, entityType, entityId ? String(entityId) : null, JSON.stringify(details), ip],
  );
}
