// Administração de um cliente: usuários, pastas, relatórios, acessos e registro.
const { readJson, id: toId, notFound } = require('../http');
const { requireAdmin } = require('../guards');
const users = require('../users');
const catalog = require('../catalog');
const access = require('../access');
const audit = require('../audit');

const pathId = (ctx) => {
  const n = toId(ctx.params.id);
  if (!n) throw notFound();
  return n;
};

const ROLE_LABELS = { admin: 'administrador', user: 'usuário' };

// "nome: A → B; ativo: sim → não" — só os campos que mudaram.
function describeChanges(before, after, labels) {
  const fmt = (v) => (v === 1 || v === true ? 'sim' : v === 0 || v === false ? 'não' : ROLE_LABELS[v] ?? v ?? '—');
  return Object.entries(labels)
    .filter(([k]) => before[k] !== after[k])
    .map(([k, label]) => `${label}: ${fmt(before[k])} → ${fmt(after[k])}`)
    .join('; ') || null;
}

module.exports = (api) => {
  // ── Usuários ─────────────────────────────────────────────────────────────
  api.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    return users.list(ctx.db, ctx.tenant.id);
  });

  api.post('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const { user, tempPassword } = await users.create(ctx.db, ctx.tenant.id, await readJson(ctx.req));
    audit.record(ctx.db, ctx, { event: 'user.created', target: user.email, detail: `papel: ${ROLE_LABELS[user.role]}` });
    return { user, tempPassword };
  });

  api.put('/api/admin/users/:id', async (ctx) => {
    const a = requireAdmin(ctx);
    const { before, after } = users.update(ctx.db, ctx.tenant.id, pathId(ctx), await readJson(ctx.req), a.userId);
    const detail = describeChanges(before, after, { name: 'nome', role: 'papel', active: 'ativo' });
    if (detail) audit.record(ctx.db, ctx, { event: 'user.updated', target: after.email, detail });
    return after;
  });

  api.post('/api/admin/users/:id/reset-password', async (ctx) => {
    requireAdmin(ctx);
    const id = pathId(ctx);
    const tempPassword = await users.resetPassword(ctx.db, ctx.tenant.id, id);
    audit.record(ctx.db, ctx, { event: 'user.password_reset', target: users.get(ctx.db, ctx.tenant.id, id).email });
    return { tempPassword };
  });

  api.delete('/api/admin/users/:id', async (ctx) => {
    const a = requireAdmin(ctx);
    const removed = users.remove(ctx.db, ctx.tenant.id, pathId(ctx), a.userId);
    audit.record(ctx.db, ctx, { event: 'user.deleted', target: removed.email });
    return { ok: true };
  });

  api.get('/api/admin/users/:id/access', async (ctx) => {
    requireAdmin(ctx);
    return { reportIds: access.reportsOfUser(ctx.db, ctx.tenant.id, pathId(ctx)) };
  });

  api.put('/api/admin/users/:id/access', async (ctx) => {
    requireAdmin(ctx);
    const id = pathId(ctx);
    const body = await readJson(ctx.req);
    const { added, removed } = access.setReportsOfUser(ctx.db, ctx.tenant.id, id, body.reportIds);
    if (added.length || removed.length) {
      audit.record(ctx.db, ctx, {
        event: 'access.changed',
        target: users.get(ctx.db, ctx.tenant.id, id).email,
        detail: `relatórios liberados: +${added.length} −${removed.length}`,
      });
    }
    return { added, removed };
  });

  // ── Pastas ───────────────────────────────────────────────────────────────
  api.get('/api/admin/folders', async (ctx) => {
    requireAdmin(ctx);
    return catalog.listFolders(ctx.db, ctx.tenant.id);
  });

  api.post('/api/admin/folders', async (ctx) => {
    requireAdmin(ctx);
    const folder = catalog.createFolder(ctx.db, ctx.tenant.id, await readJson(ctx.req));
    audit.record(ctx.db, ctx, { event: 'folder.created', target: folder.name });
    return folder;
  });

  api.put('/api/admin/folders/:id', async (ctx) => {
    requireAdmin(ctx);
    const { before, after } = catalog.updateFolder(ctx.db, ctx.tenant.id, pathId(ctx), await readJson(ctx.req));
    const detail = describeChanges(before, after, { name: 'nome', active: 'ativa' });
    if (detail) audit.record(ctx.db, ctx, { event: 'folder.updated', target: after.name, detail });
    return after;
  });

  api.delete('/api/admin/folders/:id', async (ctx) => {
    requireAdmin(ctx);
    const removed = catalog.removeFolder(ctx.db, ctx.tenant.id, pathId(ctx));
    audit.record(ctx.db, ctx, { event: 'folder.deleted', target: removed.name });
    return { ok: true };
  });

  // ── Relatórios ───────────────────────────────────────────────────────────
  api.get('/api/admin/reports', async (ctx) => {
    requireAdmin(ctx);
    return catalog.listReports(ctx.db, ctx.tenant.id);
  });

  api.post('/api/admin/reports', async (ctx) => {
    requireAdmin(ctx);
    const report = catalog.createReport(ctx.db, ctx.tenant.id, await readJson(ctx.req));
    audit.record(ctx.db, ctx, { event: 'report.created', reportId: report.id, target: report.name });
    return report;
  });

  api.put('/api/admin/reports/:id', async (ctx) => {
    requireAdmin(ctx);
    const { before, after } = catalog.updateReport(ctx.db, ctx.tenant.id, pathId(ctx), await readJson(ctx.req));
    // O link em si não vai para o registro — só o fato de ter sido trocado.
    const detail = describeChanges(
      { ...before, url: before.url === after.url ? 0 : 'anterior' },
      { ...after, url: before.url === after.url ? 0 : 'novo' },
      { name: 'nome', description: 'descrição', folder_id: 'pasta (id)', url: 'link', active: 'ativo' },
    );
    if (detail) audit.record(ctx.db, ctx, { event: 'report.updated', reportId: after.id, target: after.name, detail });
    return after;
  });

  api.delete('/api/admin/reports/:id', async (ctx) => {
    requireAdmin(ctx);
    const removed = catalog.removeReport(ctx.db, ctx.tenant.id, pathId(ctx));
    audit.record(ctx.db, ctx, { event: 'report.deleted', reportId: removed.id, target: removed.name });
    return { ok: true };
  });

  api.get('/api/admin/reports/:id/access', async (ctx) => {
    requireAdmin(ctx);
    return { userIds: access.usersOfReport(ctx.db, ctx.tenant.id, pathId(ctx)) };
  });

  api.put('/api/admin/reports/:id/access', async (ctx) => {
    requireAdmin(ctx);
    const id = pathId(ctx);
    const body = await readJson(ctx.req);
    const { added, removed } = access.setUsersOfReport(ctx.db, ctx.tenant.id, id, body.userIds);
    if (added.length || removed.length) {
      audit.record(ctx.db, ctx, {
        event: 'access.changed',
        reportId: id,
        target: catalog.getReport(ctx.db, ctx.tenant.id, id).name,
        detail: `pessoas com acesso: +${added.length} −${removed.length}`,
      });
    }
    return { added, removed };
  });

  // ── Registro de acessos ──────────────────────────────────────────────────
  api.get('/api/admin/audit', async (ctx) => {
    requireAdmin(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.get('limite')) || 50, 1), 200);
    const offset = Math.max(Number(ctx.query.get('inicio')) || 0, 0);
    const { total, rows } = audit.query(ctx.db, ctx.tenant.id, audit.parseFilters(ctx.query), { limit, offset });
    return { total, rows, labels: audit.EVENT_LABELS };
  });

  api.get('/api/admin/audit.csv', async (ctx) => {
    requireAdmin(ctx);
    const { rows } = audit.query(ctx.db, ctx.tenant.id, audit.parseFilters(ctx.query), { limit: 50_000, offset: 0 });
    const csv = Buffer.from(audit.toCsv(rows), 'utf8');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registro-acessos-${ctx.tenant.slug}.csv"`,
      'Content-Length': csv.length,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(csv);
  });
};
