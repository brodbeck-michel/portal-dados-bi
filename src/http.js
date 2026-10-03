// Utilitários HTTP: erros, JSON, cookies, validação e um roteador mínimo.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const notFound = (message = 'Não encontrado') => new HttpError(404, message);
const forbidden = (message = 'Sem permissão') => new HttpError(403, message);
const unauthorized = (message = 'Faça login para continuar') => new HttpError(401, message);
const conflict = (message) => new HttpError(409, message);

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Conteúdo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1_500_000) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  try {
    const data = JSON.parse(raw.toString('utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw badRequest('JSON inválido');
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key && !(key in out)) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Sem atributo Domain de propósito: o cookie fica preso ao host exato, então
// a sessão de um cliente nunca é enviada ao subdomínio de outro.
function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// ── Validação ──────────────────────────────────────────────────────────────
// Cada função recebe a lista `errors` e acrescenta { field, message } quando
// falha — a resposta 400 devolve todos os problemas de uma vez.

function text(value, field, label, errors, { required = true, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) errors.push({ field, message: `${label} é obrigatório` });
    return null;
  }
  if (v.length > max) errors.push({ field, message: `${label} deve ter no máximo ${max} caracteres` });
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(value, field, errors) {
  const v = text(value, field, 'E-mail', errors, { max: 254 });
  if (v && !EMAIL_RE.test(v)) errors.push({ field, message: 'E-mail inválido' });
  return v ? v.toLowerCase() : v;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function ensureValid(errors) {
  if (errors.length) throw badRequest('Verifique os campos destacados', errors);
}

// ── Roteador ───────────────────────────────────────────────────────────────

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const source = pattern.replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    routes.push({ method, re: new RegExp(`^${source}$`), keys, handler });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    // Devolve o handler e os parâmetros, ou null. 405 não é diferenciado de 404.
    match(method, path) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.re.exec(path);
        if (!m) continue;
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}

module.exports = {
  HttpError, badRequest, notFound, forbidden, unauthorized, conflict,
  sendJson, readBody, readJson, parseCookies, serializeCookie,
  text, email, bool, id, ensureValid,
  createRouter,
};
