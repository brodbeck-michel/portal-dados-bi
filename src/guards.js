// Guardas e utilitários de sessão usados pelas rotas.
const { HttpError, serializeCookie, unauthorized, forbidden } = require('./http');

// ── Guardas usadas pelas rotas ─────────────────────────────────────────────

function requireUser(ctx, { allowPendingPassword = false } = {}) {
  if (!ctx.actor) throw unauthorized();
  if (ctx.actor.mustChangePassword && !allowPendingPassword) {
    throw new HttpError(403, 'Troque a senha provisória para continuar', [{ field: 'password', message: 'password_change_required' }]);
  }
  return ctx.actor;
}

function requireAdmin(ctx) {
  const actor = requireUser(ctx);
  if (actor.role !== 'admin') throw forbidden('Área restrita ao administrador');
  return actor;
}

function requireOperator(ctx) {
  if (!ctx.operator) throw unauthorized();
  return ctx.operator;
}

function setSessionCookie(ctx, token) {
  ctx.res.setHeader('Set-Cookie', serializeCookie(ctx.cookieName, token, {
    maxAgeSeconds: ctx.config.sessionMaxDays * 86400,
    secure: ctx.config.cookieSecure,
  }));
}

function clearSessionCookie(ctx) {
  ctx.res.setHeader('Set-Cookie', serializeCookie(ctx.cookieName, '', { maxAgeSeconds: 0, secure: ctx.config.cookieSecure }));
}

// Endereço público de um cliente, no mesmo protocolo/porta deste request.
function tenantUrl(ctx, slug) {
  const port = (ctx.host.match(/:(\d+)$/) || [])[1];
  return `${ctx.protocol}://${slug}.${ctx.config.baseDomain}${port ? `:${port}` : ''}`;
}

module.exports = { requireUser, requireAdmin, requireOperator, setSessionCookie, clearSessionCookie, tenantUrl };
