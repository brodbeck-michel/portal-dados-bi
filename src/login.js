const { nowIso } = require('./db');
const { HttpError } = require('./http');
const { verifyPassword, verifyAgainstDummy } = require('./passwords');

const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

// Confere a senha de uma conta (tabela `users` ou `operators`) e mantém o
// contador de falhas: 5 erros seguidos travam a conta por 15 minutos.
// Devolve 'ok' | 'invalid' | 'locked' | 'locked_now' | 'inactive'.
async function checkCredentials(db, table, account, password) {
  if (table !== 'users' && table !== 'operators') throw new Error(`tabela inválida: ${table}`);
  if (!account) {
    await verifyAgainstDummy(password);
    return 'invalid';
  }
  if (account.locked_until && account.locked_until > nowIso()) return 'locked';

  if (!(await verifyPassword(password, account.password_hash))) {
    const failures = account.failed_attempts + 1;
    const lockNow = failures >= LOCK_AFTER_FAILURES;
    db.prepare(`UPDATE ${table} SET failed_attempts = ?, locked_until = ? WHERE id = ?`).run(
      lockNow ? 0 : failures,
      lockNow ? new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString() : null,
      account.id,
    );
    return lockNow ? 'locked_now' : 'invalid';
  }
  if (!account.active) return 'inactive';

  db.prepare(`UPDATE ${table} SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`)
    .run(nowIso(), account.id);
  return 'ok';
}

function credentialError(result) {
  if (result === 'locked' || result === 'locked_now') {
    return new HttpError(429, `Muitas tentativas sem sucesso. Tente de novo em ${LOCK_MINUTES} minutos.`);
  }
  if (result === 'inactive') return new HttpError(403, 'Seu acesso está desativado. Fale com o administrador.');
  return new HttpError(401, 'E-mail ou senha incorretos');
}

// Limite por IP, em memória: segura tentativa em massa contra muitas contas,
// que o bloqueio por conta não pega. Zera ao reiniciar o processo — aceitável.
const WINDOW_MS = 15 * 60e3;
const MAX_PER_WINDOW = 30;
const attemptsByIp = new Map();

function checkIpRateLimit(ip) {
  const now = Date.now();
  if (attemptsByIp.size > 10_000) {
    for (const [key, v] of attemptsByIp) if (v.resetAt <= now) attemptsByIp.delete(key);
  }
  let entry = attemptsByIp.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    attemptsByIp.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) {
    throw new HttpError(429, 'Muitas tentativas a partir desta rede. Aguarde alguns minutos.');
  }
}

module.exports = { checkCredentials, credentialError, checkIpRateLimit, LOCK_AFTER_FAILURES };
