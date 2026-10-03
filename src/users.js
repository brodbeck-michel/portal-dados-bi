const { nowIso, transaction } = require('./db');
const { text, email, bool, ensureValid, notFound, conflict, badRequest } = require('./http');
const { hashPassword, verifyPassword, generateTempPassword, passwordProblem } = require('./passwords');
const { deleteUserSessions } = require('./sessions');

const ROLES = ['admin', 'user'];
const PUBLIC_COLUMNS = 'id, email, name, role, active, must_change_password, last_login_at, created_at';

// Todas as funções recebem tenantId: um usuário de outro cliente é tratado
// como inexistente (404), nunca como "sem permissão".

function list(db, tenantId) {
  return db.prepare(`
    SELECT ${PUBLIC_COLUMNS},
      (SELECT COUNT(*) FROM report_access ra WHERE ra.user_id = u.id) AS report_count
    FROM users u WHERE tenant_id = ? ORDER BY name COLLATE NOCASE
  `).all(tenantId);
}

function get(db, tenantId, id) {
  const u = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE tenant_id = ? AND id = ?`).get(tenantId, id);
  if (!u) throw notFound('Usuário não encontrado');
  return u;
}

function findForLogin(db, tenantId, emailAddress) {
  return db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantId, emailAddress) ?? null;
}

async function create(db, tenantId, body) {
  const errors = [];
  const mail = email(body.email, 'email', errors);
  const name = text(body.name, 'name', 'Nome', errors, { max: 120 });
  const role = body.role ?? 'user';
  if (!ROLES.includes(role)) errors.push({ field: 'role', message: 'Papel inválido' });
  ensureValid(errors);
  if (findForLogin(db, tenantId, mail)) throw conflict('Já existe um usuário com este e-mail');

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO users (tenant_id, email, name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)
  `).run(tenantId, mail, name, role, hash);
  return { user: get(db, tenantId, Number(lastInsertRowid)), tempPassword };
}

function otherActiveAdmins(db, tenantId, userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND id <> ? AND role = 'admin' AND active = 1`)
    .get(tenantId, userId).n;
}

const LAST_ADMIN = 'O cliente precisa manter ao menos um administrador ativo';

// actorUserId: quem está alterando (null quando é o suporte/operador).
function update(db, tenantId, id, body, actorUserId) {
  const current = get(db, tenantId, id);
  const errors = [];
  const name = body.name === undefined ? current.name : text(body.name, 'name', 'Nome', errors, { max: 120 });
  const role = body.role ?? current.role;
  if (!ROLES.includes(role)) errors.push({ field: 'role', message: 'Papel inválido' });
  const active = bool(body.active, !!current.active);
  ensureValid(errors);

  const losesAdmin = current.role === 'admin' && current.active && (role !== 'admin' || !active);
  if (id === actorUserId && (role !== current.role || !active)) {
    throw badRequest('Você não pode alterar o próprio papel nem se desativar');
  }
  if (losesAdmin && otherActiveAdmins(db, tenantId, id) === 0) throw conflict(LAST_ADMIN);

  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run(name, role, active ? 1 : 0, nowIso(), tenantId, id);
  if (!active) deleteUserSessions(db, id);
  return { before: current, after: get(db, tenantId, id) };
}

async function resetPassword(db, tenantId, id) {
  get(db, tenantId, id);
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?
    WHERE tenant_id = ? AND id = ?
  `).run(hash, nowIso(), tenantId, id);
  deleteUserSessions(db, id);
  return tempPassword;
}

function remove(db, tenantId, id, actorUserId) {
  const current = get(db, tenantId, id);
  if (id === actorUserId) throw badRequest('Você não pode excluir a si mesmo');
  if (current.role === 'admin' && current.active && otherActiveAdmins(db, tenantId, id) === 0) throw conflict(LAST_ADMIN);
  db.prepare('DELETE FROM users WHERE tenant_id = ? AND id = ?').run(tenantId, id);
  return current;
}

async function changeOwnPassword(db, tenantId, userId, currentPassword, newPassword, keepTokenHash) {
  const row = db.prepare('SELECT password_hash FROM users WHERE tenant_id = ? AND id = ?').get(tenantId, userId);
  if (!row) throw notFound('Usuário não encontrado');
  if (!(await verifyPassword(String(currentPassword ?? ''), row.password_hash))) {
    throw badRequest('Senha atual incorreta', [{ field: 'currentPassword', message: 'Senha atual incorreta' }]);
  }
  const problem = passwordProblem(newPassword);
  if (problem) throw badRequest(problem, [{ field: 'newPassword', message: problem }]);
  if (newPassword === currentPassword) {
    throw badRequest('A nova senha deve ser diferente da atual', [{ field: 'newPassword', message: 'Use uma senha diferente da atual' }]);
  }
  const hash = await hashPassword(newPassword);
  transaction(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(hash, nowIso(), userId);
    deleteUserSessions(db, userId, keepTokenHash);
  });
}

// Primeiro admin de um cliente, criado pelo operador.
async function createAdmin(db, tenantId, body) {
  return create(db, tenantId, { ...body, role: 'admin' });
}

module.exports = { list, get, findForLogin, create, createAdmin, update, resetPassword, remove, changeOwnPassword };
