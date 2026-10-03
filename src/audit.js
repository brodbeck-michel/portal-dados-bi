// Registro de acessos e alterações (tabela audit_log).
//
// Eventos (taxonomia dominio.acao):
//   auth.login  auth.login_failed  auth.locked  auth.logout  auth.password_changed
//   report.opened
//   user.created  user.updated  user.password_reset  user.deleted
//   folder.created  folder.updated  folder.deleted
//   report.created  report.updated  report.deleted
//   access.changed  support.session_started
//   tenant.created  tenant.updated

function record(db, ctx, { event, tenantId, reportId = null, target = null, detail = null, actor }) {
  const a = actor ?? ctx.actor ?? {};
  db.prepare(`
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_operator_id, actor_label, event, report_id, target, detail, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId === undefined ? (ctx.tenant?.id ?? null) : tenantId,
    a.userId ?? null,
    a.operatorId ?? null,
    a.label ?? null,
    event,
    reportId,
    target,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    ctx.ip ?? null,
    ctx.ua ?? null,
  );
}

// Categorias usadas no filtro da tela de registro.
const CATEGORIES = {
  acessos: ["event = 'report.opened'"],
  logins: ["event LIKE 'auth.%'"],
  alteracoes: ["event NOT LIKE 'auth.%'", "event <> 'report.opened'"],
};

function buildFilter(tenantId, f) {
  const where = ['tenant_id = ?'];
  const args = [tenantId];
  if (f.from) { where.push('created_at >= ?'); args.push(`${f.from}T00:00:00.000Z`); }
  if (f.to) { where.push('created_at <= ?'); args.push(`${f.to}T23:59:59.999Z`); }
  if (f.userId) { where.push('actor_user_id = ?'); args.push(f.userId); }
  if (f.reportId) { where.push('report_id = ?'); args.push(f.reportId); }
  if (f.category && CATEGORIES[f.category]) where.push(...CATEGORIES[f.category]);
  return { sql: where.join(' AND '), args };
}

function query(db, tenantId, filters, { limit = 100, offset = 0 } = {}) {
  const { sql, args } = buildFilter(tenantId, filters);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE ${sql}`).get(...args).n;
  const rows = db.prepare(`
    SELECT id, actor_user_id, actor_operator_id, actor_label, event, report_id, target, detail, ip, created_at
    FROM audit_log WHERE ${sql}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  return { total, rows };
}

// Filtros vindos da query string, já validados.
function parseFilters(params) {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const num = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    from: date(params.get('de')),
    to: date(params.get('ate')),
    userId: num(params.get('usuario')),
    reportId: num(params.get('relatorio')),
    category: CATEGORIES[params.get('tipo')] ? params.get('tipo') : null,
  };
}

const EVENT_LABELS = {
  'auth.login': 'Entrou no portal',
  'auth.login_failed': 'Tentativa de login falhou',
  'auth.locked': 'Conta travada por tentativas',
  'auth.logout': 'Saiu do portal',
  'auth.password_changed': 'Trocou a senha',
  'report.opened': 'Abriu relatório',
  'user.created': 'Criou usuário',
  'user.updated': 'Alterou usuário',
  'user.password_reset': 'Redefiniu senha',
  'user.deleted': 'Excluiu usuário',
  'folder.created': 'Criou pasta',
  'folder.updated': 'Alterou pasta',
  'folder.deleted': 'Excluiu pasta',
  'report.created': 'Criou relatório',
  'report.updated': 'Alterou relatório',
  'report.deleted': 'Excluiu relatório',
  'access.changed': 'Alterou acessos',
  'support.session_started': 'Suporte entrou',
  'tenant.created': 'Cliente criado',
  'tenant.updated': 'Cliente alterado',
};

// CSV para Excel em pt-BR: separador ';' e BOM para o acento abrir certo.
function toCsv(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    // Prefixo neutraliza fórmula (=, +, -, @) ao abrir no Excel.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [['Data/hora (UTC)', 'Quem', 'Evento', 'Relatório/alvo', 'IP'].join(';')];
  for (const r of rows) {
    lines.push([r.created_at, r.actor_label, EVENT_LABELS[r.event] || r.event, r.target, r.ip].map(cell).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { record, query, parseFilters, toCsv, EVENT_LABELS };
