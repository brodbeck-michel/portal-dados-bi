// Pastas e relatórios de um cliente. Pasta é só agrupamento visual; a única
// influência dela na visibilidade é estar desativada (oculta os relatórios).

const { nowIso } = require('./db');
const { text, bool, id: toId, ensureValid, notFound, conflict } = require('./http');

// ── Pastas ─────────────────────────────────────────────────────────────────

function listFolders(db, tenantId) {
  return db.prepare(`
    SELECT f.id, f.name, f.active, f.created_at,
      (SELECT COUNT(*) FROM reports r WHERE r.folder_id = f.id) AS report_count
    FROM folders f WHERE f.tenant_id = ? ORDER BY f.name
  `).all(tenantId);
}

function getFolder(db, tenantId, id) {
  const f = db.prepare('SELECT id, name, active FROM folders WHERE tenant_id = ? AND id = ?').get(tenantId, id);
  if (!f) throw notFound('Pasta não encontrada');
  return f;
}

function folderNameTaken(db, tenantId, name, exceptId = 0) {
  return !!db.prepare('SELECT 1 FROM folders WHERE tenant_id = ? AND name = ? AND id <> ?').get(tenantId, name, exceptId);
}

function createFolder(db, tenantId, body) {
  const errors = [];
  const name = text(body.name, 'name', 'Nome', errors, { max: 80 });
  ensureValid(errors);
  if (folderNameTaken(db, tenantId, name)) throw conflict('Já existe uma pasta com este nome');
  const { lastInsertRowid } = db.prepare('INSERT INTO folders (tenant_id, name) VALUES (?, ?)').run(tenantId, name);
  return getFolder(db, tenantId, Number(lastInsertRowid));
}

function updateFolder(db, tenantId, id, body) {
  const current = getFolder(db, tenantId, id);
  const errors = [];
  const name = body.name === undefined ? current.name : text(body.name, 'name', 'Nome', errors, { max: 80 });
  ensureValid(errors);
  if (folderNameTaken(db, tenantId, name, id)) throw conflict('Já existe uma pasta com este nome');
  db.prepare('UPDATE folders SET name = ?, active = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run(name, bool(body.active, !!current.active) ? 1 : 0, nowIso(), tenantId, id);
  return { before: current, after: getFolder(db, tenantId, id) };
}

function removeFolder(db, tenantId, id) {
  const current = getFolder(db, tenantId, id);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE folder_id = ?').get(id);
  if (n > 0) throw conflict('A pasta tem relatórios. Mova ou exclua os relatórios antes.');
  db.prepare('DELETE FROM folders WHERE tenant_id = ? AND id = ?').run(tenantId, id);
  return current;
}

// ── Relatórios ─────────────────────────────────────────────────────────────

function validateUrl(value, errors) {
  const raw = text(value, 'url', 'Link do relatório', errors, { max: 2000 });
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') throw new Error();
    return u.toString();
  } catch {
    errors.push({ field: 'url', message: 'Informe um link https:// válido' });
    return null;
  }
}

function listReports(db, tenantId) {
  return db.prepare(`
    SELECT r.id, r.name, r.description, r.url, r.active, r.folder_id, f.name AS folder_name, f.active AS folder_active,
      r.created_at, r.updated_at,
      (SELECT COUNT(*) FROM report_access ra WHERE ra.report_id = r.id) AS user_count
    FROM reports r JOIN folders f ON f.id = r.folder_id
    WHERE r.tenant_id = ? ORDER BY f.name, r.name COLLATE NOCASE
  `).all(tenantId);
}

function getReport(db, tenantId, id) {
  const r = db.prepare(`
    SELECT id, name, description, url, active, folder_id FROM reports WHERE tenant_id = ? AND id = ?
  `).get(tenantId, id);
  if (!r) throw notFound('Relatório não encontrado');
  return r;
}

function readReportFields(db, tenantId, body, current) {
  const errors = [];
  const name = body.name === undefined && current ? current.name : text(body.name, 'name', 'Nome', errors, { max: 120 });
  const description = body.description === undefined && current
    ? current.description
    : text(body.description, 'description', 'Descrição', errors, { required: false, max: 300 });
  const url = body.url === undefined && current ? current.url : validateUrl(body.url, errors);
  const folderId = body.folder_id === undefined && current ? current.folder_id : toId(body.folder_id);
  if (!folderId) errors.push({ field: 'folder_id', message: 'Escolha a pasta' });
  ensureValid(errors);
  // A pasta tem de ser deste cliente — a FK não garante isso.
  try {
    getFolder(db, tenantId, folderId);
  } catch {
    ensureValid([{ field: 'folder_id', message: 'Pasta não encontrada' }]);
  }
  return { name, description, url, folderId, active: bool(body.active, current ? !!current.active : true) };
}

function createReport(db, tenantId, body) {
  const f = readReportFields(db, tenantId, body, null);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO reports (tenant_id, folder_id, name, description, url, active) VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, f.folderId, f.name, f.description, f.url, f.active ? 1 : 0);
  return getReport(db, tenantId, Number(lastInsertRowid));
}

function updateReport(db, tenantId, id, body) {
  const current = getReport(db, tenantId, id);
  const f = readReportFields(db, tenantId, body, current);
  db.prepare(`
    UPDATE reports SET folder_id = ?, name = ?, description = ?, url = ?, active = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ?
  `).run(f.folderId, f.name, f.description, f.url, f.active ? 1 : 0, nowIso(), tenantId, id);
  return { before: current, after: getReport(db, tenantId, id) };
}

function removeReport(db, tenantId, id) {
  const current = getReport(db, tenantId, id);
  db.prepare('DELETE FROM reports WHERE tenant_id = ? AND id = ?').run(tenantId, id);
  return current;
}

module.exports = {
  listFolders, getFolder, createFolder, updateFolder, removeFolder,
  listReports, getReport, createReport, updateReport, removeReport,
};
