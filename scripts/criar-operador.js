// Cria (ou redefine a senha de) um operador da plataforma.
//
//   npm run operador -- --email voce@exemplo.com --nome "Seu Nome"
//   docker compose exec app node scripts/criar-operador.js --email ... --nome ...
//
// A senha vem de OPERADOR_SENHA ou é gerada e mostrada uma única vez.
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { hashPassword, generateTempPassword, passwordProblem } = require('../src/passwords');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = String(arg('email') || '').trim().toLowerCase();
  const name = String(arg('nome') || '').trim();
  if (!email || !name) {
    console.error('Uso: node scripts/criar-operador.js --email <email> --nome "<nome>"');
    process.exit(1);
  }
  const password = process.env.OPERADOR_SENHA || generateTempPassword(16);
  const problem = process.env.OPERADOR_SENHA && passwordProblem(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const db = openDb(loadConfig().dbPath);
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM operators WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE operators SET name = ?, password_hash = ?, active = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(name, hash, existing.id);
    db.prepare("DELETE FROM sessions WHERE operator_id = ?").run(existing.id);
    console.log(`Operador ${email} atualizado (senha redefinida, sessões encerradas).`);
  } else {
    db.prepare('INSERT INTO operators (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, hash);
    console.log(`Operador ${email} criado.`);
  }
  if (!process.env.OPERADOR_SENHA) console.log(`Senha: ${password}  (guarde agora — não é mostrada de novo)`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
