import db from '../db/index.js';

export function audit(req, entity, entityId, action, oldValue = null, newValue = null) {
  return db('audit_logs').insert({
    user_id: req.user?.id ?? null,
    entity,
    entity_id: entityId == null ? null : String(entityId),
    action,
    old_value: oldValue ? JSON.stringify(oldValue) : null,
    new_value: newValue ? JSON.stringify(newValue) : null,
    ip: req.ip,
  });
}
