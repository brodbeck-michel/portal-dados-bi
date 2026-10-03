// Administração do cliente: relatórios, pastas, usuários, acessos e registro.
import {
  api, el, applyBrand, openDialog, confirmDialog, showSecret, field, toast, formatDateTime, normalize,
} from './ui.js';
import { renderUserMenu } from './user-menu.js';

const panel = document.getElementById('panel');
const tabs = [...document.querySelectorAll('[data-tab]')];

let me;
let users = [];
let folders = [];
let reports = [];
const searchTerms = { relatorios: '', pastas: '', usuarios: '' };

applyBrand().catch(() => {});

async function reload() {
  [users, folders, reports] = await Promise.all([
    api('GET', '/api/admin/users'),
    api('GET', '/api/admin/folders'),
    api('GET', '/api/admin/reports'),
  ]);
}

function currentTab() {
  const t = location.hash.slice(1);
  return tabs.some((b) => b.dataset.tab === t) ? t : 'relatorios';
}

function render() {
  const tab = currentTab();
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ({ relatorios: renderReports, pastas: renderFolders, usuarios: renderUsers, registro: renderAudit })[tab]();
}

tabs.forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.tab; }));
window.addEventListener('hashchange', render);

async function refresh() {
  await reload();
  render();
}

// ── Peças comuns ──────────────────────────────────────────────────────────

function toolbar(tab, placeholder, ...buttons) {
  const input = el('input', {
    type: 'search', placeholder, value: searchTerms[tab], 'aria-label': placeholder,
    oninput: (e) => {
      searchTerms[tab] = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const again = panel.querySelector('input[type=search]');
      again.focus();
      again.setSelectionRange(pos, pos);
    },
  });
  return el('div', { class: 'toolbar' }, input, el('span', { class: 'spacer' }), buttons);
}

function table(headers, rows, emptyText) {
  if (!rows.length) return el('div', { class: 'empty', text: emptyText });
  return el('div', { class: 'table-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
      el('tbody', {}, rows),
    ),
  );
}

const statusBadge = (active, on = 'Ativo', off = 'Inativo') =>
  el('span', { class: `badge ${active ? 'badge-ok' : 'badge-off'}`, text: active ? on : off });

const btn = (label, onclick, kind = '') => el('button', { type: 'button', class: `btn-sm ${kind}`, text: label, onclick });

const matches = (term, ...texts) => !term || normalize(texts.join(' ')).includes(normalize(term));

function checkbox(name, label, checked) {
  return el('label', { class: 'check' }, el('input', { type: 'checkbox', name, checked }), label);
}

// ── Relatórios ────────────────────────────────────────────────────────────

function renderReports() {
  const term = searchTerms.relatorios;
  const rows = reports
    .filter((r) => matches(term, r.name, r.description, r.folder_name))
    .map((r) => el('tr', {},
      el('td', {},
        el('div', { text: r.name }),
        r.description ? el('div', { class: 'cell-sub', text: r.description }) : null),
      el('td', {},
        r.folder_name,
        r.folder_active ? null : el('span', { class: 'badge badge-warn', text: ' pasta desativada' })),
      el('td', {}, r.user_count
        ? `${r.user_count} ${r.user_count === 1 ? 'pessoa' : 'pessoas'}`
        : el('span', { class: 'badge badge-warn', title: 'Só administradores veem este relatório', text: 'Ninguém liberado' })),
      el('td', {}, statusBadge(r.active)),
      el('td', { class: 'actions' },
        btn('Quem acessa', () => reportAccessDialog(r)),
        btn('Editar', () => reportDialog(r)),
        btn('Excluir', () => removeReport(r), 'btn-danger')),
    ));
  panel.replaceChildren(
    toolbar('relatorios', 'Buscar relatório...',
      el('button', { type: 'button', class: 'btn-primary', text: 'Novo relatório', onclick: () => reportDialog(null) })),
    table(['Relatório', 'Pasta', 'Quem acessa', 'Status', ''], rows,
      reports.length ? 'Nenhum relatório com essa busca.' : 'Nenhum relatório cadastrado. Crie uma pasta e depois o primeiro relatório.'),
  );
}

