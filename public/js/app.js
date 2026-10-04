// Portal do cliente e administração numa página só: coluna lateral + conteúdo,
// navegação por hash para o Voltar do navegador funcionar.
//   #/                 Início          #/relatorio/ID      painel aberto
//   #/favoritos        Favoritos       #/admin/<seção>     administração (só admin)
//   #/pasta/ID         uma pasta
import {
  api, el, applyBrand, setPageTitle, normalize, toast, icon, timeAgo, initials, currentTheme, toggleTheme,
} from './ui.js';
import { signature } from './signature.js';
import { mountAdmin, ADMIN_SECTIONS } from './admin.js';

const app = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const main = document.getElementById('main');
const view = document.getElementById('view');

let brand = { name: '', title: '' };
let user;
let data = { folders: [], favorites: [], recent: [] };
let foldersById = new Map();
let reportsById = new Map();
let favorites = new Set();
let current = { name: 'home' };
let term = '';
let drawBody = () => {};

// ── Dados ─────────────────────────────────────────────────────────────────

async function loadHome() {
  data = await api('GET', '/api/portal/home');
  foldersById = new Map(data.folders.map((f) => [f.id, f]));
  reportsById = new Map(data.folders.flatMap((f) => f.reports.map((r) => [r.id, { ...r, folderId: f.id }])));
  favorites = new Set(data.favorites.filter((id) => reportsById.has(id)));
}

const countLabel = (n) => `${n} ${n === 1 ? 'painel' : 'painéis'}`;

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  let m;
  if (h === 'favoritos') return { name: 'favorites' };
  if ((m = /^pasta\/(\d+)$/.exec(h))) return { name: 'folder', id: Number(m[1]) };
  if ((m = /^relatorio\/(\d+)$/.exec(h))) return { name: 'report', id: Number(m[1]) };
  if ((m = /^admin\/([a-z]+)$/.exec(h)) && ADMIN_SECTIONS[m[1]]) return { name: 'admin', section: m[1] };
  return { name: 'home' };
}

// ── Coluna lateral ────────────────────────────────────────────────────────

function navItem(href, label, lead, { active = false, count } = {}) {
  return el('a', { class: 'nav-item', href, title: label, 'aria-current': active ? 'page' : null },
    lead,
    el('span', { class: 'nav-label', text: label }),
    count != null ? el('span', { class: 'nav-count', text: String(count) }) : null);
}

function brandRow() {
  const props = { class: 'brand-row', href: '#/', title: brand.title };
  if (brand.logoUrl) {
    // Logo inteira com a coluna aberta; recortada no quadrado quando recolhida.
    return el('a', props,
      el('img', { class: 'brand-logo', src: brand.logoUrl, alt: brand.name }),
      el('span', { class: 'brand-chip', 'data-when-collapsed': '', hidden: true }, el('img', { src: brand.logoUrl, alt: '' })));
  }
  return el('a', props,
    el('span', { class: 'brand-chip', 'aria-hidden': 'true', text: initials(brand.name).slice(0, 1) }),
    el('span', { class: 'brand-text' },
      el('div', { class: 'brand-name', text: brand.name }),
      brand.title !== brand.name ? el('div', { class: 'brand-sub', text: brand.title }) : null));
}

function closeMenus() {
  document.querySelectorAll('.menu-list').forEach((m) => { m.hidden = true; });
}

