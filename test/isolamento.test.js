// O teste mais importante do projeto: um cliente nunca enxerga nem altera
// dado de outro, por nenhuma rota.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createOperator, setupTenant } = require('./helpers');

let srv;
let a;
let b;
let ids;

before(async () => {
  srv = await startServer();
  const creds = await createOperator(srv.db);
  const op = srv.browser('portal.test');
  await op.post('/api/platform/login', creds);
  a = await setupTenant(srv, op, 'alfa');
  b = await setupTenant(srv, op, 'beta');

  // Conteúdo no cliente B, que o admin de A vai tentar alcançar.
  const folder = await b.admin.post('/api/admin/folders', { name: 'Gestão' });
  const report = await b.admin.post('/api/admin/reports', { name: 'Faturamento B', folder_id: folder.json.id, url: 'https://exemplo.test/b' });
  const user = await b.admin.post('/api/admin/users', { name: 'Vendedor B', email: 'vendedor@beta.test' });
  ids = { folder: folder.json.id, report: report.json.id, user: user.json.user.id };
});

after(() => srv.close());

test('listagens de A não trazem nada de B', async () => {
  for (const path of ['/api/admin/folders', '/api/admin/reports']) {
    const res = await a.admin.get(path);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, [], path);
  }
  const users = await a.admin.get('/api/admin/users');
  assert.deepEqual(users.json.map((u) => u.email), ['admin@alfa.test']);
  const home = await a.admin.get('/api/portal/home');
  assert.deepEqual(home.json.folders, []);
});

test('A não lê, altera nem exclui registros de B pelo id', async () => {
  const attempts = [
    () => a.admin.put(`/api/admin/reports/${ids.report}`, { name: 'invadido' }),
    () => a.admin.del(`/api/admin/reports/${ids.report}`),
    () => a.admin.get(`/api/admin/reports/${ids.report}/access`),
    () => a.admin.put(`/api/admin/folders/${ids.folder}`, { name: 'invadido' }),
    () => a.admin.del(`/api/admin/folders/${ids.folder}`),
    () => a.admin.put(`/api/admin/users/${ids.user}`, { name: 'invadido' }),
    () => a.admin.post(`/api/admin/users/${ids.user}/reset-password`),
    () => a.admin.del(`/api/admin/users/${ids.user}`),
    () => a.admin.get(`/api/admin/users/${ids.user}/access`),
    () => a.admin.post(`/api/portal/reports/${ids.report}/open`),
    () => a.admin.put(`/api/portal/favorites/${ids.report}`),
  ];
  for (const attempt of attempts) {
    const res = await attempt();
    assert.equal(res.status, 404, res.text);
  }
  const check = await b.admin.get('/api/admin/reports');
  assert.equal(check.json[0].name, 'Faturamento B');
});

test('A não cria relatório numa pasta de B nem libera acesso cruzado', async () => {
  const report = await a.admin.post('/api/admin/reports', { name: 'X', folder_id: ids.folder, url: 'https://exemplo.test/x' });
  assert.equal(report.status, 400);

  const folder = await a.admin.post('/api/admin/folders', { name: 'Pasta A' });
  const own = await a.admin.post('/api/admin/reports', { name: 'Relatório A', folder_id: folder.json.id, url: 'https://exemplo.test/a' });
  const cross = await a.admin.put(`/api/admin/reports/${own.json.id}/access`, { userIds: [ids.user] });
  assert.equal(cross.status, 400);
  const me = (await a.admin.get('/api/me')).json.user;
  const reverse = await a.admin.put(`/api/admin/users/${me.id}/access`, { reportIds: [ids.report] });
  assert.equal(reverse.status, 400);
});

test('a sessão de A não vale no endereço de B', async () => {
  const stolen = srv.browser('beta.portal.test');
  stolen.cookies = { ...a.admin.cookies };
  const res = await stolen.get('/api/me');
  assert.equal(res.status, 401);
});

test('o registro de acessos de A não mostra eventos de B', async () => {
  const res = await a.admin.get('/api/admin/audit?de=2000-01-01');
  assert.equal(res.status, 200);
  assert.ok(res.json.rows.length > 0);
  assert.ok(res.json.rows.every((r) => !String(r.actor_label).includes('beta')), JSON.stringify(res.json.rows));
});

test('o mesmo e-mail pode existir em dois clientes', async () => {
  const one = await a.admin.post('/api/admin/users', { name: 'Consultor', email: 'consultor@x.test' });
  const two = await b.admin.post('/api/admin/users', { name: 'Consultor', email: 'consultor@x.test' });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
});
