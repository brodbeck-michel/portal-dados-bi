// Utilitários compartilhados pelas telas. Todo texto vindo do servidor entra
// no DOM por textContent (via el()), nunca por innerHTML.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || [];
  }
}

// Chamada à API. Sessão expirada leva ao login (loginPath); senha provisória
// pendente leva à troca de senha.
export async function api(method, path, body, { loginPath = '/login', redirect = true } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (res.ok) return data;
  const err = new ApiError(res.status, data?.error || `Erro ${res.status}`, data?.details);
  if (redirect && res.status === 401) {
    location.href = loginPath;
    throw err;
  }
  if (redirect && res.status === 403 && err.details.some((d) => d.message === 'password_change_required')) {
    location.href = '/trocar-senha';
    throw err;
  }
  throw err;
}

// ── Marca do cliente ──────────────────────────────────────────────────────

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Marca clara (amarelo): texto escuro sobre ela e links escurecidos.
export function setBrandColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
  const light = luminance(color) > 0.4;
  const root = document.documentElement.style;
  root.setProperty('--brand', color);
  root.setProperty('--on-brand', light ? '#16181D' : '#FFFFFF');
  root.setProperty('--brand-text-mix', light ? '55%' : '100%');
}

// Sem favicon nem logo, a aba ganha a inicial do cliente na cor da marca.
function initialFavicon(name, color) {
  const letter = (String(name || '?').trim()[0] || '?').toUpperCase();
  const fg = luminance(color) > 0.4 ? '#16181D' : '#FFFFFF';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>`
    + `<text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="600" fill="${fg}">${letter.replace(/[<>&"]/g, '')}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Cor, título da aba e favicon do cliente. Devolve a marca para a tela montar
// o resto (logo, título, mensagem).
export async function applyBrand() {
  const brand = await api('GET', '/api/branding', undefined, { redirect: false });
  setBrandColor(brand.color);
  document.head.querySelectorAll('link[rel=icon]').forEach((n) => n.remove());
  document.head.append(el('link', { rel: 'icon', href: brand.faviconUrl || initialFavicon(brand.name, brand.color) }));
  setPageTitle(document.title, brand);
  return brand;
}

// "Seção · Título do portal". Sem seção, só o título.
export function setPageTitle(section, brand) {
  document.title = section ? `${section} · ${brand.title}` : brand.title;
}

// Logo (sobre placa branca) ou inicial num quadrado, para o login.
export function brandMark(brand) {
  if (brand.logoUrl) {
    return el('div', { class: 'auth-brand-mark' },
      el('span', { class: 'brand-logo-plate' }, el('img', { src: brand.logoUrl, alt: brand.name })));
  }
  return el('div', { class: 'auth-brand-mark' },
    el('span', { class: 'brand-chip', 'aria-hidden': 'true', text: initials(brand.name).slice(0, 1) }),
    el('span', { text: brand.name }));
}

// Preenche o lado da marca das telas de login: [data-brand-mark],
// [data-brand-title], [data-brand-message] e [data-brand-foot].
export function fillAuthBrand(brand, { message } = {}) {
  document.querySelector('[data-brand-mark]')?.replaceChildren(brandMark(brand));
  document.querySelectorAll('[data-brand-title]').forEach((n) => { n.textContent = brand.title; });
  document.querySelectorAll('[data-brand-message]').forEach((n) => {
    n.textContent = message || brand.message || 'Entre com o acesso enviado pelo administrador.';
  });
  document.querySelectorAll('[data-brand-foot]').forEach((n) => { n.textContent = `© ${new Date().getFullYear()} ${brand.name}`; });
}

// ── Ícones (Lucide, desenhados inline: a CSP não deixa usar fonte por CDN) ──

const ICONS = {
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
};

// Os desenhos são constantes deste arquivo, nunca texto do servidor.
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

// ── Tema claro/escuro (o valor inicial vem de js/theme-init.js) ────────────

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('tema', next); } catch { /* navegação privada */ }
  return next;
}

// ── Avisos e diálogos ─────────────────────────────────────────────────────

export function toast(message, kind = 'info') {
  let area = document.querySelector('.toast-area');
  if (!area) {
    area = el('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    document.body.append(area);
  }
  const t = el('div', { class: `toast${kind === 'error' ? ' toast-error' : ''}`, text: message });
  area.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

// Abre um <dialog>. actions: [{ label, kind: 'primary'|'danger'|undefined, onClick(close) }]
// onClick pode ser async; se lançar ApiError, a mensagem aparece no diálogo.
export function openDialog({ title, body, actions = [], wide = false }) {
  const errorBox = el('div', { class: 'alert alert-error', hidden: true });
  const dialog = el('dialog');
  if (wide) dialog.classList.add('is-wide');
  const close = () => { dialog.close(); dialog.remove(); };
  const buttons = actions.map((a) => {
    const btn = el('button', {
      type: 'button',
      class: a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : '',
      text: a.label,
    });
    btn.addEventListener('click', async () => {
      if (!a.onClick) return close();
      errorBox.hidden = true;
      buttons.forEach((b) => { b.disabled = true; });
      try {
        await a.onClick(close);
      } catch (err) {
        showFormError(dialog, errorBox, err);
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
      }
    });
    return btn;
  });
  dialog.append(el('div', { class: 'dlg' },
    el('div', { class: 'dlg-head' }, el('h2', { text: title })),
    el('div', { class: 'dlg-body' }, errorBox, body),
    buttons.length ? el('div', { class: 'dlg-foot' }, buttons) : null,
  ));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // Enter num campo de texto aciona a ação principal.
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]):not([type=file])')) {
      e.preventDefault();
      const primary = buttons.find((b) => b.classList.contains('btn-primary'));
      primary?.click();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return { dialog, close };
}

export function confirmDialog(title, message, { confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    const { dialog } = openDialog({
      title,
      body: el('p', { text: message }),
      actions: [
        { label: 'Cancelar', onClick: (close) => { resolve(false); close(); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (close) => { resolve(true); close(); } },
      ],
    });
    dialog.addEventListener('close', () => resolve(false));
  });
}

// Mostra uma senha provisória uma única vez, com botão de copiar.
export function showSecret(title, intro, secret) {
  const code = el('div', { class: 'secret', text: secret });
  openDialog({
    title,
    body: el('div', {},
      el('p', { text: intro }),
      code,
      el('p', { class: 'muted small', text: 'Esta senha não será mostrada de novo. A pessoa vai trocá-la no primeiro acesso.' }),
    ),
    actions: [
      {
        label: 'Copiar',
        onClick: async () => {
          await navigator.clipboard.writeText(secret);
          toast('Senha copiada');
        },
      },
      { label: 'Fechar', kind: 'primary' },
    ],
  });
}

// Erros de validação: marca o campo [name=...] e mostra a mensagem geral.
export function showFormError(container, errorBox, err) {
  container.querySelectorAll('.field-error').forEach((n) => n.remove());
  errorBox.textContent = err.message || 'Algo deu errado';
  errorBox.hidden = false;
  for (const d of err.details || []) {
    const input = container.querySelector(`[name="${CSS.escape(d.field)}"]`);
    if (input) input.closest('.field')?.append(el('div', { class: 'field-error', text: d.message }));
  }
}

// Campo de formulário com rótulo.
export function field(label, input, hint) {
  return el('div', { class: 'field' },
    el('label', { text: label, for: input.id || undefined }),
    input,
    hint ? el('div', { class: 'field-hint', text: hint }) : null,
  );
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Quando a pessoa abriu: "agora", "há 12 min", "há 2 h", "ontem", "segunda", "28/09".
export function timeAgo(iso, now = new Date()) {
  const then = new Date(iso);
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86400e3);
  if (days === 0) return `há ${Math.floor(min / 60)} h`;
  if (days === 1) return 'ontem';
  if (days < 7) return then.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira$/, '');
  return then.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// Busca sem acento e sem diferença de maiúsculas.
export function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Menu suspenso simples: botão que abre/fecha uma lista.
export function dropdown(trigger, items) {
  const list = el('div', { class: 'menu-list', hidden: true, role: 'menu' }, items);
  const wrap = el('div', { class: 'menu' }, trigger, list);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  document.addEventListener('click', () => { list.hidden = true; });
  return wrap;
}
