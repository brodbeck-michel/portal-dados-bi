-- Portal de Dados BI — schema inicial.
-- Datas sempre em ISO 8601 UTC ('2026-10-03T12:00:00.000Z'), o mesmo formato
-- de Date#toISOString, para que comparações em texto funcionem.
--
-- Isolamento entre clientes: toda tabela de dado de cliente carrega tenant_id,
-- e todo acesso em src/*.js filtra por ele. As FKs não garantem que a pasta de
-- um relatório seja do mesmo cliente — isso é checado no código (reports.js).

CREATE TABLE tenants (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#0f766e',
  logo_mime   TEXT,
  logo_data   BLOB,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Operador da plataforma: cadastra clientes e dá suporte. Nasce por script
-- (scripts/criar-operador.js), nunca por tela.
CREATE TABLE operators (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email                TEXT NOT NULL COLLATE NOCASE,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active               INTEGER NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, email)
);

CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL COLLATE NOCASE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, name)
);

CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  folder_id   INTEGER NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  url         TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX reports_tenant ON reports (tenant_id, folder_id);

-- Permissão: usuário × relatório. É o único mecanismo de acesso para o papel
-- 'user'; 'admin' enxerga todos os relatórios ativos do cliente.
CREATE TABLE report_access (
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (report_id, user_id)
);
CREATE INDEX report_access_user ON report_access (user_id);

CREATE TABLE favorites (
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, report_id)
);

-- Registro de acessos e alterações. actor_label e target guardam o nome no
-- momento do evento: o registro continua legível depois que o usuário ou o
-- relatório é excluído. tenant_id NULL = evento da plataforma.
CREATE TABLE audit_log (
  id                INTEGER PRIMARY KEY,
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id     INTEGER,
  actor_operator_id INTEGER,
  actor_label       TEXT,
  event             TEXT NOT NULL,
  report_id         INTEGER,
  target            TEXT,
  detail            TEXT,
  ip                TEXT,
  user_agent        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX audit_tenant_time ON audit_log (tenant_id, created_at);
CREATE INDEX audit_recent ON audit_log (tenant_id, actor_user_id, event, created_at);

-- Sessões: o cookie leva um token aleatório; aqui fica só o hash dele.
-- scope 'tenant' vale num único cliente (user_id, ou operator_id quando é
-- sessão de suporte); scope 'platform' é a área do operador.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('tenant', 'platform')),
  tenant_id    INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  operator_id  INTEGER REFERENCES operators(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT
);

-- Passagem de bastão do operador para a sessão de suporte num cliente:
-- token de uso único, válido por 60 segundos.
CREATE TABLE support_handoffs (
  token_hash  TEXT PRIMARY KEY,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
