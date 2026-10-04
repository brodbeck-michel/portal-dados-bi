const { nowIso } = require('./db');
const { text, bool, ensureValid, notFound, conflict, badRequest } = require('./http');

// Subdomínio do cliente: minúsculas, números e hífen.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['www', 'api', 'admin', 'app', 'platform', 'plataforma', 'mail', 'static', 'suporte']);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const COLUMNS = `id, slug, name, brand_color, portal_title, login_message, active, created_at, updated_at,
  (logo_data IS NOT NULL) AS has_logo, (favicon_data IS NOT NULL) AS has_favicon`;

function findBySlug(db, slug) {
  return db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE slug = ?`).get(slug) ?? null;
}

function get(db, id) {
  const t = db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE id = ?`).get(id);
  if (!t) throw notFound('Cliente não encontrado');
  return t;
}

function list(db) {
  return db.prepare(`
    SELECT ${COLUMNS},
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM reports r WHERE r.tenant_id = t.id) AS report_count,
      (SELECT MAX(created_at) FROM audit_log a WHERE a.tenant_id = t.id AND a.event = 'report.opened') AS last_report_opened_at
    FROM tenants t ORDER BY name
  `).all();
}

function validateBrand(body, errors, { partial }) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = text(body.name, 'name', 'Nome', errors, { max: 80 });
  if (body.brand_color !== undefined || !partial) {
    const color = typeof body.brand_color === 'string' ? body.brand_color.trim() : '#0f766e';
    if (!COLOR_RE.test(color)) errors.push({ field: 'brand_color', message: 'Cor inválida (use o formato #RRGGBB)' });
    out.brand_color = color.toLowerCase();
  }
  // Textos do white label: vazio volta ao padrão (título = nome do cliente).
  if (!partial || body.portal_title !== undefined) {
    out.portal_title = text(body.portal_title, 'portal_title', 'Título do portal', errors, { required: false, max: 60 });
  }
  if (!partial || body.login_message !== undefined) {
    out.login_message = text(body.login_message, 'login_message', 'Mensagem do login', errors, { required: false, max: 240 });
  }
  return out;
}

function create(db, body) {
  const errors = [];
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    errors.push({ field: 'slug', message: 'Endereço inválido: use letras minúsculas, números e hífen' });
  } else if (RESERVED_SLUGS.has(slug)) {
    errors.push({ field: 'slug', message: 'Este endereço é reservado' });
  }
  const brand = validateBrand(body, errors, { partial: false });
  ensureValid(errors);
  if (findBySlug(db, slug)) throw conflict('Já existe um cliente com este endereço');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tenants (slug, name, brand_color, portal_title, login_message) VALUES (?, ?, ?, ?, ?)
  `).run(slug, brand.name, brand.brand_color, brand.portal_title, brand.login_message);
  return get(db, Number(lastInsertRowid));
}

// O endereço (slug) não muda depois de criado: ele é a URL que o cliente usa.
function update(db, id, body) {
  const current = get(db, id);
  const errors = [];
  const brand = validateBrand(body, errors, { partial: true });
  ensureValid(errors);
  const keep = (field) => (field in brand ? brand[field] : current[field]);
  db.prepare(`
    UPDATE tenants SET name = ?, brand_color = ?, portal_title = ?, login_message = ?, active = ?, updated_at = ? WHERE id = ?
  `).run(
    keep('name'),
    keep('brand_color'),
    keep('portal_title'),
    keep('login_message'),
    bool(body.active, !!current.active) ? 1 : 0,
    nowIso(),
    id,
  );
  return get(db, id);
}

// Logo e ícone da aba chegam como data URL. SVG fica de fora de propósito:
// pode carregar script e seria servido na mesma origem do portal.
const IMAGE_MAX_BYTES = 300 * 1024;
const IMAGE_TYPES = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
// Nomes de coluna fixos: o `kind` nunca vem direto do usuário para o SQL.
const IMAGE_COLUMNS = { logo: ['logo_mime', 'logo_data'], favicon: ['favicon_mime', 'favicon_data'] };

function columnsOf(kind) {
  const cols = IMAGE_COLUMNS[kind];
  if (!cols) throw new Error(`imagem desconhecida: ${kind}`);
  return cols;
}

function setImage(db, id, kind, dataUrl) {
  const [mimeCol, dataCol] = columnsOf(kind);
  get(db, id);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw badRequest('Envie uma imagem PNG, JPG ou WEBP');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > IMAGE_MAX_BYTES) throw badRequest('A imagem deve ter no máximo 300 KB');
  if (!IMAGE_TYPES[m[1]](bytes)) throw badRequest('O arquivo não é uma imagem válida');
  db.prepare(`UPDATE tenants SET ${mimeCol} = ?, ${dataCol} = ?, updated_at = ? WHERE id = ?`).run(m[1], bytes, nowIso(), id);
  return get(db, id);
}

function clearImage(db, id, kind) {
  const [mimeCol, dataCol] = columnsOf(kind);
  get(db, id);
  db.prepare(`UPDATE tenants SET ${mimeCol} = NULL, ${dataCol} = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return get(db, id);
}

// { mime, data } ou null.
function getImage(db, id, kind) {
  const [mimeCol, dataCol] = columnsOf(kind);
  const row = db.prepare(`SELECT ${mimeCol} AS mime, ${dataCol} AS data FROM tenants WHERE id = ? AND ${dataCol} IS NOT NULL`).get(id);
  return row ?? null;
}

const IMAGE_KINDS = Object.keys(IMAGE_COLUMNS);

module.exports = { findBySlug, get, list, create, update, setImage, clearImage, getImage, IMAGE_KINDS };