function reportDialog(report) {
  if (!folders.length) {
    toast('Crie uma pasta antes de cadastrar relatórios', 'error');
    location.hash = 'pastas';
    return;
  }
  const folderSelect = el('select', { name: 'folder_id', id: 'f-folder' },
    folders.map((f) => el('option', { value: String(f.id), text: f.active ? f.name : `${f.name} (desativada)` })));
  if (report) folderSelect.value = String(report.folder_id);
  const form = el('form', { novalidate: true },
    field('Nome', el('input', { type: 'text', name: 'name', id: 'f-name', value: report?.name || '', maxlength: '120' })),
    field('Descrição (opcional)', el('input', { type: 'text', name: 'description', id: 'f-desc', value: report?.description || '', maxlength: '300' })),
    field('Pasta', folderSelect),
    field('Link do relatório', el('input', { type: 'url', name: 'url', id: 'f-url', value: report?.url || '', placeholder: 'https://app.powerbi.com/view?r=...' }),
      'No Power BI: Arquivo → Inserir relatório → Publicar na Web. Se o link vazar, gere outro lá e cole aqui.'),
    checkbox('active', 'Ativo (aparece no portal)', report ? !!report.active : true),
  );
  openDialog({
    title: report ? 'Editar relatório' : 'Novo relatório',
    body: form,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar',
        kind: 'primary',
        onClick: async (close) => {
          const body = {
            name: form.name.value,
            description: form.description.value,
            folder_id: Number(form.folder_id.value),
            url: form.url.value,
            active: form.active.checked,
          };
          if (report) await api('PUT', `/api/admin/reports/${report.id}`, body);
          else await api('POST', '/api/admin/reports', body);
          close();
          toast('Relatório salvo');
          await refresh();
        },
      },
    ],
  });
}