function userRow() {
  const dark = currentTheme() === 'dark';
  const item = (iconName, label, onclick) => el('button', { type: 'button', role: 'menuitem', onclick }, icon(iconName), label);
  const menu = el('div', { class: 'menu-list', role: 'menu', hidden: true },
    el('div', { class: 'menu-head', text: user.email }),
    el('div', { class: 'menu-sep' }),
    user.isSupport ? null : el('a', { href: '/trocar-senha', role: 'menuitem' }, icon('key'), 'Trocar senha'),
    item(dark ? 'sun' : 'moon', dark ? 'Tema claro' : 'Tema escuro', () => { toggleTheme(); renderSidebar(); }),
    el('div', { class: 'menu-sep' }),
    item('log-out', user.isSupport ? 'Encerrar suporte' : 'Sair', async () => {
      await api('POST', '/api/auth/logout', {}, { redirect: false }).catch(() => {});
      location.href = '/login';
    }),
  );
  const toggle = (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
  };
  const role = user.isSupport ? 'Suporte' : user.role === 'admin' ? 'Administrador' : 'Usuário';
  return el('div', { class: 'user-row' },
    el('button', { type: 'button', class: 'avatar', 'aria-label': 'Menu da conta', 'aria-haspopup': 'true', title: user.name, onclick: toggle, text: initials(user.name) }),
    el('div', { class: 'user-text' },
      el('div', { class: 'user-name', text: user.name }),
      el('div', { class: 'user-role', text: role })),
    el('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Menu da conta', 'aria-haspopup': 'true', onclick: toggle }, icon('ellipsis')),
    menu);
}

function renderSidebar() {
  const r = current;
  const activeFolder = r.name === 'folder' ? r.id : r.name === 'report' ? reportsById.get(r.id)?.folderId : null;
  const nodes = [
    brandRow(),
    el('nav', { class: 'nav' },
      navItem('#/', 'Início', icon('house'), { active: r.name === 'home' }),
      user.isSupport ? null : navItem('#/favoritos', 'Favoritos', icon('star'), { active: r.name === 'favorites', count: favorites.size })),
  ];
  if (data.folders.length) {
    nodes.push(el('div', { class: 'nav-group', text: 'Pastas' }),
      el('nav', { class: 'nav', 'aria-label': 'Pastas' }, data.folders.map((f) => navItem(`#/pasta/${f.id}`, f.name,
        el('span', { class: 'folder-chip', 'aria-hidden': 'true', text: (f.name.trim()[0] || '?').toUpperCase() }),
        { active: activeFolder === f.id, count: f.reports.length }))));
  }
  if (user.role === 'admin') {
    nodes.push(el('div', { class: 'nav-group', text: 'Administração' }),
      el('nav', { class: 'nav', 'aria-label': 'Administração' }, Object.entries(ADMIN_SECTIONS).map(([key, s]) =>
        navItem(`#/admin/${key}`, s.title, icon(s.icon), { active: r.name === 'admin' && r.section === key }))));
  }
  nodes.push(userRow());
  sidebar.replaceChildren(...nodes);
}

// ── Cartões, lista e estrela ──────────────────────────────────────────────

