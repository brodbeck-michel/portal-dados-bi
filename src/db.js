const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Migrações numeradas (001-*.sql, 002-*.sql...), aplicadas em ordem e
// registradas em PRAGMA user_version. Nunca editar um arquivo já aplicado em
// produção: criar o próximo número.
function migrate(db) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}-.+\.sql$/.test(f)).sort();
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = current; i < files.length; i++) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, files[i]), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const nowIso = () => new Date().toISOString();

module.exports = { openDb, transaction, nowIso };
