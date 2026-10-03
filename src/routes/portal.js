// O que cada pessoa vê no portal.
const { notFound, badRequest, id: toId } = require('../http');
const { requireUser } = require('../guards');
const access = require('../access');
const audit = require('../audit');

module.exports = (api) => {
  api.get('/api/portal/home', async (ctx) => {
    const a = requireUser(ctx);
    const tenantId = ctx.tenant.id;
    const visible = access.visibleReports(ctx.db, tenantId, a);
    const visibleIds = new Set(visible.map((r) => r.id));

    const folders = [];
    for (const r of visible) {
      let folder = folders[folders.length - 1];
      if (!folder || folder.id !== r.folder_id) {
        folder = { id: r.folder_id, name: r.folder_name, reports: [] };
        folders.push(folder);
      }
      folder.reports.push({ id: r.id, name: r.name, description: r.description, folderName: r.folder_name });
    }

    // Favoritos e recentes são da pessoa; a sessão de suporte não tem nenhum.
    let favorites = [];
    let recent = [];
    if (a.userId) {
      favorites = ctx.db.prepare('SELECT report_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC')
        .all(a.userId).map((r) => r.report_id).filter((id) => visibleIds.has(id));
      recent = ctx.db.prepare(`
        SELECT report_id FROM audit_log
        WHERE tenant_id = ? AND actor_user_id = ? AND event = 'report.opened' AND report_id IS NOT NULL
        GROUP BY report_id ORDER BY MAX(created_at) DESC LIMIT 12
      `).all(tenantId, a.userId).map((r) => r.report_id).filter((id) => visibleIds.has(id)).slice(0, 6);
    }
    return { folders, favorites, recent };
  });

  // POST, não GET: abrir é o evento registrado, e o link só sai por aqui.
  api.post('/api/portal/reports/:id/open', async (ctx) => {
    const a = requireUser(ctx);
    const reportId = toId(ctx.params.id);
    const report = reportId && access.canOpen(ctx.db, ctx.tenant.id, a, reportId);
    // 404 também para "existe mas sem acesso": não confirma que o relatório existe.
    if (!report) throw notFound('Relatório não encontrado ou sem acesso');
    audit.record(ctx.db, ctx, { event: 'report.opened', reportId: report.id, target: report.name });
    return { id: report.id, name: report.name, url: report.url };
  });

  api.put('/api/portal/favorites/:id', async (ctx) => {
    const a = requireUser(ctx);
    if (!a.userId) throw badRequest('A sessão de suporte não tem favoritos');
    const reportId = toId(ctx.params.id);
    if (!reportId || !access.canOpen(ctx.db, ctx.tenant.id, a, reportId)) throw notFound('Relatório não encontrado ou sem acesso');
    ctx.db.prepare('INSERT OR IGNORE INTO favorites (tenant_id, user_id, report_id) VALUES (?, ?, ?)')
      .run(ctx.tenant.id, a.userId, reportId);
    return { ok: true };
  });

  api.delete('/api/portal/favorites/:id', async (ctx) => {
    const a = requireUser(ctx);
    if (!a.userId) throw badRequest('A sessão de suporte não tem favoritos');
    ctx.db.prepare('DELETE FROM favorites WHERE user_id = ? AND report_id = ?').run(a.userId, toId(ctx.params.id));
    return { ok: true };
  });
};
