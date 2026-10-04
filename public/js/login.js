// Login do cliente (data-mode="tenant") e do operador (data-mode="platform").
import { api, applyBrand, fillAuthBrand, showFormError } from './ui.js';

const platform = document.body.dataset.mode === 'platform';
const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');

if (!platform) {
  applyBrand().then((brand) => fillAuthBrand(brand)).catch(() => {});
  const forgot = document.getElementById('forgot');
  forgot.addEventListener('click', () => {
    document.getElementById('forgot-info').hidden = false;
    forgot.hidden = true;
  });
  if (new URLSearchParams(location.search).get('suporte') === 'expirado') {
    errorBox.textContent = 'O link de suporte expirou ou já foi usado. Gere outro na área do operador.';
    errorBox.hidden = false;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  errorBox.hidden = true;
  try {
    const body = { email: form.email.value, password: form.password.value };
    if (platform) {
      await api('POST', '/api/platform/login', body, { redirect: false });
      location.href = '/platform';
      return;
    }
    const result = await api('POST', '/api/auth/login', body, { redirect: false });
    location.href = result.mustChangePassword ? '/trocar-senha' : '/';
  } catch (err) {
    showFormError(form, errorBox, err);
    form.password.value = '';
    form.password.focus();
  } finally {
    button.disabled = false;
  }
});
