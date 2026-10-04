// Roda antes do CSS pintar (script normal no <head>, não módulo), para a
// página não piscar no tema errado. Escolha salva vence a do sistema.
(function () {
  var tema;
  try { tema = localStorage.getItem('tema'); } catch (e) { /* navegação privada */ }
  if (tema !== 'dark' && tema !== 'light') {
    tema = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', tema);
}());
