// Sobe o app num banco em memória e oferece um cliente HTTP com cookies por
// host — para simular navegadores em subdomínios diferentes.
const http = require('node:http');
const { openDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/passwords');

async function startServer() {
  const config = loadConfig({ BASE_DOMAIN: 'portal.test', NODE_ENV: 'test' });
  const db = openDb(':memory:');
  const server = http.createServer(createApp({ db, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    db,
    config,
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
    browser: (host) => new Browser(port, host),
  };
}

class Browser {
  constructor(port, host) {
    this.port = port;
    this.host = host;
    this.cookies = {};
  }

  request(method, path, body, headers = {}) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        method,
        path,
        headers: {
          Host: this.host,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          for (const set of [].concat(res.headers['set-cookie'] || [])) {
            const [pair] = set.split(';');
            const [k, v] = pair.split('=');
            if (/Max-Age=0/.test(set)) delete this.cookies[k];
            else this.cookies[k] = v;
          }
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* não é JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path, headers) { return this.request('GET', path, undefined, headers); }
  post(path, body = {}, headers) { return this.request('POST', path, body, headers); }
  put(path, body = {}, headers) { return this.request('PUT', path, body, headers); }
  del(path, headers) { return this.request('DELETE', path, undefined, headers); }
}

async function createOperator(db, email = 'op@plataforma.test', password = 'Operador12345') {
  db.prepare('INSERT INTO operators (email, name, password_hash) VALUES (?, ?, ?)').run(email, 'Operador', await hashPassword(password));
  return { email, password };
}

// Cria cliente + admin pela API do operador e devolve um navegador já logado
// como esse admin, com a senha provisória trocada.
async function setupTenant(srv, operatorBrowser, slug) {
  const t = await operatorBrowser.post('/api/platform/tenants', { slug, name: `Cliente ${slug}` });
  if (t.status !== 200) throw new Error(`criar cliente: ${t.text}`);
  const a = await operatorBrowser.post(`/api/platform/tenants/${t.json.id}/admins`, { name: 'Admin', email: `admin@${slug}.test` });
  const admin = srv.browser(`${slug}.portal.test`);
  await loginAndSetPassword(admin, `admin@${slug}.test`, a.json.tempPassword);
  return { tenant: t.json, admin };
}

async function loginAndSetPassword(browser, email, tempPassword, newPassword = 'SenhaNova12345') {
  const login = await browser.post('/api/auth/login', { email, password: tempPassword });
  if (login.status !== 200) throw new Error(`login: ${login.text}`);
  const change = await browser.post('/api/auth/change-password', { currentPassword: tempPassword, newPassword });
  if (change.status !== 200) throw new Error(`troca de senha: ${change.text}`);
  return newPassword;
}

module.exports = { startServer, createOperator, setupTenant, loginAndSetPassword };
