const EPS = 1e-12;

function finite(v, label) {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) throw new TypeError(`${label} is required`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${label} must be a finite number`);
  return n;
}

function validate(alternatives, criteria) {
  if (!Array.isArray(alternatives) || alternatives.length < 2) throw new Error('Add at least two alternatives.');
  if (!Array.isArray(criteria) || !criteria.length) throw new Error('Add at least one criterion.');
  const seen = new Set();
  const names = alternatives.map((a, i) => {
    const name = String(a.name ?? '').trim() || `Option ${i + 1}`;
    if (seen.has(name)) throw new Error(`Alternative names must be unique (${name}).`);
    seen.add(name);
    return name;
  });
  const criterionNames = new Set();
  const cs = criteria.map((c, j) => {
    const name = String(c.name ?? '').trim() || `Criterion ${j + 1}`;
    if (criterionNames.has(name)) throw new Error(`Criterion names must be unique (${name}).`);
    criterionNames.add(name);
    const weight = finite(c.weight ?? 1, `${name} weight`);
    if (weight < 0) throw new RangeError(`${name} weight cannot be negative.`);
    const direction = c.direction === 'min' ? 'min' : 'max';
    const values = alternatives.map((a, i) => finite(a.values?.[j], `${names[i]} / ${name}`));
    return { name, weight, direction, values };
  });
  if (cs.every((c) => c.weight <= EPS)) throw new Error('At least one criterion needs a positive weight.');
  return { names, criteria: cs };
}

export function normalizeDecisionMatrix(alternatives, criteria) {
  const v = validate(alternatives, criteria);
  const normalized = v.criteria.map((c) => {
    const lo = Math.min(...c.values), hi = Math.max(...c.values), span = hi - lo;
    return c.values.map((x) => span <= EPS ? 1 : c.direction === 'min' ? (hi - x) / span : (x - lo) / span);
  });
  return { ...v, normalized };
}

function weights(cs) {
  const total = cs.reduce((s, c) => s + c.weight, 0);
  return cs.map((c) => c.weight / total);
}

function scoreWithWeights(names, normalized, ws) {
  return names.map((name, i) => ({
    name,
    index: i,
    score: normalized.reduce((s, col, j) => s + col[i] * ws[j], 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
}

export function scoreDecisionMatrix(alternatives, criteria) {
  const m = normalizeDecisionMatrix(alternatives, criteria);
  return { ...m, weights: weights(m.criteria), ranking: scoreWithWeights(m.names, m.normalized, weights(m.criteria)) };
}

export function dominatedAlternatives(alternatives, criteria) {
  const m = normalizeDecisionMatrix(alternatives, criteria);
  const out = [];
  for (let i = 0; i < m.names.length; i++) {
    const by = [];
    for (let k = 0; k < m.names.length; k++) {
      if (k === i) continue;
      let all = true, strict = false;
      for (const col of m.normalized) {
        if (col[k] + EPS < col[i]) { all = false; break; }
        if (col[k] > col[i] + EPS) strict = true;
      }
      if (all && strict) by.push(m.names[k]);
    }
    if (by.length) out.push({ name: m.names[i], index: i, dominatedBy: by });
  }
  return out;
}

function reweight(base, focus, value) {
  if (base.length === 1) return [1];
  const out = Array(base.length).fill(0);
  out[focus] = value;
  const other = 1 - base[focus];
  if (other <= EPS) {
    const each = (1 - value) / (base.length - 1);
    for (let i = 0; i < base.length; i++) if (i !== focus) out[i] = each;
  } else {
    for (let i = 0; i < base.length; i++) if (i !== focus) out[i] = base[i] / other * (1 - value);
  }
  return out;
}

export function decisionSensitivity(alternatives, criteria, { steps = 100 } = {}) {
  if (!Number.isInteger(steps) || steps < 10 || steps > 1000) throw new RangeError('steps must be an integer from 10 to 1000');
  const m = normalizeDecisionMatrix(alternatives, criteria);
  const base = weights(m.criteria);
  return m.criteria.map((c, j) => {
    const bands = [];
    let current = null;
    for (let s = 0; s <= steps; s++) {
      const w = s / steps;
      const winner = scoreWithWeights(m.names, m.normalized, reweight(base, j, w))[0].name;
      if (!current || current.winner !== winner) {
        if (current) current.to = (s - 1) / steps;
        current = { winner, from: w, to: w };
        bands.push(current);
      } else current.to = w;
    }
    const baseWinner = scoreWithWeights(m.names, m.normalized, base)[0].name;
    const baseBand = bands.find((b) => base[j] + EPS >= b.from && base[j] <= b.to + EPS);
    return { criterion: c.name, index: j, baseWeight: base[j], baseWinner, stableFrom: baseBand?.from ?? base[j], stableTo: baseBand?.to ?? base[j], bands };
  });
}

export function analyzeDecisionMatrix(alternatives, criteria, options) {
  const scored = scoreDecisionMatrix(alternatives, criteria);
  const dominated = dominatedAlternatives(alternatives, criteria);
  const sensitivity = decisionSensitivity(alternatives, criteria, options);
  const top = scored.ranking[0], second = scored.ranking[1];
  return {
    ...scored,
    dominated,
    sensitivity,
    margin: second ? top.score - second.score : top.score,
    robustCriteria: sensitivity.filter((s) => s.stableFrom <= .001 && s.stableTo >= .999).map((s) => s.criterion),
  };
}
