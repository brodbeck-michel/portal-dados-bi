// Login, sessão e marca no endereço de um cliente.
const { readJson, sendJson, badRequest } = require('../http');
const { requireUser, setSessionCookie, clearSessionCookie } = require('../guards');
const { checkCredentials, credentialError, checkIpRateLimit } = require('../login');
const sessions = require('../sessions');
const users = require('../users');
const tenants = require('../tenants');
const audit = require('../audit');

module.exports = (api) => {
  api.post('/api/auth/login', async (ctx) => {
    checkIpRateLimit(ctx.ip);
    const body = await readJson(ctx.req);
    const emailAddress = String(body.email || '').trim().toLowerCase();
    const account = emailAddress ? users.findForLogin(ctx.db, ctx.tenant.id, emailAddress) : null;
    const result = await checkCredentials(ctx.db, 'users', account, String(body.password || ''));

    if (result !== 'ok') {
      const actor = { userId: account?.id ?? null, label: emailAddress.slice(0, 254) || '(vazio)' };
      audit.record(ctx.db, ctx, { event: result === 'locked_now' ? 'auth.locked' : 'auth.login_failed', actor, detail: result });
      throw credentialError(result);
    }

    sessions.deleteSession(ctx.db, ctx.cookies[ctx.cookieName]);
    const token = sessions.createSession(ctx.db, ctx.config, { scope: 'tenant', tenantId: ctx.tenant.id, userId: account.id, ip: ctx.ip });
    setSessionCookie(ctx, token);
    audit.record(ctx.db, ctx, { event: 'auth.login', actor: { userId: account.id, label: account.email } });
    return { mustChangePassword: !!account.must_change_password, role: account.role };
  });

  api.post('/api/auth/logout', async (ctx) => {
    if (ctx.actor) audit.record(ctx.db, ctx, { event: 'auth.logout' });
    sessions.deleteSession(ctx.db, ctx.cookies[ctx.cookieName]);
    clearSessionCookie(ctx);
    return { ok: true };
  });

  api.get('/api/me', async (ctx) => {
    const a = requireUser(ctx, { allowPendingPassword: true });
    return {
      user: { id: a.userId, name: a.name, email: a.email, role: a.role, isSupport: a.isSupport, mustChangePassword: a.mustChangePassword },
    };
  });

  api.post('/api/auth/change-password', async (ctx) => {
    const a = requireUser(ctx, { allowPendingPassword: true });
    if (a.isSupport) throw badRequest('A sessão de suporte não tem senha própria');
    const body = await readJson(ctx.req);
    await users.changeOwnPassword(ctx.db, ctx.tenant.id, a.userId, body.currentPassword, body.newPassword, a.session.tokenHash);
    audit.record(ctx.db, ctx, { event: 'auth.password_changed' });
    return { ok: true };
  });

  // Fim da passagem de bastão: o operador chega aqui com um token de uso
  // único e ganha uma sessão de suporte (papel admin) neste cliente.
  api.get('/api/auth/suporte', async (ctx) => {
    const operatorId = sessions.consumeHandoff(ctx.db, ctx.query.get('token'), ctx.tenant.id);
    if (!operatorId) {
      ctx.res.writeHead(302, { Location: '/login?suporte=expirado' });
      return ctx.res.end();
    }
    const op = ctx.db.prepare('SELECT email FROM operators WHERE id = ?').get(operatorId);
    sessions.deleteSession(ctx.db, ctx.cookies[ctx.cookieName]);
    const token = sessions.createSession(ctx.db, ctx.config, { scope: 'tenant', tenantId: ctx.tenant.id, operatorId, ip: ctx.ip });
    setSessionCookie(ctx, token);
    audit.record(ctx.db, ctx, { event: 'support.session_started', actor: { operatorId, label: `Suporte: ${op.email}` } });
    ctx.res.writeHead(302, { Location: '/#/admin/relatorios' });
    return ctx.res.end();
  });

  // Marca do cliente: pública, a tela de login precisa dela antes do login.
  // O título substitui o nome do produto em todas as telas do cliente.
  api.get('/api/branding', async (ctx) => {
    const t = ctx.tenant;
    const v = encodeURIComponent(t.updated_at);
    const logoUrl = t.has_logo ? `/api/branding/logo?v=${v}` : null;
    return {
      name: t.name,
      title: t.portal_title || t.name,
      message: t.login_message || null,
      color: t.brand_color,
      logoUrl,
      faviconUrl: t.has_favicon ? `/api/branding/favicon?v=${v}` : logoUrl,
    };
  });

  for (const kind of tenants.IMAGE_KINDS) {
    api.get(`/api/branding/${kind}`, async (ctx) => {
      const img = tenants.getImage(ctx.db, ctx.tenant.id, kind);
      if (!img) return sendJson(ctx.res, 404, { error: 'Sem imagem' });
      const data = Buffer.from(img.data);
      ctx.res.writeHead(200, {
        'Content-Type': img.mime,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=86400',
      });
      ctx.res.end(data);
    });
  }
};
