// Área do operador: cadastro de clientes, marca, administradores e suporte.
import {
  api, el, openDialog, showSecret, field, toast, formatDateTime, dropdown, initials, icon, currentTheme, toggleTheme,
} from './ui.js';

const LOGIN = '/platform/login';
const list = document.getElementById('tenants');
let me;
let tenants = [];

const call = (method, path, body) => api(method, path, body, { loginPath: LOGIN });

async function refresh() {
  tenants = await call('GET', '/api/platform/tenants');
  render();
}

function render() {
  if (!tenants.length) {
    list.replaceChildren(el('div', { class: 'empty', text: 'Nenhum cliente ainda. Use "Novo cliente" para cadastrar o primeiro.' }));
    return;
  }
  const btn = (label, onclick, kind = '') => el('button', { type: 'button', class: `btn-sm ${kind}`, text: label, onclick });
  const rows = tenants.map((t) => {
    const swatch = el('span', { class: 'color-dot' });
    swatch.style.background = t.brandColor;
    return el('tr', {},
      el('td', { class: 'nowrap' },
        t.hasLogo ? el('img', { class: 'tenant-logo', src: `/api/platform/tenants/${t.id}/logo?v=${Date.now()}`, alt: '' }) : swatch,
        el('strong', { text: t.name })),
      el('td', {}, el('a', { href: t.url, target: '_blank', rel: 'noopener', text: t.url.replace(/^https?:\/\//, '') })),
      el('td', { text: String(t.userCount) }),
      el('td', { text: String(t.reportCount) }),
      el('td', { class: 'nowrap', text: formatDateTime(t.lastReportOpenedAt) }),
      el('td', {}, el('span', { class: `badge ${t.active ? 'badge-ok' : 'badge-off'}`, text: t.active ? 'Ativo' : 'Suspenso' })),
      el('td', { class: 'actions' },
        btn('Marca', () => tenantDialog(t)),
        btn('Administradores', () => adminsDialog(t)),
        btn('Entrar como suporte', () => support(t))),
    );
  });
  list.replaceChildren(el('div', { class: 'table-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {}, ['Cliente', 'Endereço', 'Usuários', 'Relatórios', 'Último relatório aberto', 'Status', '']
        .map((h) => el('th', { text: h })))),
      el('tbody', {}, rows))));
}

// Lê a imagem escolhida como data URL (o servidor valida tipo e tamanho).
function readFile(input) {
  const file = input.files?.[0];
  if (!file) return Promise.resolve(null);
  if (file.size > 300 * 1024) return Promise.reject(new Error('A imagem deve ter no máximo 300 KB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

function tenantDialog(t) {
  const isNew = !t;
  const slugInput = el('input', { type: 'text', name: 'slug', id: 'f-slug', maxlength: '40', placeholder: 'ex.: acme' });
  const preview = el('div', { class: 'field-hint' });
  const updatePreview = () => { preview.textContent = `Endereço: ${slugInput.value || '<cliente>'}.${me.baseDomain}`; };
  slugInput.addEventListener('input', () => {
    slugInput.value = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    updatePreview();
  });
  updatePreview();

  const imageInput = (name, id) => el('input', { type: 'file', name, id, accept: 'image/png,image/jpeg,image/webp' });
  const form = el('form', { novalidate: true },
    field('Nome do cliente', el('input', { type: 'text', name: 'name', id: 'f-tname', value: t?.name || '', maxlength: '80' })),
    isNew ? el('div', { class: 'field' }, el('label', { for: 'f-slug', text: 'Endereço (não muda depois)' }), slugInput, preview) : null,
    field('Título do portal (opcional)', el('input', { type: 'text', name: 'portal_title', id: 'f-ptitle', value: t?.portalTitle || '', maxlength: '60', placeholder: 'ex.: Painéis Acme' }),
      'Aparece no login e na aba do navegador. Em branco, usa o nome do cliente.'),
    field('Mensagem do login (opcional)', el('textarea', { name: 'login_message', id: 'f-pmsg', maxlength: '240', placeholder: 'Entre com o acesso enviado pelo administrador.' }, t?.loginMessage || '')),
    el('div', { class: 'row' },
      field('Cor principal', el('input', { type: 'color', name: 'brand_color', id: 'f-color', value: t?.brandColor || '#0f766e' })),
      field('Logo (PNG, JPG ou WEBP, até 300 KB)', imageInput('logo', 'f-logo'))),
    !isNew && t.hasLogo ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'removeLogo' }), 'Remover a logo atual') : null,
    field('Ícone da aba (opcional, quadrado)', imageInput('favicon', 'f-favicon'), 'Em branco, a aba usa a logo; sem logo, a inicial do cliente na cor principal.'),
    !isNew && t.hasFavicon ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'removeFavicon' }), 'Remover o ícone atual') : null,
    !isNew ? el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'active', checked: t.active }), 'Ativo (desmarque para suspender o portal do cliente)') : null,
    isNew ? el('div', {},
      el('h3', { text: 'Primeiro administrador (opcional)' }),
      el('p', { class: 'muted small', text: 'Quem vai cuidar do portal do lado do cliente. Pode deixar em branco e criar depois.' }),
      el('div', { class: 'row' },
        field('Nome', el('input', { type: 'text', name: 'adminName', id: 'f-aname', maxlength: '120' })),
        field('E-mail', el('input', { type: 'email', name: 'adminEmail', id: 'f-aemail' })))) : null,
  );

  openDialog({
    title: isNew ? 'Novo cliente' : `Marca: ${t.name}`,
    body: form,
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Salvar',
        kind: 'primary',
        onClick: async (close) => {
          const logo = await readFile(form.logo);
          const favicon = await readFile(form.favicon);
          const brand = {
            name: form.name.value,
            brand_color: form.brand_color.value,
            portal_title: form.portal_title.value,
            login_message: form.login_message.value,
          };
          if (isNew) {
            const created = await call('POST', '/api/platform/tenants', {
              ...brand, slug: slugInput.value, logo: logo || undefined, favicon: favicon || undefined,
            });
            let secret = null;
            if (form.adminEmail.value.trim()) {
              secret = await call('POST', `/api/platform/tenants/${created.id}/admins`, { name: form.adminName.value, email: form.adminEmail.value })
                .catch((err) => { toast(`Cliente criado, mas o administrador não: ${err.message}`, 'error'); return null; });
            }
            close();
            await refresh();
            if (secret) {
              showSecret('Cliente criado',
                `Envie para ${secret.user.name}: endereço ${created.url}, login ${secret.user.email} e a senha provisória abaixo.`,
                secret.tempPassword);
            } else {
              toast('Cliente criado');
            }
            return;
          }
          await call('PUT', `/api/platform/tenants/${t.id}`, { ...brand, active: form.active.checked });
          if (logo) await call('PUT', `/api/platform/tenants/${t.id}/logo`, { image: logo });
          else if (form.removeLogo?.checked) await call('DELETE', `/api/platform/tenants/${t.id}/logo`);
          if (favicon) await call('PUT', `/api/platform/tenants/${t.id}/favicon`, { image: favicon });
          else if (form.removeFavicon?.checked) await call('DELETE', `/api/platform/tenants/${t.id}/favicon`);
          close();
          toast('Cliente atualizado');
          await refresh();
        },
      },
    ],
  });
}

