// Assinatura do relatório: minigráfico abstrato (barras, linha ou área)
// gerado do id e pintado na cor do cliente. Sem eixos nem números, para não
// parecer dado real. Semente = id do relatório, nunca o nome (renomear não
// muda o desenho). Porte do protótipo do design (seedOf/rng/sig).
const NS = 'http://www.w3.org/2000/svg';
const W = 200;
const H = 70;
const cache = new Map();

function seedOf(text) {
  let x = 2166136261;
  for (const c of text) {
    x ^= c.charCodeAt(0);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

// mulberry32
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function node(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function draw(id) {
  const seed = seedOf(String(id));
  const r = rng(seed);
  const type = seed % 3; // 0 barras, 1 linha, 2 área
  const n = type === 0 ? 12 : 16;
  let v = 0.25 + r() * 0.3;
  const trend = (r() - 0.4) * 0.05;
  const vals = [];
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * 0.32 + trend;
    v = Math.max(0.12, Math.min(0.98, v));
    vals.push(v);
  }

  const svg = node('svg', { class: 'signature', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (type === 0) {
    const bw = W / n;
    vals.forEach((val, i) => svg.append(node('rect', {
      class: i === n - 1 ? 'sig-bar-last' : 'sig-bar',
      x: (i * bw + bw * 0.16).toFixed(1),
      width: (bw * 0.68).toFixed(1),
      y: (H - val * H).toFixed(1),
      height: (val * H).toFixed(1),
      rx: 2,
    })));
    return svg;
  }
  const d = vals
    .map((val, i) => `${i ? 'L' : 'M'}${((i * W) / (n - 1)).toFixed(1)} ${(H - 3 - val * (H - 8)).toFixed(1)}`)
    .join(' ');
  if (type === 2) svg.append(node('path', { class: 'sig-area', d: `${d} L${W} ${H} L0 ${H} Z` }));
  svg.append(node('path', { class: 'sig-line', d, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

export function signature(id) {
  if (!cache.has(id)) cache.set(id, draw(id));
  return cache.get(id).cloneNode(true);
}