async function removeReport(r) {
  const ok = await confirmDialog('Excluir relatório',
    `Excluir "${r.name}"? Os acessos liberados a ele também serão removidos. O registro de acessos é mantido.`,
    { confirmLabel: 'Excluir', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/admin/reports/${r.id}`);
    toast('Relatório excluído');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Lista de marcação com busca. items: [{ id, label, sub, group }]
function pickList(items, selected, { grouped = false } = {}) {
  const chosen = new Set(selected);
  const list = el('div', { class: 'pick-list' });
  const filter = el('input', { type: 'search', placeholder: 'Filtrar...', 'aria-label': 'Filtrar lista' });

  function draw() {
    const term = filter.value;
    const visible = items.filter((i) => matches(term, i.label, i.sub, i.group));
    const nodes = [];
    let lastGroup = null;
    const groupBox = new Map();
    for (const item of visible) {
      if (grouped && item.group !== lastGroup) {
        lastGroup = item.group;
        const groupItems = visible.filter((i) => i.group === item.group);
        const box = el('input', {
          type: 'checkbox',
          onchange: (e) => { groupItems.forEach((i) => (e.target.checked ? chosen.add(i.id) : chosen.delete(i.id))); draw(); },
        });
        groupBox.set(item.group, { box, groupItems });
        nodes.push(el('div', { class: 'pick-group' }, el('label', { class: 'check' }, box, `${item.group} — pasta inteira`)));
      }
      nodes.push(el('div', { class: 'pick-item' },
        el('label', { class: 'check' },
          el('input', {
            type: 'checkbox',
            checked: chosen.has(item.id),
            onchange: (e) => { if (e.target.checked) chosen.add(item.id); else chosen.delete(item.id); draw(); },
          }),
          el('span', {}, item.label, item.sub ? el('span', { class: 'cell-sub', text: ` ${item.sub}` }) : null))));
    }
    for (const { box, groupItems } of groupBox.values()) {
      const n = groupItems.filter((i) => chosen.has(i.id)).length;
      box.checked = n === groupItems.length;
      box.indeterminate = n > 0 && n < groupItems.length;
    }
    list.replaceChildren(...(nodes.length ? nodes : [el('div', { class: 'pick-item muted', text: 'Nada encontrado.' })]));
    counter.textContent = `${chosen.size} selecionado(s)`;
  }

  const counter = el('span', { class: 'muted small' });
  filter.addEventListener('input', draw);
  draw();
  return {
    node: el('div', {}, el('div', { class: 'toolbar' }, filter, el('span', { class: 'spacer' }), counter), list),
    selected: () => [...chosen],
  };
}

async function reportAccessDialog(r) {
  const { userIds } = await api('GET', `/api/admin/reports/${r.id}/access`);
  const people = users.filter((u) => u.role === 'user');
  const picker = pickList(people.map((u) => ({
    id: u.id, label: u.name, sub: u.active ? u.email : `${u.email} (inativo)`,
  })), userIds);
  const admins = users.filter((u) => u.role === 'admin' && u.active).length;
  openDialog({
    title: `Quem acessa: ${r.name}`,
    body: el('div', {},
      !r.folder_active ? el('div', { class: 'alert alert-warn', text: `A pasta "${r.folder_name}" está desativada: ninguém vê este relatório até ela ser reativada.` }) : null,
      !r.active ? el('div', { class: 'alert alert-warn', text: 'Este relatório está inativo: ninguém o vê até ser reativado.' }) : null,
      el('p', { class: 'muted small', text: `Administradores (${admins}) veem todos os relatórios e não aparecem na lista.` }),
      people.length ? picker.node : el('div', { class: 'empty', text: 'Nenhum usuário cadastrado ainda.' }),
    ),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar acessos',
        kind: 'primary',
        onClick: async (close) => {
          await api('PUT', `/api/admin/reports/${r.id}/access`, { userIds: picker.selected() });
          close();
          toast('Acessos atualizados');
          await refresh();
        },
      },
    ],
  });
}

// ── Pastas ────────────────────────────────────────────────────────────────

function renderFolders() {
  const term = searchTerms.pastas;
  const rows = folders
    .filter((f) => matches(term, f.name))
    .map((f) => el('tr', {},
      el('td', { text: f.name }),
      el('td', { text: String(f.report_count) }),
      el('td', {}, statusBadge(f.active, 'Ativa', 'Desativada')),
      el('td', { class: 'actions' },
        btn('Renomear', () => folderDialog(f)),
        btn(f.active ? 'Desativar' : 'Reativar', () => toggleFolder(f)),
        btn('Excluir', () => removeFolder(f), 'btn-danger')),
    ));
  panel.replaceChildren(
    el('p', { class: 'muted small', text: 'Pastas organizam os relatórios no portal. Desativar uma pasta esconde todos os relatórios dela, mesmo de quem tem acesso.' }),
    toolbar('pastas', 'Buscar pasta...',
      el('button', { type: 'button', class: 'btn-primary', text: 'Nova pasta', onclick: () => folderDialog(null) })),
    table(['Pasta', 'Relatórios', 'Status', ''], rows,
      folders.length ? 'Nenhuma pasta com essa busca.' : 'Nenhuma pasta ainda. Exemplos: "Gestão", "Vendas", "Financeiro".'),
  );
}

function folderDialog(folder) {
  const form = el('form', { novalidate: true },
    field('Nome da pasta', el('input', { type: 'text', name: 'name', id: 'f-fname', value: folder?.name || '', maxlength: '80' })));
  openDialog({
    title: folder ? 'Renomear pasta' : 'Nova pasta',
    body: form,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar',
        kind: 'primary',
        onClick: async (close) => {
          if (folder) await api('PUT', `/api/admin/folders/${folder.id}`, { name: form.name.value });
          else await api('POST', '/api/admin/folders', { name: form.name.value });
          close();
          toast('Pasta salva');
          await refresh();
        },
      },
    ],
  });
}

async function toggleFolder(f) {
  if (f.active && f.report_count) {
    const ok = await confirmDialog('Desativar pasta',
      `Os ${f.report_count} relatório(s) de "${f.name}" deixam de aparecer no portal para todos até a pasta ser reativada.`,
      { confirmLabel: 'Desativar' });
    if (!ok) return;
  }
  try {
    await api('PUT', `/api/admin/folders/${f.id}`, { active: !f.active });
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeFolder(f) {
  const ok = await confirmDialog('Excluir pasta', `Excluir a pasta "${f.name}"?`, { confirmLabel: 'Excluir', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/admin/folders/${f.id}`);
    toast('Pasta excluída');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Usuários ──────────────────────────────────────────────────────────────

function userStatus(u) {
  if (!u.active) return statusBadge(false);
  if (u.must_change_password && !u.last_login_at) return el('span', { class: 'badge', text: 'Aguardando 1º acesso' });
  return statusBadge(true);
}

function renderUsers() {
  const term = searchTerms.usuarios;
  const rows = users
    .filter((u) => matches(term, u.name, u.email))
    .map((u) => el('tr', {},
      el('td', {}, el('div', { text: u.name }), el('div', { class: 'cell-sub', text: u.email })),
      el('td', {}, u.role === 'admin'
        ? el('span', { class: 'badge badge-brand', text: 'Administrador' })
        : el('span', { class: 'badge', text: 'Usuário' })),
      el('td', { text: u.role === 'admin' ? 'Todos' : String(u.report_count) }),
      el('td', { class: 'nowrap', text: formatDateTime(u.last_login_at) }),
      el('td', {}, userStatus(u)),
      el('td', { class: 'actions' },
        u.role === 'user' ? btn('Acessos', () => userAccessDialog(u)) : null,
        btn('Editar', () => userDialog(u)),
        btn('Nova senha', () => resetPassword(u)),
        u.id === me.id ? null : btn('Excluir', () => removeUser(u), 'btn-danger')),
    ));
  panel.replaceChildren(
    toolbar('usuarios', 'Buscar por nome ou e-mail...',
      el('button', { type: 'button', class: 'btn-primary', text: 'Novo usuário', onclick: () => userDialog(null) })),
    table(['Pessoa', 'Papel', 'Relatórios', 'Último login', 'Status', ''], rows, 'Nenhum usuário com essa busca.'),
  );
}

function roleSelect(value) {
  const select = el('select', { name: 'role', id: 'f-role' },
    el('option', { value: 'user', text: 'Usuário — vê só os relatórios liberados' }),
    el('option', { value: 'admin', text: 'Administrador — vê tudo e gerencia o portal' }));
  select.value = value;
  return select;
}

function userDialog(u) {
  const self = u && u.id === me.id;
  const form = el('form', { novalidate: true },
    field('Nome', el('input', { type: 'text', name: 'name', id: 'f-uname', value: u?.name || '', maxlength: '120' })),
    u ? el('p', { class: 'muted small', text: `E-mail: ${u.email}` })
      : field('E-mail (é o login)', el('input', { type: 'email', name: 'email', id: 'f-email' })),
    field('Papel', roleSelect(u?.role || 'user')),
    u ? checkbox('active', 'Ativo (pode entrar no portal)', !!u.active) : null,
  );
  if (self) {
    form.role.disabled = true;
    form.active.disabled = true;
    form.append(el('p', { class: 'muted small', text: 'Você não pode mudar o próprio papel nem se desativar.' }));
  }
  openDialog({
    title: u ? 'Editar usuário' : 'Novo usuário',
    body: form,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar',
        kind: 'primary',
        onClick: async (close) => {
          if (u) {
            const body = { name: form.name.value };
            if (!self) Object.assign(body, { role: form.role.value, active: form.active.checked });
            await api('PUT', `/api/admin/users/${u.id}`, body);
            close();
            toast('Usuário salvo');
            await refresh();
            return;
          }
          const result = await api('POST', '/api/admin/users', { name: form.name.value, email: form.email.value, role: form.role.value });
          close();
          await refresh();
          showSecret('Usuário criado',
            `Envie para ${result.user.name}: endereço ${location.origin}, login ${result.user.email} e a senha provisória abaixo.`,
            result.tempPassword);
        },
      },
    ],
  });
}

