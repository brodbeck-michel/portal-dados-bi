const crypto = require('node:crypto');
const { nowIso } = require('./db');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const iso = (ms) => new Date(ms).toISOString();

// Expira o que vier primeiro: inatividade (sessionIdleHours) ou idade máxima
// (sessionMaxDays), contada a partir do login.
function expiryFrom(createdMs, nowMs, config) {
  return iso(Math.min(nowMs + config.sessionIdleHours * 3600e3, createdMs + config.sessionMaxDays * 86400e3));
}

function createSession(db, config, { scope, tenantId = null, userId = null, operatorId = null, ip = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (token_hash, scope, tenant_id, user_id, operator_id, created_at, last_seen_at, expires_at, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hashToken(token), scope, tenantId, userId, operatorId, iso(now), iso(now), expiryFrom(now, now, config), ip);
  return token;
}

// Sessão válida para este escopo e este cliente, ou null. Renova a validade por
// inatividade no máximo uma vez por minuto, para não escrever a cada request.
function getSession(db, config, token, scope, tenantId = null) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!s || s.scope !== scope) return null;
  if (scope === 'tenant' && s.tenant_id !== tenantId) return null;
  const now = Date.now();
  if (s.expires_at <= iso(now)) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (now - Date.parse(s.last_seen_at) > 60e3) {
    const expires = expiryFrom(Date.parse(s.created_at), now, config);
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(iso(now), expires, tokenHash);
  }
  return { ...s, tokenHash };
}

function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

// Derruba as sessões de um usuário (senha redefinida, conta desativada),
// opcionalmente preservando a sessão atual.
function deleteUserSessions(db, userId, exceptTokenHash = null) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?').run(userId, exceptTokenHash);
}

function deleteExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  db.prepare('DELETE FROM support_handoffs WHERE expires_at <= ?').run(iso(Date.now() - 3600e3));
}

// ── Passagem de bastão operador → sessão de suporte no cliente ─────────────
// O cookie da área do operador não vale no subdomínio do cliente (é preso ao
// host), então o operador recebe um link com token de uso único.

function createHandoff(db, operatorId, tenantId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO support_handoffs (token_hash, operator_id, tenant_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), operatorId, tenantId, iso(Date.now() + 60e3));
  return token;
}

// Consome o token: devolve o operator_id se for válido para este cliente.
function consumeHandoff(db, token, tenantId) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const h = db.prepare('SELECT * FROM support_handoffs WHERE token_hash = ?').get(tokenHash);
  if (!h || h.used_at || h.tenant_id !== tenantId || h.expires_at <= nowIso()) return null;
  const { changes } = db.prepare('UPDATE support_handoffs SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
    .run(nowIso(), tokenHash);
  return changes === 1 ? h.operator_id : null;
}

module.exports = {
  createSession, getSession, deleteSession, deleteUserSessions, deleteExpiredSessions,
  createHandoff, consumeHandoff,
};
