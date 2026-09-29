function groups(ballot) {
  return ballot.map((x) => Array.isArray(x) ? x.map(String) : [String(x)]).filter((g) => g.length);
}

export function parseBallots(text) {
  const ballots = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const gs = line.split(/\s*>\s*/).map((part) => part.split(/\s*=\s*/).map((x) => x.trim()).filter(Boolean)).filter((g) => g.length);
    const flat = gs.flat();
    if (new Set(flat).size !== flat.length) throw new Error(`Duplicate option in ballot: ${line}`);
    ballots.push(gs);
  }
  if (!ballots.length) throw new Error('Add at least one ballot.');
  return ballots;
}

function prepared(ballots) {
  if (!Array.isArray(ballots) || !ballots.length) throw new Error('Add at least one ballot.');
  const bs = ballots.map(groups);
  const candidates = [...new Set(bs.flat(2))];
  if (candidates.length < 2) throw new Error('At least two options are required.');
  const rankMaps = bs.map((b) => {
    const m = new Map();
    b.forEach((g, r) => g.forEach((c) => m.set(c, r)));
    return m;
  });
  return { ballots: bs, candidates, rankMaps };
}

export function pairwiseMatrix(ballots) {
  const p = prepared(ballots), n = p.candidates.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (const ranks of p.rankMaps) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = ranks.get(p.candidates[i]) ?? Infinity, b = ranks.get(p.candidates[j]) ?? Infinity;
      if (a < b) matrix[i][j]++; else if (b < a) matrix[j][i]++;
    }
  }
  return { ...p, matrix };
}

function borda(ballots) {
  const p = prepared(ballots), n = p.candidates.length, scores = Array(n).fill(0);
  for (const b of p.ballots) {
    let pos = 0;
    for (const g of b) {
      const pts = g.reduce((s, _, k) => s + Math.max(0, n - 1 - (pos + k)), 0) / g.length;
      for (const c of g) scores[p.candidates.indexOf(c)] += pts;
      pos += g.length;
    }
  }
  return scores;
}

function copeland(matrix) {
  return matrix.map((row, i) => row.reduce((s, v, j) => j === i ? s : s + (v > matrix[j][i] ? 1 : v < matrix[j][i] ? -1 : 0), 0));
}

function schulze(matrix) {
  const n = matrix.length, p = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && matrix[i][j] > matrix[j][i]) p[i][j] = matrix[i][j];
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (i !== k) for (let j = 0; j < n; j++) if (j !== i && j !== k) p[i][j] = Math.max(p[i][j], Math.min(p[i][k], p[k][j]));
  return p;
}

export function consensusRank(ballots, { method = 'schulze' } = {}) {
  const pw = pairwiseMatrix(ballots), n = pw.candidates.length;
  const b = borda(ballots), c = copeland(pw.matrix), paths = schulze(pw.matrix);
  let score;
  if (method === 'borda') score = b;
  else if (method === 'copeland') score = c;
  else score = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : (paths[i][j] > paths[j][i] ? 1 : paths[i][j] < paths[j][i] ? -1 : 0)).reduce((a, x) => a + x, 0));
  const ranking = pw.candidates.map((name, i) => ({ name, index: i, score: score[i], borda: b[i], copeland: c[i] }))
    .sort((a, z) => z.score - a.score || z.borda - a.borda || a.name.localeCompare(z.name));
  const condorcet = pw.candidates.find((_, i) => pw.candidates.every((__, j) => i === j || pw.matrix[i][j] > pw.matrix[j][i])) ?? null;
  let decisive = 0, margin = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const total = pw.matrix[i][j] + pw.matrix[j][i];
    if (total) { decisive += total; margin += Math.abs(pw.matrix[i][j] - pw.matrix[j][i]); }
  }
  return { ...pw, method, ranking, borda: b, copeland: c, paths, condorcetWinner: condorcet, agreement: decisive ? margin / decisive : 0 };
}