async function resetPassword(u) {
  const ok = await confirmDialog('Gerar nova senha',
    `Gerar uma senha provisória para ${u.name}? A senha atual deixa de funcionar e a pessoa é desconectada.`,
    { confirmLabel: 'Gerar senha' });
  if (!ok) return;
  try {
    const { tempPassword } = await api('POST', `/api/admin/users/${u.id}/reset-password`, {});
    showSecret('Nova senha provisória', `Envie para ${u.name} (${u.email}):`, tempPassword);
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeUser(u) {
  const ok = await confirmDialog('Excluir usuário',
    `Excluir ${u.name}? Para só bloquear o acesso e manter o cadastro, use Editar → desmarcar "Ativo".`,
    { confirmLabel: 'Excluir', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/admin/users/${u.id}`);
    toast('Usuário excluído');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function userAccessDialog(u) {
  const { reportIds } = await api('GET', `/api/admin/users/${u.id}/access`);
  const picker = pickList(reports.map((r) => ({
    id: r.id,
    label: r.name,
    sub: !r.active ? '(inativo)' : !r.folder_active ? '(pasta desativada)' : '',
    group: r.folder_name,
  })), reportIds, { grouped: true });
  openDialog({
    title: `Acessos de ${u.name}`,
    wide: true,
    body: el('div', {},
      el('p', { class: 'muted small', text: 'Marque os relatórios que esta pessoa pode abrir. "Pasta inteira" marca os relatórios que existem hoje na pasta — relatórios novos precisam ser liberados depois.' }),
      reports.length ? picker.node : el('div', { class: 'empty', text: 'Nenhum relatório cadastrado ainda.' }),
    ),
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar acessos',
        kind: 'primary',
        onClick: async (close) => {
          await api('PUT', `/api/admin/users/${u.id}/access`, { reportIds: picker.selected() });
          close();
          toast('Acessos atualizados');
          await refresh();
        },
      },
    ],
  });
}

// ── Registro de acessos ───────────────────────────────────────────────────

const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
const auditState = { de: daysAgo(30), ate: '', usuario: '', tipo: '', relatorio: '', inicio: 0 };
const PAGE = 50;

function auditQuery(extra = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...auditState, ...extra })) if (v !== '' && v != null) params.set(k, v);
  return params;
}

async function renderAudit() {
  const set = (key) => (e) => { auditState[key] = e.target.value; auditState.inicio = 0; renderAudit(); };
  const select = (key, label, options) => {
    const s = el('select', { 'aria-label': label, onchange: set(key) },
      options.map(([value, text]) => el('option', { value, text })));
    s.value = auditState[key];
    return s;
  };
  const filters = el('div', { class: 'toolbar' },
    el('input', { type: 'date', value: auditState.de, 'aria-label': 'De', onchange: set('de') }),
    el('span', { class: 'muted', text: 'até' }),
    el('input', { type: 'date', value: auditState.ate, 'aria-label': 'Até', onchange: set('ate') }),
    select('tipo', 'Tipo', [['', 'Todos os eventos'], ['acessos', 'Relatórios abertos'], ['logins', 'Logins'], ['alteracoes', 'Alterações']]),
    select('usuario', 'Pessoa', [['', 'Todas as pessoas'], ...users.map((u) => [String(u.id), u.name])]),
    select('relatorio', 'Relatório', [['', 'Todos os relatórios'], ...reports.map((r) => [String(r.id), r.name])]),
    el('span', { class: 'spacer' }),
    el('a', { class: 'btn', href: `/api/admin/audit.csv?${auditQuery({ inicio: '' })}`, text: 'Exportar planilha' }),
  );
  panel.replaceChildren(filters, el('p', { class: 'muted', text: 'Carregando...' }));

  const { total, rows, labels } = await api('GET', `/api/admin/audit?${auditQuery({ limite: PAGE })}`);
  if (currentTab() !== 'registro') return;
  const body = rows.map((r) => el('tr', {},
    el('td', { class: 'nowrap', text: formatDateTime(r.created_at) }),
    el('td', { text: r.actor_label || '—' }),
    el('td', {}, el('span', {
      class: `badge ${r.event === 'report.opened' ? 'badge-brand' : r.event.startsWith('auth.login_failed') || r.event === 'auth.locked' ? 'badge-off' : ''}`,
      text: labels[r.event] || r.event,
    })),
    el('td', { text: r.target || '—' }),
    el('td', { class: 'cell-sub', text: r.detail || '' }),
    el('td', { class: 'cell-sub nowrap', text: r.ip || '' }),
  ));
  const pager = el('div', { class: 'pager' },
    `${total ? auditState.inicio + 1 : 0}–${Math.min(auditState.inicio + PAGE, total)} de ${total}`,
    btn('← Anteriores', () => { auditState.inicio = Math.max(0, auditState.inicio - PAGE); renderAudit(); }),
    btn('Próximos →', () => { auditState.inicio += PAGE; renderAudit(); }));
  pager.querySelectorAll('button')[0].disabled = auditState.inicio === 0;
  pager.querySelectorAll('button')[1].disabled = auditState.inicio + PAGE >= total;
  panel.replaceChildren(
    filters,
    table(['Quando', 'Quem', 'Evento', 'Relatório / alvo', 'Detalhe', 'IP'], body, 'Nenhum evento no período e filtros escolhidos.'),
    total > PAGE ? pager : null,
  );
}

// ── Início ────────────────────────────────────────────────────────────────

async function start() {
  const { user } = await api('GET', '/api/me');
  if (user.role !== 'admin') {
    location.href = '/';
    return;
  }
  me = user;
  document.getElementById('support-banner').hidden = !user.isSupport;
  renderUserMenu(document.getElementById('user-menu'), user, { current: 'admin' });
  await refresh();
}

start().catch((err) => {
  if (err.status !== 401) panel.replaceChildren(el('div', { class: 'alert alert-error', text: err.message }));
});
