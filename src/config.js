const path = require('node:path');

// Único lugar que lê process.env. O resto do código recebe `config` pronto.
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'portal.sqlite'),
    // Domínio da área do operador. Cada cliente é um subdomínio dele:
    // BASE_DOMAIN=bi.vitrocrm.cloud → acme.bi.vitrocrm.cloud
    baseDomain: (env.BASE_DOMAIN || 'localhost').toLowerCase(),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    // true quando há um proxy (Caddy) na frente: o IP do cliente vem do
    // X-Forwarded-For e o protocolo do X-Forwarded-Proto.
    trustProxy: env.TRUST_PROXY === 'true',
    sessionIdleHours: Number(env.SESSION_IDLE_HOURS || 12),
    sessionMaxDays: Number(env.SESSION_MAX_DAYS || 7),
  };
}

module.exports = { loadConfig };