function starButton(id) {
  if (user.isSupport) return null;
  const on = favorites.has(id);
  const label = on ? 'Tirar dos favoritos' : 'Adicionar aos favoritos';
  return el('button', {
    type: 'button', class: `star${on ? ' is-on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on),
    onclick: (e) => { e.stopPropagation(); toggleFavorite(id); },
  }, icon('star'));
}

// inFolder: dentro da pasta a meta mostra a descrição (a pasta já está no título).
function card(r, { inFolder = false } = {}) {
  const meta = inFolder ? r.description || r.folderName : r.folderName;
  return el('div', { class: 'card' },
    el('div', { class: 'card-art' }, signature(r.id)),
    el('div', { class: 'card-body' },
      el('div', { class: 'card-title', text: r.name }),
      meta ? el('div', { class: 'card-meta', text: meta }) : null),
    el('a', { class: 'card-open', href: `#/relatorio/${r.id}`, 'aria-label': r.name }),
    starButton(r.id));
}

function gridSection(title, sub, reports, opts) {
  return el('section', { class: 'section' },
    el('div', { class: 'section-head' },
      el('h2', { text: title }),
      sub ? el('span', { class: 'section-sub', text: sub }) : null),
    el('div', { class: 'cards' }, reports.map((r) => card(r, opts))));
}

function recentSection(items) {
  return el('section', { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', { text: 'Abertos recentemente' })),
    el('div', { class: 'list' }, items.map(({ report: r, openedAt }) => el('button', {
      type: 'button', class: 'list-row', onclick: () => { location.hash = `#/relatorio/${r.id}`; },
    },
    el('span', { class: 'list-art' }, signature(r.id)),
    el('span', { class: 'list-text' },
      el('div', { class: 'list-title', text: r.name }),
      el('div', { class: 'list-meta', text: r.folderName })),
    el('span', { class: 'list-when', title: new Date(openedAt).toLocaleString('pt-BR'), text: timeAgo(openedAt) })))));
}

function emptyBox(title, text) {
  return el('div', { class: 'empty' }, el('h2', { text: title }), el('p', { text }));
}

// ── Início, Favoritos, pasta e busca ──────────────────────────────────────

function sectionsFor(r) {
  const all = [...reportsById.values()];
  const q = normalize(term.trim());
  if (q) {
    const found = all.filter((x) => normalize(`${x.name} ${x.description || ''} ${x.folderName}`).includes(q));
    return found.length
      ? [gridSection('Resultados', countLabel(found.length), found)]
      : [el('p', { class: 'muted', text: `Nenhum painel encontrado para “${term.trim()}”.` })];
  }
  if (!all.length) {
    return [emptyBox('Nenhum painel liberado ainda', 'Quando o administrador liberar painéis, eles aparecem aqui.')];
  }
  const favs = [...favorites].map((id) => reportsById.get(id)).filter(Boolean);
  if (r.name === 'favorites') {
    return favs.length
      ? [gridSection('Favoritos', countLabel(favs.length), favs)]
      : [emptyBox('Nenhum favorito ainda', 'Marque a estrela de um painel para ele aparecer aqui.')];
  }
  if (r.name === 'folder') {
    const f = foldersById.get(r.id);
    const reports = f.reports.map((x) => reportsById.get(x.id));
    return [gridSection(f.name, countLabel(reports.length), reports, { inFolder: true })];
  }
  const out = [];
  if (favs.length) out.push(gridSection('Favoritos', '', favs));
  const recent = data.recent.map((x) => ({ report: reportsById.get(x.id), openedAt: x.openedAt })).filter((x) => x.report);
  if (recent.length) out.push(recentSection(recent));
  for (const f of data.folders) {
    out.push(gridSection(f.name, countLabel(f.reports.length), f.reports.map((x) => reportsById.get(x.id)), { inFolder: true }));
  }
  return out;
}

function greeting() {
  const h = new Date().getHours();
  const first = String(user.name).trim().split(/\s+/)[0];
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${first}`;
}

function renderPage(r) {
  const heading = r.name === 'favorites' ? 'Favoritos' : r.name === 'folder' ? foldersById.get(r.id).name : greeting();
  setPageTitle(r.name === 'home' ? '' : heading, brand);
  const input = el('input', { type: 'search', id: 'search', placeholder: 'Buscar painel', 'aria-label': 'Buscar painel', value: term, autocomplete: 'off' });
  const body = el('div', { class: 'page-sections' });
  drawBody = () => body.replaceChildren(...sectionsFor(r));
  input.addEventListener('input', () => { term = input.value; drawBody(); });
  drawBody();
  view.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' },
      el('div', {},
        el('div', { class: 'page-date', text: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) }),
        el('h1', { text: heading })),
      el('label', { class: 'search' }, icon('search'), input, el('span', { class: 'kbd', 'aria-hidden': 'true', text: 'Ctrl K' }))),
    body));
}

// ── Painel aberto ─────────────────────────────────────────────────────────

let starInBar = null;

async function renderReport(id) {
  const r = reportsById.get(id);
  const folder = r && foldersById.get(r.folderId);
  setPageTitle(r?.name || 'Painel', brand);
  const status = el('span', { text: 'Abrindo painel...' });
  const stage = el('div', { class: 'report-stage' }, el('div', { class: 'report-status' }, status));
  const full = el('button', { type: 'button', class: 'btn-primary', disabled: true }, icon('maximize'), 'Tela cheia');
  const name = el('span', { class: 'crumb-current', text: r?.name || 'Painel' });
  starInBar = starButton(id);
  view.replaceChildren(el('div', { class: 'report' },
    el('div', { class: 'report-bar' },
      folder ? el('button', { type: 'button', class: 'crumb-folder', text: folder.name, onclick: () => { location.hash = `#/pasta/${folder.id}`; } }) : null,
      folder ? el('span', { class: 'crumb-sep', 'aria-hidden': 'true', text: '›' }) : null,
      name, starInBar, full),
    stage));

  try {
    const report = await api('POST', `/api/portal/reports/${id}/open`, {});
    if (current.name !== 'report' || current.id !== id) return;
    name.textContent = report.name;
    setPageTitle(report.name, brand);
    const frame = el('iframe', {
      class: 'report-frame', title: report.name, src: report.url, allowfullscreen: true, referrerpolicy: 'no-referrer',
    });
    stage.replaceChildren(frame);
    full.disabled = false;
    full.addEventListener('click', () => frame.requestFullscreen?.());
    data.recent = [{ id, openedAt: new Date().toISOString() }, ...data.recent.filter((x) => x.id !== id)].slice(0, 6);
  } catch (err) {
    if (err.status !== 401) status.textContent = err.message;
  }
}

