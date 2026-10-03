// Quem enxerga o quê.
//
// Regra única de visibilidade no portal:
//   relatório ativo  E  pasta ativa  E  (pessoa é admin  OU  existe report_access)
// O link (url) do relatório só sai daqui por canOpen(), na hora de abrir.

const { transaction } = require('./db');
const { badRequest } = require('./http');
const catalog = require('./catalog');
const users = require('./users');

// viewer: { userId, role } — role 'admin' (inclui o suporte) vê tudo.
function visibleReports(db, tenantId, viewer) {
  const base = `
    SELECT r.id, r.name, r.description, r.folder_id, f.name AS folder_name
    FROM reports r JOIN folders f ON f.id = r.folder_id
    WHERE r.tenant_id = ? AND r.active = 1 AND f.active = 1`;
  if (viewer.role === 'admin') {
    return db.prepare(`${base} ORDER BY f.name, r.name COLLATE NOCASE`).all(tenantId);
  }
  return db.prepare(`${base}
      AND EXISTS (SELECT 1 FROM report_access ra WHERE ra.report_id = r.id AND ra.user_id = ?)
    ORDER BY f.name, r.name COLLATE NOCASE`).all(tenantId, viewer.userId);
}

// Relatório com o link, se esta pessoa pode abri-lo agora; senão null.
function canOpen(db, tenantId, viewer, reportId) {
  const r = db.prepare(`
    SELECT r.id, r.name, r.url FROM reports r JOIN folders f ON f.id = r.folder_id
    WHERE r.tenant_id = ? AND r.id = ? AND r.active = 1 AND f.active = 1
  `).get(tenantId, reportId);
  if (!r) return null;
  if (viewer.role === 'admin') return r;
  const granted = db.prepare('SELECT 1 FROM report_access WHERE report_id = ? AND user_id = ?').get(reportId, viewer.userId);
  return granted ? r : null;
}

function idList(value, label) {
  if (!Array.isArray(value) || value.some((v) => !Number.isInteger(v) || v <= 0)) {
    throw badRequest(`Lista de ${label} inválida`);
  }
  return [...new Set(value)];
}

// Confere que todos os ids pertencem ao cliente antes de gravar qualquer coisa.
function assertAllInTenant(db, table, tenantId, ids, label) {
  if (!ids.length) return;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .get(tenantId, ...ids);
  if (n !== ids.length) throw badRequest(`Há ${label} que não pertencem a este cliente`);
}

function usersOfReport(db, tenantId, reportId) {
  catalog.getReport(db, tenantId, reportId);
  return db.prepare('SELECT user_id FROM report_access WHERE report_id = ?').all(reportId).map((r) => r.user_id);
}

function reportsOfUser(db, tenantId, userId) {
  users.get(db, tenantId, userId);
  return db.prepare('SELECT report_id FROM report_access WHERE user_id = ?').all(userId).map((r) => r.report_id);
}

// Substitui o conjunto inteiro e devolve o que entrou e o que saiu (para o registro).
function setUsersOfReport(db, tenantId, reportId, userIdsInput) {
  const userIds = idList(userIdsInput, 'usuários');
  const before = usersOfReport(db, tenantId, reportId);
  assertAllInTenant(db, 'users', tenantId, userIds, 'usuários');
  return applyDiff(db, before, userIds, (uid) => [tenantId, reportId, uid], (uid) => [reportId, uid]);
}

function setReportsOfUser(db, tenantId, userId, reportIdsInput) {
  const reportIds = idList(reportIdsInput, 'relatórios');
  const before = reportsOfUser(db, tenantId, userId);
  assertAllInTenant(db, 'reports', tenantId, reportIds, 'relatórios');
  return applyDiff(db, before, reportIds, (rid) => [tenantId, rid, userId], (rid) => [rid, userId]);
}

function applyDiff(db, before, after, insertArgs, deleteArgs) {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  transaction(db, () => {
    const ins = db.prepare('INSERT OR IGNORE INTO report_access (tenant_id, report_id, user_id) VALUES (?, ?, ?)');
    const del = db.prepare('DELETE FROM report_access WHERE report_id = ? AND user_id = ?');
    added.forEach((x) => ins.run(...insertArgs(x)));
    removed.forEach((x) => del.run(...deleteArgs(x)));
  });
  return { added, removed };
}

module.exports = { visibleReports, canOpen, usersOfReport, reportsOfUser, setUsersOfReport, setReportsOfUser };
