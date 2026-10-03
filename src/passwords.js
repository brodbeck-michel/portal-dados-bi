const crypto = require('node:crypto');

// scrypt nativo do Node: sem dependência e resistente a força bruta.
// Formato guardado: scrypt$N$r$p$salt$hash (base64) — os parâmetros viajam
// junto, então dá para endurecer o custo depois sem invalidar senhas antigas.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Hash fixo para comparar quando o e-mail não existe: o tempo de resposta não
// revela se a conta existe.
let dummyHash;
async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('senha-que-nunca-confere');
  await verifyPassword(password, dummyHash);
  return false;
}

// Senha provisória legível ao telefone: sem 0/O, 1/l/I.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateTempPassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const MIN_LENGTH = 10;
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_LENGTH} caracteres`;
  }
  if (password.length > 200) return 'A senha deve ter no máximo 200 caracteres';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'A senha deve ter letras e números';
  return null;
}

module.exports = { hashPassword, verifyPassword, verifyAgainstDummy, generateTempPassword, passwordProblem };
