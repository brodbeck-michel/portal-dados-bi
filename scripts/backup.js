// Cópia consistente do banco (VACUUM INTO funciona com o app rodando) e
// limpeza das cópias com mais de BACKUP_DIAS dias (padrão 14).
//
//   docker compose exec -T app node scripts/backup.js
//
// Destino: BACKUP_DIR (padrão data/backups, que fica no bind mount ./data).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadConfig } = require('../src/config');

const config = loadConfig();
const dir = process.env.BACKUP_DIR || path.join(path.dirname(config.dbPath), 'backups');
const keepDays = Number(process.env.BACKUP_DIAS || 14);

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(dir, `portal-${stamp}.sqlite`);

const db = new DatabaseSync(config.dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup: ${target}`);

const cutoff = Date.now() - keepDays * 86400e3;
for (const f of fs.readdirSync(dir)) {
  const full = path.join(dir, f);
  if (/^portal-.*\.sqlite$/.test(f) && fs.statSync(full).mtimeMs < cutoff) {
    fs.unlinkSync(full);
    console.log(`Removido (>${keepDays} dias): ${f}`);
  }
}
