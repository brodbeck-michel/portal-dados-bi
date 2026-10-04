const fs = require('node:fs');
const path = require('node:path');
const { HttpError, sendJson, parseCookies, createRouter, forbidden } = require('./http');
const sessions = require('./sessions');
const tenants = require('./tenants');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TENANT_COOKIE = 'pdb_sessao';
const PLATFORM_COOKIE = 'pdb_plataforma';

// Páginas de cada tipo de endereço. Toda página é estática; os dados vêm da API.
// Portal e administração são a mesma página (navegação por #/...).
const TENANT_PAGES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/trocar-senha': 'trocar-senha.html',
};
const TENANT_REDIRECTS = { '/admin': '/#/admin/relatorios' };
const PLATFORM_PAGES = {
  '/platform': 'platform/index.html',
  '/platform/login': 'platform/login.html',
};
const ASSET_PREFIXES = ['/css/', '/js/', '/img/', '/fonts/'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// frame-src https: — o relatório é um link externo qualquer (Power BI etc.).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src https:',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(res, config) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function hostOf(req) {
  return String(req.headers.host || '').toLowerCase();
}

// 'bi.vitrocrm.cloud' → plataforma; 'acme.bi.vitrocrm.cloud' → cliente.
function resolveSite(hostname, baseDomain) {
  if (hostname === baseDomain) return { kind: 'platform' };
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return slug && !slug.includes('.') ? { kind: 'tenant', slug } : null;
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    // O proxy de confiança acrescenta o IP que viu no fim da lista.
    if (xff.length) return xff[xff.length - 1].replace(/^::ffff:/, '');
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || null;
}

function protocolOf(req, config) {
  if (config.trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (proto === 'https' || proto === 'http') return proto;
  }
  return req.socket.encrypted ? 'https' : 'http';
}

// Mutação só da própria origem. O cookie SameSite=Lax já barra o envio
// cross-site; isto fecha o resto (ex.: subdomínio irmão de outro cliente).
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    let originHost = null;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { /* inválido */ }
    if (originHost !== hostOf(req)) throw forbidden('Origem não permitida');
    return;
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw forbidden('Origem não permitida');
}

