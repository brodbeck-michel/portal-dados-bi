// Portal: Favoritos, Recentes e pastas; o relatório abre no visualizador.
// Navegação por hash (#/relatorio/12) para o Voltar do navegador funcionar.
import { api, el, applyBrand, normalize, toast } from './ui.js';
import { renderUserMenu } from './user-menu.js';

const home = document.getElementById('home');
const search = document.getElementById('search');
const viewer = {
  root: document.getElementById('viewer'),
  title: document.getElementById('viewer-title'),
  frame: document.getElementById('viewer-frame'),
  status: document.getElementById('viewer-status'),
  fav: document.getElementById('viewer-fav'),
  full: document.getElementById('viewer-full'),
  back: document.getElementById('viewer-back'),
};

let user;
let data = { folders: [], favorites: [], recent: [] };
let reportsById = new Map();
let favorites = new Set();
let openReportId = null;

applyBrand().catch(() => {});

async function load() {
  ({ user } = await api('GET', '/api/me'));
  if (user.mustChangePassword) {
    location.href = '/trocar-senha';
    return;
  }
  document.getElementById('support-banner').hidden = !user.isSupport;
  renderUserMenu(document.getElementById('user-menu'), user, { current: 'portal' });

  data = await api('GET', '/api/portal/home');
  reportsById = new Map(data.folders.flatMap((f) => f.reports).map((r) => [r.id, r]));
  favorites = new Set(data.favorites);
  render();
  route();
}

// ── Tela inicial ──────────────────────────────────────────────────────────

function tile(report) {
  const isFav = favorites.has(report.id);
  return el('button', { type: 'button', class: 'tile', onclick: () => { location.hash = `#/relatorio/${report.id}`; } },
    el('span', { class: 'tile-icon', 'aria-hidden': 'true', text: '▥' }),
    el('span', { class: 'tile-name', text: report.name }),
    report.description ? el('span', { class: 'tile-desc', text: report.description }) : null,
    user.isSupport ? null : el('span', {
      class: `tile-fav${isFav ? ' on' : ''}`,
      role: 'button',
      tabindex: '0',
      title: isFav ? 'Tirar dos favoritos' : 'Adicionar aos favoritos',
      'aria-label': isFav ? 'Tirar dos favoritos' : 'Adicionar aos favoritos',
      text: isFav ? '★' : '☆',
      onclick: (e) => { e.stopPropagation(); toggleFavorite(report.id); },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFavorite(report.id); }
      },
    }),
  );
}

function section(title, reports) {
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title', text: title }),
    el('div', { class: 'tiles' }, reports.map(tile)),
  );
}

function render() {
  const term = normalize(search.value.trim());
  const nodes = [];

  if (term) {
    const found = [...reportsById.values()].filter((r) =>
      normalize(`${r.name} ${r.description || ''} ${r.folderName}`).includes(term));
    nodes.push(found.length
      ? section(`Resultados para "${search.value.trim()}"`, found)
      : el('div', { class: 'empty', text: 'Nenhum relatório encontrado com essa busca.' }));
  } else if (!reportsById.size) {
    nodes.push(el('div', { class: 'empty' },
      el('h2', { text: 'Nenhum relatório liberado ainda' }),
      el('p', { text: 'Quando o administrador liberar relatórios para você, eles aparecem aqui.' }),
    ));
  } else {
    const favs = [...favorites].map((id) => reportsById.get(id)).filter(Boolean);
    const recent = data.recent.map((id) => reportsById.get(id)).filter(Boolean);
    if (favs.length) nodes.push(section('Favoritos', favs));
    if (recent.length) nodes.push(section('Abertos recentemente', recent));
    for (const folder of data.folders) nodes.push(section(folder.name, folder.reports));
  }
  home.replaceChildren(...nodes);
}

search.addEventListener('input', render);

async function toggleFavorite(id) {
  const on = !favorites.has(id);
  try {
    await api(on ? 'PUT' : 'DELETE', `/api/portal/favorites/${id}`);
    if (on) favorites.add(id); else favorites.delete(id);
    render();
    updateViewerFav();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Visualizador ──────────────────────────────────────────────────────────

function updateViewerFav() {
  const on = favorites.has(openReportId);
  viewer.fav.hidden = user.isSupport;
  viewer.fav.textContent = on ? '★' : '☆';
  viewer.fav.classList.toggle('on', on);
  viewer.fav.title = on ? 'Tirar dos favoritos' : 'Adicionar aos favoritos';
}

async function openViewer(id) {
  openReportId = id;
  viewer.root.hidden = false;
  document.body.style.overflow = 'hidden';
  viewer.title.textContent = reportsById.get(id)?.name || 'Relatório';
  viewer.frame.hidden = true;
  viewer.frame.removeAttribute('src');
  viewer.status.hidden = false;
  viewer.status.textContent = 'Abrindo relatório...';
  updateViewerFav();
  try {
    const report = await api('POST', `/api/portal/reports/${id}/open`, {});
    if (openReportId !== id) return;
    viewer.title.textContent = report.name;
    viewer.frame.src = report.url;
    viewer.frame.hidden = false;
    viewer.status.hidden = true;
  } catch (err) {
    viewer.status.textContent = err.message;
  }
}

function closeViewer() {
  openReportId = null;
  viewer.root.hidden = true;
  viewer.frame.removeAttribute('src');
  document.body.style.overflow = '';
}

function route() {
  const m = /^#\/relatorio\/(\d+)$/.exec(location.hash);
  if (m) openViewer(Number(m[1]));
  else closeViewer();
}

window.addEventListener('hashchange', route);
viewer.back.addEventListener('click', () => { location.hash = ''; });
viewer.fav.addEventListener('click', () => toggleFavorite(openReportId));
viewer.full.addEventListener('click', () => viewer.frame.requestFullscreen?.());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !viewer.root.hidden && !document.fullscreenElement) location.hash = '';
});

load().catch((err) => {
  if (err.status !== 401) home.replaceChildren(el('div', { class: 'alert alert-error', text: err.message }));
});
