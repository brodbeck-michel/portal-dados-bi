// Visibilidade no portal, registro de abertura, login e regras de usuário.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createOperator, setupTenant, loginAndSetPassword } = require('./helpers');

let srv;
let admin;
let vendedor;
let vendedorId;
let gestao;
let vendas;
let folders;

before(async () => {
  srv = await startServer();
  const op = srv.browser('portal.test');
  await op.post('/api/platform/login', await createOperator(srv.db));
  ({ admin } = await setupTenant(srv, op, 'acme'));

  folders = {
    gestao: (await admin.post('/api/admin/folders', { name: 'Gestão' })).json.id,
    vendas: (await admin.post('/api/admin/folders', { name: 'Vendas' })).json.id,
  };
  gestao = (await admin.post('/api/admin/reports', { name: 'Painel de Gestão', folder_id: folders.gestao, url: 'https://app.powerbi.com/view?r=gestao' })).json;
  vendas = (await admin.post('/api/admin/reports', { name: 'Vendas do mês', folder_id: folders.vendas, url: 'https://app.powerbi.com/view?r=vendas' })).json;

  const created = await admin.post('/api/admin/users', { name: 'Vendedor', email: 'vendedor@acme.test' });
  vendedorId = created.json.user.id;
  vendedor = srv.browser('acme.portal.test');
  await loginAndSetPassword(vendedor, 'vendedor@acme.test', created.json.tempPassword);
});

after(() => srv.close());

test('usuário sem liberação não vê nem abre nada', async () => {
  const home = await vendedor.get('/api/portal/home');
  assert.deepEqual(home.json.folders, []);
  const open = await vendedor.post(`/api/portal/reports/${gestao.id}/open`);
  assert.equal(open.status, 404);
});

test('liberação por relatório: vê só o liberado, e a listagem não expõe o link', async () => {
  await admin.put(`/api/admin/reports/${vendas.id}/access`, { userIds: [vendedorId] });
  const home = await vendedor.get('/api/portal/home');
  assert.deepEqual(home.json.folders.map((f) => f.name), ['Vendas']);
  assert.ok(!home.text.includes('powerbi.com'), 'o link só pode sair pela rota de abrir');

  const open = await vendedor.post(`/api/portal/reports/${vendas.id}/open`);
  assert.equal(open.status, 200);
  assert.equal(open.json.url, 'https://app.powerbi.com/view?r=vendas');
  assert.equal((await vendedor.post(`/api/portal/reports/${gestao.id}/open`)).status, 404);
});

test('abrir relatório fica no registro com quem, qual e IP', async () => {
  const log = await admin.get(`/api/admin/audit?de=2000-01-01&tipo=acessos&usuario=${vendedorId}`);
  assert.equal(log.json.rows.length, 1);
  const [row] = log.json.rows;
  assert.equal(row.event, 'report.opened');
  assert.equal(row.actor_label, 'vendedor@acme.test');
  assert.equal(row.target, 'Vendas do mês');
  assert.ok(row.ip);

  const recent = await vendedor.get('/api/portal/home');
  assert.deepEqual(recent.json.recent, [vendas.id]);

  const csv = await admin.get('/api/admin/audit.csv?de=2000-01-01&tipo=acessos');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Abriu relatório/);
});

test('pasta desativada esconde o relatório mesmo com acesso', async () => {
  await admin.put(`/api/admin/folders/${folders.vendas}`, { active: false });
  assert.deepEqual((await vendedor.get('/api/portal/home')).json.folders, []);
  assert.equal((await vendedor.post(`/api/portal/reports/${vendas.id}/open`)).status, 404);
  await admin.put(`/api/admin/folders/${folders.vendas}`, { active: true });
});

test('admin vê todos os relatórios ativos', async () => {
  const home = await admin.get('/api/portal/home');
  assert.deepEqual(home.json.folders.map((f) => f.name), ['Gestão', 'Vendas']);
});

