import { api, applyBrand, fillAuthBrand, showFormError } from './ui.js';

const form = document.getElementById('password-form');
const errorBox = document.getElementById('password-error');

applyBrand().then((brand) => fillAuthBrand(brand)).catch(() => {});

const { user } = await api('GET', '/api/me');
if (user.isSupport) location.href = '/#/admin/relatorios';
if (user.mustChangePassword) {
  document.getElementById('password-intro').textContent =
    'Você entrou com uma senha provisória. Escolha uma senha sua para continuar.';
  document.getElementById('password-cancel').hidden = true;
}

document.getElementById('password-logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('POST', '/api/auth/logout', {}, { redirect: false }).catch(() => {});
  location.href = '/login';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  if (form.newPassword.value !== form.confirmPassword.value) {
    showFormError(form, errorBox, {
      message: 'As duas senhas novas não são iguais',
      details: [{ field: 'confirmPassword', message: 'Repita exatamente a nova senha' }],
    });
    return;
  }
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('POST', '/api/auth/change-password', {
      currentPassword: form.currentPassword.value,
      newPassword: form.newPassword.value,
    });
    location.href = '/';
  } catch (err) {
    showFormError(form, errorBox, err);
  } finally {
    button.disabled = false;
  }
});
