const http = require('node:http');
const { loadConfig } = require('./src/config');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const { deleteExpiredSessions } = require('./src/sessions');

const config = loadConfig();
const db = openDb(config.dbPath);
const server = http.createServer(createApp({ db, config }));

const cleanup = setInterval(() => deleteExpiredSessions(db), 3600e3);
cleanup.unref();

server.listen(config.port, () => {
  console.log(`Portal de Dados BI na porta ${config.port} — plataforma em ${config.baseDomain}, clientes em <cliente>.${config.baseDomain}`);
});

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10e3).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