function serveFile(res, file, status = 200) {
  const resolved = path.resolve(PUBLIC_DIR, file);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return false;
  let data;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    return false;
  }
  res.writeHead(status, {
    'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(data);
  return true;
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

function createApp({ db, config }) {
  const tenantApi = createRouter();
  const platformApi = createRouter();
  require('./routes/tenant-auth')(tenantApi);
  require('./routes/portal')(tenantApi);
  require('./routes/admin')(tenantApi);
  require('./routes/platform')(platformApi);

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const ctx = {
      db,
      config,
      req,
      res,
      path: url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname,
      query: url.searchParams,
      ip: clientIp(req, config),
      ua: String(req.headers['user-agent'] || '').slice(0, 300),
      cookies: parseCookies(req.headers.cookie),
      protocol: protocolOf(req, config),
      host: hostOf(req),
    };
    securityHeaders(res, config);

    try {
      if (ctx.path === '/health') return sendJson(res, 200, { status: 'ok' });
      // Consultado pelo Caddy (on_demand_tls) antes de emitir certificado para
      // um subdomínio: só emite para cliente cadastrado. O Caddy não expõe /internal.
      if (ctx.path === '/internal/tls-ask') {
        const site = resolveSite(String(ctx.query.get('domain') || '').toLowerCase(), config.baseDomain);
        const ok = site && (site.kind === 'platform' || tenants.findBySlug(db, site.slug));
        return sendText(res, ok ? 200 : 404, ok ? 'ok' : 'desconhecido');
      }

      // CSS/JS/imagens são públicos e iguais em todo endereço — inclusive na
      // página de "portal não encontrado".
      if ((req.method === 'GET' || req.method === 'HEAD') && ASSET_PREFIXES.some((p) => ctx.path.startsWith(p))) {
        return serveFile(res, ctx.path.slice(1)) || sendText(res, 404, 'Arquivo não encontrado');
      }

      const site = resolveSite(ctx.host.replace(/:\d+$/, ''), config.baseDomain);
      if (!site) return sendText(res, 404, 'Endereço não reconhecido');

      if (site.kind === 'tenant') {
        const tenant = tenants.findBySlug(db, site.slug);
        if (!tenant || !tenant.active) {
          return ctx.path.startsWith('/api/')
            ? sendJson(res, 404, { error: 'Portal não encontrado' })
            : serveFile(res, 'nao-encontrado.html', 404) || sendText(res, 404, 'Portal não encontrado');
        }
        ctx.tenant = tenant;
        ctx.cookieName = TENANT_COOKIE;
        loadTenantActor(ctx);
      } else {
        ctx.cookieName = PLATFORM_COOKIE;
        loadOperator(ctx);
      }

      if (ctx.path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
        const router = site.kind === 'tenant' ? tenantApi : platformApi;
        const found = router.match(req.method, ctx.path);
        if (!found) return sendJson(res, 404, { error: 'Rota não encontrada' });
        ctx.params = found.params;
        const result = await found.handler(ctx);
        if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Método não permitido');
      if (site.kind === 'platform' && ctx.path === '/') {
        res.writeHead(302, { Location: '/platform' });
        return res.end();
      }
      if (site.kind === 'tenant' && TENANT_REDIRECTS[ctx.path]) {
        res.writeHead(302, { Location: TENANT_REDIRECTS[ctx.path] });
        return res.end();
      }
      const pages = site.kind === 'tenant' ? TENANT_PAGES : PLATFORM_PAGES;
      if (pages[ctx.path] && serveFile(res, pages[ctx.path])) return;
      return sendText(res, 404, 'Página não encontrada');
    } catch (err) {
      if (err instanceof HttpError) {
        if (res.headersSent) return res.end();
        return sendJson(res, err.status, { error: err.message, details: err.details });
      }
      console.error(`[erro] ${req.method} ${ctx.path}`, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno. Tente novamente.' });
      else res.end();
    }
  };
}

// ── Quem está chamando ─────────────────────────────────────────────────────
// ctx.actor (cliente): { userId, operatorId, label, role, isSupport, mustChangePassword, session }
// ctx.operator (plataforma): { id, email, name, session }

function loadTenantActor(ctx) {
  const s = sessions.getSession(ctx.db, ctx.config, ctx.cookies[TENANT_COOKIE], 'tenant', ctx.tenant.id);
  if (!s) return;
  if (s.user_id) {
    const u = ctx.db.prepare('SELECT id, email, name, role, active, must_change_password FROM users WHERE id = ? AND tenant_id = ?')
      .get(s.user_id, ctx.tenant.id);
    if (!u || !u.active) return;
    ctx.actor = {
      userId: u.id, operatorId: null, label: u.email, name: u.name, email: u.email, role: u.role,
      isSupport: false, mustChangePassword: !!u.must_change_password, session: s,
    };
  } else if (s.operator_id) {
    const o = ctx.db.prepare('SELECT id, email, name, active FROM operators WHERE id = ?').get(s.operator_id);
    if (!o || !o.active) return;
    ctx.actor = {
      userId: null, operatorId: o.id, label: `Suporte: ${o.email}`, name: `${o.name} (suporte)`, email: o.email,
      role: 'admin', isSupport: true, mustChangePassword: false, session: s,
    };
  }
}

function loadOperator(ctx) {
  const s = sessions.getSession(ctx.db, ctx.config, ctx.cookies[PLATFORM_COOKIE], 'platform');
  if (!s) return;
  const o = ctx.db.prepare('SELECT id, email, name, active FROM operators WHERE id = ?').get(s.operator_id);
  if (o && o.active) ctx.operator = { id: o.id, email: o.email, name: o.name, session: s };
}

module.exports = { createApp, resolveSite };
