// Menu do usuário no topo (portal e admin).
import { api, el, dropdown, initials } from './ui.js';

export function renderUserMenu(container, user, { current }) {
  const items = [
    el('div', { class: 'muted small menu-head', text: user.email }),
    el('div', { class: 'menu-sep' }),
  ];
  if (current !== 'portal') items.push(el('a', { href: '/', text: 'Ir para o portal' }));
  if (user.role === 'admin' && current !== 'admin') items.push(el('a', { href: '/admin', text: 'Administração' }));
  if (!user.isSupport) items.push(el('a', { href: '/trocar-senha', text: 'Trocar senha' }));
  items.push(el('div', { class: 'menu-sep' }));
  items.push(el('button', {
    type: 'button',
    text: user.isSupport ? 'Encerrar suporte' : 'Sair',
    onclick: async () => {
      await api('POST', '/api/auth/logout', {}, { redirect: false }).catch(() => {});
      location.href = '/login';
    },
  }));

  const trigger = el('button', { type: 'button', class: 'btn-ghost user-chip', 'aria-label': 'Menu do usuário' },
    el('span', { class: 'avatar', text: initials(user.name) }),
    el('span', { class: 'user-name', text: user.name }),
    '▾',
  );
  container.replaceChildren(dropdown(trigger, items));
}
