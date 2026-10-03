// Área do operador da plataforma (BASE_DOMAIN): clientes, marca e suporte.
const { readJson, id: toId, notFound } = require('../http');
const { requireOperator, setSessionCookie, clearSessionCookie, tenantUrl } = require('../guards');
const { checkCredentials, credentialError, checkIpRateLimit } = require('../login');
const sessions = require('../sessions');
const tenants = require('../tenants');
const users = require('../users');
const audit = require('../audit');

const pathId = (ctx) => {
  const n = toId(ctx.params.id);
  if (!n) throw notFound();
  return n;
};

const operatorActor = (op) => ({ operatorId: op.id, label: `Operador: ${op.email}` });

function present(ctx, t) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    brandColor: t.brand_color,
    active: !!t.active,
    hasLogo: !!t.has_logo,
    url: tenantUrl(ctx, t.slug),
    userCount: t.user_count,
    reportCount: t.report_count,
    lastReportOpenedAt: t.last_report_opened_at,
    createdAt: t.created_at,
  };
}

module.exports = (api) => {
  api.post('/api/platform/login', async (ctx) => {
    checkIpRateLimit(ctx.ip);
    const body = await readJson(ctx.req);
    const emailAddress = String(body.email || '').trim().toLowerCase();
    const op = emailAddress ? ctx.db.prepare('SELECT * FROM operators WHERE email = ?').get(emailAddress) : null;
    const result = await checkCredentials(ctx.db, 'operators', op ?? null, String(body.password || ''));
    if (result !== 'ok') throw credentialError(result);
    sessions.deleteSession(ctx.db, ctx.cookies[ctx.cookieName]);
    setSessionCookie(ctx, sessions.createSession(ctx.db, ctx.config, { scope: 'platform', operatorId: op.id, ip: ctx.ip }));
    return { ok: true };
  });

  api.post('/api/platform/logout', async (ctx) => {
    sessions.deleteSession(ctx.db, ctx.cookies[ctx.cookieName]);
    clearSessionCookie(ctx);
    return { ok: true };
  });

  api.get('/api/platform/me', async (ctx) => {
    const op = requireOperator(ctx);
    return { id: op.id, name: op.name, email: op.email, baseDomain: ctx.config.baseDomain };
  });

  api.get('/api/platform/tenants', async (ctx) => {
    requireOperator(ctx);
    return tenants.list(ctx.db).map((t) => present(ctx, t));
  });

  // Cria o cliente e, se vier admin, o primeiro administrador dele.
  api.post('/api/platform/tenants', async (ctx) => {
    const op = requireOperator(ctx);
    const body = await readJson(ctx.req);
    const tenant = tenants.create(ctx.db, body);
    audit.record(ctx.db, ctx, { event: 'tenant.created', tenantId: tenant.id, actor: operatorActor(op), target: tenant.slug });
    if (body.logo) tenants.setLogo(ctx.db, tenant.id, body.logo);
    return present(ctx, tenants.get(ctx.db, tenant.id));
  });

  api.put('/api/platform/tenants/:id', async (ctx) => {
    const op = requireOperator(ctx);
    const id = pathId(ctx);
    const t = tenants.update(ctx.db, id, await readJson(ctx.req));
    audit.record(ctx.db, ctx, { event: 'tenant.updated', tenantId: id, actor: operatorActor(op), target: t.slug });
    return present(ctx, t);
  });

  api.put('/api/platform/tenants/:id/logo', async (ctx) => {
    requireOperator(ctx);
    const body = await readJson(ctx.req, 600_000);
    return present(ctx, tenants.setLogo(ctx.db, pathId(ctx), body.logo));
  });

  // A tela do operador fica em outra origem que a do cliente; a CSP
  // (img-src 'self') exige que a logo venha deste endereço.
  api.get('/api/platform/tenants/:id/logo', async (ctx) => {
    requireOperator(ctx);
    const logo = tenants.getLogo(ctx.db, pathId(ctx));
    if (!logo) throw notFound('Sem logo');
    const data = Buffer.from(logo.logo_data);
    ctx.res.writeHead(200, { 'Content-Type': logo.logo_mime, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    ctx.res.end(data);
  });

  api.delete('/api/platform/tenants/:id/logo', async (ctx) => {
    requireOperator(ctx);
    return present(ctx, tenants.clearLogo(ctx.db, pathId(ctx)));
  });

  api.get('/api/platform/tenants/:id/admins', async (ctx) => {
    requireOperator(ctx);
    const id = pathId(ctx);
    tenants.get(ctx.db, id);
    return users.list(ctx.db, id).filter((u) => u.role === 'admin');
  });

  api.post('/api/platform/tenants/:id/admins', async (ctx) => {
    const op = requireOperator(ctx);
    const id = pathId(ctx);
    tenants.get(ctx.db, id);
    const { user, tempPassword } = await users.createAdmin(ctx.db, id, await readJson(ctx.req));
    audit.record(ctx.db, ctx, { event: 'user.created', tenantId: id, actor: operatorActor(op), target: user.email, detail: 'papel: administrador' });
    return { user, tempPassword };
  });

  // Gera o link de uso único para o operador entrar no cliente como suporte.
  api.post('/api/platform/tenants/:id/support', async (ctx) => {
    const op = requireOperator(ctx);
    const t = tenants.get(ctx.db, pathId(ctx));
    const token = sessions.createHandoff(ctx.db, op.id, t.id);
    return { url: `${tenantUrl(ctx, t.slug)}/api/auth/suporte?token=${encodeURIComponent(token)}` };
  });
};
