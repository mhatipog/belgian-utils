function hashSeed(seed) {
  const s = String(seed ?? '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function seededRandom(seed) {
  let a = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function rng(seed, random) {
  if (typeof random === 'function') return random;
  if (seed !== undefined && seed !== null && String(seed) !== '') return seededRandom(seed);
  if (globalThis.crypto?.getRandomValues) return () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 4294967296; };
  return Math.random;
}

function sizeOk(n, N) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Sample size must be a positive integer.');
  if (n > N) throw new RangeError(`Sample size ${n} exceeds population ${N}.`);
}

function shuffleIndexes(N, random) {
  const a = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function simpleRandomSample(rows, n, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  sizeOk(n, rows.length);
  const r = rng(options.seed, options.random);
  const indexes = shuffleIndexes(rows.length, r).slice(0, n).sort((a, b) => a - b);
  return { rows: indexes.map((i) => rows[i]), indexes, method: 'simple', seed: options.seed ?? null };
}

export function systematicSample(rows, n, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  sizeOk(n, rows.length);
  const N = rows.length, step = N / n, r = rng(options.seed, options.random);
  const start = r() * step;
  const indexes = Array.from({ length: n }, (_, i) => Math.min(N - 1, Math.floor(start + i * step)));
  return { rows: indexes.map((i) => rows[i]), indexes, method: 'systematic', interval: step, start, seed: options.seed ?? null };
}

function proportionalAllocation(groups, n) {
  const N = groups.reduce((s, g) => s + g.indexes.length, 0);
  const raw = groups.map((g) => g.indexes.length * n / N);
  const out = raw.map((x, i) => Math.min(groups[i].indexes.length, Math.floor(x)));
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) if (left && out[i] < groups[i].indexes.length) { out[i]++; left--; }
  return out;
}

function equalAllocation(groups, n) {
  const out = Array(groups.length).fill(0);
  let left = n;
  while (left) {
    let changed = false;
    for (let i = 0; i < groups.length && left; i++) {
      if (out[i] < groups[i].indexes.length) { out[i]++; left--; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

export function stratifiedSample(rows, n, stratum, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  sizeOk(n, rows.length);
  const key = typeof stratum === 'function' ? stratum : (row) => row?.[stratum];
  const map = new Map();
  rows.forEach((row, i) => { const k = String(key(row) ?? ''); if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
  const groups = [...map].map(([name, indexes]) => ({ name, indexes }));
  const allocation = options.allocation === 'equal' ? equalAllocation(groups, n) : proportionalAllocation(groups, n);
  const r = rng(options.seed, options.random), picked = [], strata = [];
  groups.forEach((g, i) => {
    const count = allocation[i];
    const local = shuffleIndexes(g.indexes.length, r).slice(0, count).map((j) => g.indexes[j]);
    picked.push(...local);
    strata.push({ stratum: g.name, population: g.indexes.length, sample: count });
  });
  picked.sort((a, b) => a - b);
  return { rows: picked.map((i) => rows[i]), indexes: picked, method: 'stratified', allocation: options.allocation === 'equal' ? 'equal' : 'proportional', strata, seed: options.seed ?? null };
}

function invNorm(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('Probability must be between 0 and 1.');
  const a = [-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
  const b = [-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
  const c = [-0.00778489400243029,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
  const d = [0.00778469570904146,0.32246712907004,2.445134137143,3.75440866190742];
  const pl = .02425, ph = 1 - pl;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2*Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > ph) { q = Math.sqrt(-2*Math.log(1-p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q = p-.5; r=q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

export function sampleSizeForProportion({ population = Infinity, confidence = .95, margin = .05, proportion = .5 } = {}) {
  if (Number.isFinite(population) && (!(population > 0) || !Number.isInteger(population))) throw new RangeError('population must be a positive integer or Infinity');
  if (!(confidence > 0 && confidence < 1)) throw new RangeError('confidence must be between 0 and 1');
  if (!(margin > 0 && margin < 1)) throw new RangeError('margin must be between 0 and 1');
  if (!(proportion > 0 && proportion < 1)) throw new RangeError('proportion must be between 0 and 1');
  const z = invNorm(.5 + confidence / 2);
  const n0 = z*z*proportion*(1-proportion)/(margin*margin);
  const n = Number.isFinite(population) ? n0 / (1 + (n0 - 1) / population) : n0;
  return Math.ceil(n);
}
