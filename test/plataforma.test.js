// Área do operador: acesso, cadastro de cliente, marca e suporte.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createOperator } = require('./helpers');

let srv;
let op;
let tenant;

before(async () => {
  srv = await startServer();
  op = srv.browser('portal.test');
  const login = await op.post('/api/platform/login', await createOperator(srv.db));
  assert.equal(login.status, 200);
  tenant = (await op.post('/api/platform/tenants', { slug: 'acme', name: 'Acme', brand_color: '#1D4ED8' })).json;
});

after(() => srv.close());

test('a área do operador exige login de operador', async () => {
  const anon = srv.browser('portal.test');
  assert.equal((await anon.get('/api/platform/tenants')).status, 401);
  // A rota da plataforma não existe no endereço de um cliente.
  const fromTenant = srv.browser('acme.portal.test');
  assert.equal((await fromTenant.get('/api/platform/tenants')).status, 404);
});

test('endereço do cliente: formato, reservado e duplicado', async () => {
  assert.equal((await op.post('/api/platform/tenants', { slug: 'Com Espaço', name: 'X' })).status, 400);
  assert.equal((await op.post('/api/platform/tenants', { slug: 'www', name: 'X' })).status, 400);
  assert.equal((await op.post('/api/platform/tenants', { slug: 'acme', name: 'X' })).status, 409);
});

test('marca pública do cliente, com cor e logo', async () => {
  const site = srv.browser('acme.portal.test');
  let brand = await site.get('/api/branding');
  assert.deepEqual(brand.json, { name: 'Acme', color: '#1d4ed8', logoUrl: null });

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
  const up = await op.put(`/api/platform/tenants/${tenant.id}/logo`, { logo: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(up.status, 200);
  brand = await site.get('/api/branding');
  assert.ok(brand.json.logoUrl);
  const logo = await site.get('/api/branding/logo');
  assert.equal(logo.headers['content-type'], 'image/png');

  const fake = await op.put(`/api/platform/tenants/${tenant.id}/logo`, { logo: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' });
  assert.equal(fake.status, 400);
});

test('suspender o cliente tira o portal do ar', async () => {
  await op.put(`/api/platform/tenants/${tenant.id}`, { active: false });
  assert.equal((await srv.browser('acme.portal.test').get('/api/branding')).status, 404);
  await op.put(`/api/platform/tenants/${tenant.id}`, { active: true });
});

test('suporte: link de uso único abre sessão de admin registrada como suporte', async () => {
  const { json } = await op.post(`/api/platform/tenants/${tenant.id}/support`);
  const path = new URL(json.url).pathname + new URL(json.url).search;
  assert.match(json.url, /^http:\/\/acme\.portal\.test/);

  const support = srv.browser('acme.portal.test');
  const first = await support.get(path);
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, '/admin');
  const me = await support.get('/api/me');
  assert.equal(me.json.user.isSupport, true);
  assert.equal(me.json.user.role, 'admin');
  assert.equal((await support.post('/api/admin/folders', { name: 'Criada pelo suporte' })).status, 200);

  const log = await support.get('/api/admin/audit?de=2000-01-01&tipo=alteracoes');
  assert.ok(log.json.rows.some((r) => r.event === 'folder.created' && r.actor_label.startsWith('Suporte:')));

  // Segundo uso do mesmo link: recusado.
  const again = srv.browser('acme.portal.test');
  const reuse = await again.get(path);
  assert.equal(reuse.headers.location, '/login?suporte=expirado');
  assert.equal((await again.get('/api/me')).status, 401);
});

test('link de suporte de um cliente não abre outro', async () => {
  const other = (await op.post('/api/platform/tenants', { slug: 'outro', name: 'Outro' })).json;
  const { json } = await op.post(`/api/platform/tenants/${tenant.id}/support`);
  const path = new URL(json.url).pathname + new URL(json.url).search;
  const res = await srv.browser(`${other.slug}.portal.test`).get(path);
  assert.equal(res.headers.location, '/login?suporte=expirado');
});

test('tls-ask só autoriza certificado para cliente cadastrado', async () => {
  const b = srv.browser('127.0.0.1');
  assert.equal((await b.get('/internal/tls-ask?domain=acme.portal.test')).status, 200);
  assert.equal((await b.get('/internal/tls-ask?domain=portal.test')).status, 200);
  assert.equal((await b.get('/internal/tls-ask?domain=desconhecido.portal.test')).status, 404);
  assert.equal((await b.get('/internal/tls-ask?domain=evil.com')).status, 404);
});