async function adminsDialog(t) {
  const admins = await call('GET', `/api/platform/tenants/${t.id}/admins`);
  const form = el('form', { novalidate: true },
    el('div', { class: 'row' },
      field('Nome', el('input', { type: 'text', name: 'name', id: 'f-nname', maxlength: '120' })),
      field('E-mail', el('input', { type: 'email', name: 'email', id: 'f-nemail' }))));
  openDialog({
    title: `Administradores: ${t.name}`,
    body: el('div', {},
      admins.length
        ? el('ul', {}, admins.map((a) => el('li', {}, `${a.name} — ${a.email}`, a.active ? '' : ' (inativo)')))
        : el('p', { class: 'muted', text: 'Nenhum administrador ainda.' }),
      el('h3', { text: 'Adicionar administrador' }),
      el('p', { class: 'muted small', text: 'Para trocar senha ou desativar um administrador existente, entre como suporte e use a aba Usuários.' }),
      form),
    actions: [
      { label: 'Fechar' },
      {
        label: 'Criar administrador',
        kind: 'primary',
        onClick: async (close) => {
          const result = await call('POST', `/api/platform/tenants/${t.id}/admins`, { name: form.name.value, email: form.email.value });
          close();
          await refresh();
          showSecret('Administrador criado',
            `Envie para ${result.user.name}: endereço ${t.url}, login ${result.user.email} e a senha provisória abaixo.`,
            result.tempPassword);
        },
      },
    ],
  });
}

// Abre a aba antes do await: navegador bloqueia window.open fora do clique.
async function support(t) {
  const tab = window.open('about:blank', '_blank');
  try {
    const { url } = await call('POST', `/api/platform/tenants/${t.id}/support`, {});
    if (tab) tab.location.href = url;
    else location.href = url;
  } catch (err) {
    tab?.close();
    toast(err.message, 'error');
  }
}

async function start() {
  me = await call('GET', '/api/platform/me');
  const trigger = el('button', { type: 'button', class: 'btn-ghost user-chip', 'aria-label': 'Menu do operador' },
    el('span', { class: 'avatar', text: initials(me.name) }), el('span', { class: 'user-name', text: me.name }));
  const themeContent = () => (currentTheme() === 'dark' ? [icon('sun'), 'Tema claro'] : [icon('moon'), 'Tema escuro']);
  const themeItem = el('button', { type: 'button' }, themeContent());
  themeItem.addEventListener('click', () => { toggleTheme(); themeItem.replaceChildren(...themeContent()); });
  document.getElementById('operator-menu').replaceChildren(dropdown(trigger, [
    el('div', { class: 'menu-head', text: me.email }),
    el('div', { class: 'menu-sep' }),
    themeItem,
    el('div', { class: 'menu-sep' }),
    el('button', {
      type: 'button',
      text: 'Sair',
      onclick: async () => {
        await api('POST', '/api/platform/logout', {}, { redirect: false }).catch(() => {});
        location.href = LOGIN;
      },
    }),
  ]));
  document.getElementById('new-tenant').addEventListener('click', () => tenantDialog(null));
  await refresh();
}

start().catch((err) => {
  if (err.status !== 401) list.replaceChildren(el('div', { class: 'alert alert-error', text: err.message }));
});