test('favoritos só de relatório visível', async () => {
  assert.equal((await vendedor.put(`/api/portal/favorites/${gestao.id}`)).status, 404);
  assert.equal((await vendedor.put(`/api/portal/favorites/${vendas.id}`)).status, 200);
  assert.deepEqual((await vendedor.get('/api/portal/home')).json.favorites, [vendas.id]);
});

test('usuário comum não acessa a administração', async () => {
  assert.equal((await vendedor.get('/api/admin/users')).status, 403);
  assert.equal((await vendedor.put(`/api/admin/reports/${vendas.id}/access`, { userIds: [vendedorId] })).status, 403);
});

test('senha provisória bloqueia o portal até ser trocada', async () => {
  const created = await admin.post('/api/admin/users', { name: 'Novo', email: 'novo@acme.test' });
  const novo = srv.browser('acme.portal.test');
  const login = await novo.post('/api/auth/login', { email: 'novo@acme.test', password: created.json.tempPassword });
  assert.equal(login.json.mustChangePassword, true);
  assert.equal((await novo.get('/api/portal/home')).status, 403);
  assert.equal((await novo.get('/api/me')).status, 200);
  const weak = await novo.post('/api/auth/change-password', { currentPassword: created.json.tempPassword, newPassword: 'curta' });
  assert.equal(weak.status, 400);
});

test('5 senhas erradas travam a conta, mesmo com a senha certa depois', async () => {
  const created = await admin.post('/api/admin/users', { name: 'Alvo', email: 'alvo@acme.test' });
  const browser = srv.browser('acme.portal.test');
  for (let i = 0; i < 4; i++) {
    assert.equal((await browser.post('/api/auth/login', { email: 'alvo@acme.test', password: 'errada123456' })).status, 401);
  }
  assert.equal((await browser.post('/api/auth/login', { email: 'alvo@acme.test', password: 'errada123456' })).status, 429);
  const right = await browser.post('/api/auth/login', { email: 'alvo@acme.test', password: created.json.tempPassword });
  assert.equal(right.status, 429);

  // Nova senha pelo admin destrava.
  const reset = await admin.post(`/api/admin/users/${created.json.user.id}/reset-password`);
  assert.equal((await browser.post('/api/auth/login', { email: 'alvo@acme.test', password: reset.json.tempPassword })).status, 200);
});

test('desativar derruba a sessão na hora', async () => {
  await admin.put(`/api/admin/users/${vendedorId}`, { active: false });
  assert.equal((await vendedor.get('/api/portal/home')).status, 401);
  await admin.put(`/api/admin/users/${vendedorId}`, { active: true });
});

test('não dá para ficar sem administrador nem se rebaixar', async () => {
  const me = (await admin.get('/api/me')).json.user;
  assert.equal((await admin.put(`/api/admin/users/${me.id}`, { role: 'user' })).status, 400);
  assert.equal((await admin.del(`/api/admin/users/${me.id}`)).status, 400);
});

test('link do relatório precisa ser https', async () => {
  const res = await admin.post('/api/admin/reports', { name: 'X', folder_id: folders.gestao, url: 'javascript:alert(1)' });
  assert.equal(res.status, 400);
  assert.equal(res.json.details[0].field, 'url');
});

test('pasta com relatórios não pode ser excluída', async () => {
  assert.equal((await admin.del(`/api/admin/folders/${folders.gestao}`)).status, 409);
});

test('mutação vinda de outra origem é recusada', async () => {
  const res = await admin.post('/api/admin/folders', { name: 'CSRF' }, { Origin: 'https://atacante.test' });
  assert.equal(res.status, 403);
  const sibling = await admin.post('/api/admin/folders', { name: 'CSRF' }, { Origin: 'http://outro.portal.test' });
  assert.equal(sibling.status, 403);
});

test('cliente inexistente ou suspenso responde 404', async () => {
  assert.equal((await srv.browser('nao-existe.portal.test').get('/api/branding')).status, 404);
  assert.equal((await srv.browser('a.b.portal.test').get('/')).status, 404);
});

test('cabeçalhos de segurança presentes', async () => {
  const res = await srv.browser('acme.portal.test').get('/login');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
