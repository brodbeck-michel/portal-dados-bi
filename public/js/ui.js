// Utilitários compartilhados pelas telas. Todo texto vindo do servidor entra
// no DOM por textContent (via el()), nunca por innerHTML.

export const PRODUCT = 'Portal de Dados BI';

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

function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}

export function setBrandColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
  document.documentElement.style.setProperty('--brand', color);
  document.documentElement.style.setProperty('--on-brand', readableOn(color));
}

// Aplica nome, cor e logo do cliente em [data-brand-name] e [data-brand-logo].
export async function applyBrand() {
  const brand = await api('GET', '/api/branding', undefined, { redirect: false });
  setBrandColor(brand.color);
  document.querySelectorAll('[data-brand-name]').forEach((n) => { n.textContent = brand.name; });
  document.querySelectorAll('[data-brand-logo]').forEach((img) => {
    if (brand.logoUrl) {
      img.src = brand.logoUrl;
      img.alt = brand.name;
      img.hidden = false;
    }
  });
  if (brand.logoUrl) {
    document.head.append(el('link', { rel: 'icon', href: brand.logoUrl }));
  }
  document.title = document.title ? `${document.title} · ${brand.name}` : brand.name;
  return brand;
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
  if (wide) dialog.style.width = 'min(760px, calc(100vw - 32px))';
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