async function toggleFavorite(id) {
  const on = !favorites.has(id);
  try {
    await api(on ? 'PUT' : 'DELETE', `/api/portal/favorites/${id}`);
    if (on) favorites.add(id); else favorites.delete(id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  renderSidebar();
  if (current.name === 'report') {
    const next = starButton(id);
    starInBar?.replaceWith(next);
    starInBar = next;
  } else if (current.name !== 'admin') {
    drawBody();
  }
}

// ── Administração ─────────────────────────────────────────────────────────

async function renderAdmin(section) {
  setPageTitle(ADMIN_SECTIONS[section].title, brand);
  try {
    // Mudança no admin (pasta, relatório, acesso) reflete na coluna.
    await mountAdmin(view, user, section, {
      onChange: async () => { await loadHome(); renderSidebar(); },
    });
  } catch (err) {
    if (err.status !== 401) view.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'alert alert-error', text: err.message })));
  }
}

// ── Roteador e gaveta do celular ──────────────────────────────────────────

function setDrawer(open) {
  app.classList.toggle('is-drawer-open', open);
}

function route() {
  let r = parseRoute();
  if (r.name === 'folder' && !foldersById.has(r.id)) r = { name: 'home' };
  if (r.name === 'admin' && user.role !== 'admin') r = { name: 'home' };
  const sameView = r.name === current.name && r.id === current.id && r.section === current.section;
  current = r;
  if (!sameView) term = '';
  setDrawer(false);
  closeMenus();
  app.classList.toggle('is-collapsed', r.name === 'report');
  renderSidebar();
  main.scrollTop = 0;
  if (r.name === 'report') renderReport(r.id);
  else if (r.name === 'admin') renderAdmin(r.section);
  else renderPage(r);
}

function focusSearch() {
  const input = document.getElementById('search');
  if (input) {
    input.focus();
    input.select();
    return;
  }
  location.hash = '#/';
  requestAnimationFrame(() => document.getElementById('search')?.focus());
}

document.addEventListener('click', closeMenus);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    focusSearch();
  } else if (e.key === 'Escape') {
    closeMenus();
    setDrawer(false);
  }
});

const drawerButton = document.getElementById('drawer-open');
drawerButton.append(icon('menu'));
drawerButton.addEventListener('click', () => setDrawer(true));
document.getElementById('scrim').addEventListener('click', () => setDrawer(false));

async function start() {
  const [b, me] = await Promise.all([applyBrand().catch(() => null), api('GET', '/api/me')]);
  ({ user } = me);
  if (user.mustChangePassword) {
    location.href = '/trocar-senha';
    return;
  }
  if (b) brand = b;
  document.getElementById('mobile-title').textContent = brand.title;
  document.getElementById('support-banner').hidden = !user.isSupport;
  await loadHome();
  window.addEventListener('hashchange', route);
  route();
}

start().catch((err) => {
  if (err.status !== 401) view.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'alert alert-error', text: err.message })));
});
