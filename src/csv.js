// RFC 4180 CSV parsing/writing with delimiter detection, plus the
// JSON <-> table conversions used by the converters and the CSV diff.

const CANDIDATES = [',', ';', '\t', '|'];

export function detectDelimiter(text) {
  const sample = text.slice(0, 20000);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = [];
    let inQ = false;
    let c = 0;
    for (let i = 0; i < sample.length && counts.length < 20; i++) {
      const ch = sample[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) c++;
      else if (!inQ && ch === '\n') { counts.push(c); c = 0; }
    }
    if (c) counts.push(c);
    if (!counts.length || !counts[0]) continue;
    // Prefer delimiters that appear a consistent, non-zero number of times.
    const consistent = counts.filter((x) => x === counts[0]).length / counts.length;
    const score = consistent * 10 + Math.min(counts[0], 50) / 50;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function parseCsv(text, { delimiter = 'auto' } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter === 'auto' ? detectDelimiter(text) : delimiter;
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  const n = text.length;
  let inQuotes = false;
  let fieldStarted = false;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; fieldStarted = false; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i++;
  }
  if (fieldStarted || field || row.length) { row.push(field); rows.push(row); }
  // Drop fully empty trailing lines.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return { rows, delimiter: d, unterminatedQuote: inQuotes };
}

function quoteField(v, d) {
  const s = v == null ? '' : String(v);
  if (s.includes(d) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows, delimiter = ',') {
  return rows.map((r) => r.map((v) => quoteField(v, delimiter)).join(delimiter)).join('\r\n');
}

// ---------- JSON -> CSV ----------

function flatten(value, prefix, out, opts) {
  if (value !== null && typeof value === 'object') {
    const isArr = Array.isArray(value);
    if (isArr && !opts.expandArrays) {
      out[prefix] = JSON.stringify(value);
      return;
    }
    const keys = isArr ? value.map((_, i) => i) : Object.keys(value);
    if (!keys.length) {
      if (prefix) out[prefix] = isArr ? '[]' : '{}';
      return;
    }
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : String(k), out, opts);
    return;
  }
  out[prefix || 'value'] = value;
}

/**
 * Turn parsed JSON into rows. Accepts an array of objects, a single object,
 * an object whose values are objects (keyed records), or an array of arrays.
 */
export function jsonToRows(data, { expandArrays = false } = {}) {
  let records;
  if (Array.isArray(data)) {
    if (data.length && data.every(Array.isArray)) return data.map((r) => r.map(cellValue));
    records = data;
  } else if (data && typeof data === 'object') {
    const vals = Object.values(data);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      records = Object.entries(data).map(([k, v]) => ({ key: k, ...v }));
    } else records = [data];
  } else {
    throw new Error('Expected a JSON array or object.');
  }
  const cols = [];
  const seen = new Set();
  const flat = records.map((r) => {
    const o = {};
    if (r !== null && typeof r === 'object') flatten(r, '', o, { expandArrays });
    else o.value = r;
    for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return o;
  });
  return [cols, ...flat.map((o) => cols.map((c) => cellValue(o[c])))];
}

function cellValue(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------- CSV -> JSON ----------

export function inferValue(s) {
  if (s === '') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    // Keep long IDs etc. as strings when they would lose precision.
    if (Number.isFinite(n) && (Number.isSafeInteger(n) || !/^-?\d+$/.test(s))) return n;
  }
  return s;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

export function rowsToJson(rows, { header = true, inferTypes = true, nested = false } = {}) {
  const conv = inferTypes ? inferValue : (s) => s;
  if (!header) return rows.map((r) => r.map(conv));
  const [head = [], ...body] = rows;
  const keys = head.map((h, i) => (h.trim() ? h.trim() : `column${i + 1}`));
  return body.map((r) => {
    const o = {};
    keys.forEach((k, i) => {
      const v = conv(r[i] ?? '');
      if (nested && k.includes('.')) setPath(o, k, v);
      else o[k] = v;
    });
    return o;
  });
}

// ---------- CSV diff ----------

/**
 * Compare two tables. With keyColumn set, rows are matched by that column's
 * value; otherwise by position.
 */
export function diffTables(aRows, bRows, { header = true, keyColumn = null, ignoreCase = false, trim = true } = {}) {
  const norm = (v) => {
    let s = v ?? '';
    if (trim) s = s.trim();
    if (ignoreCase) s = s.toLowerCase();
    return s;
  };
  const aHead = header ? aRows[0] || [] : [];
  const bHead = header ? bRows[0] || [] : [];
  const aBody = header ? aRows.slice(1) : aRows;
  const bBody = header ? bRows.slice(1) : bRows;
  const width = Math.max(aHead.length, bHead.length, ...aBody.map((r) => r.length), ...bBody.map((r) => r.length), 0);

  // Map columns by name when headers exist, otherwise by position.
  let columns;
  if (header) {
    const names = [];
    const seen = new Set();
    for (const h of [...aHead, ...bHead]) if (!seen.has(h)) { seen.add(h); names.push(h); }
    columns = names.map((name) => ({ name, ai: aHead.indexOf(name), bi: bHead.indexOf(name) }));
  } else {
    columns = Array.from({ length: width }, (_, i) => ({ name: `Column ${i + 1}`, ai: i, bi: i }));
  }
  const cell = (row, idx) => (idx < 0 ? undefined : row[idx] ?? '');

  const pairs = []; // {status, a, b, key}
  if (keyColumn !== null && keyColumn !== '' && header) {
    const col = columns.find((c) => c.name === keyColumn);
    const keyOf = (row, side) => norm(cell(row, side === 'a' ? col.ai : col.bi) ?? '');
    const bMap = new Map();
    const dupKeys = new Set();
    bBody.forEach((r, i) => {
      const k = keyOf(r, 'b');
      if (bMap.has(k)) dupKeys.add(k);
      else bMap.set(k, i);
    });
    const usedB = new Set();
    aBody.forEach((r, ai) => {
      const k = keyOf(r, 'a');
      const bi = bMap.get(k);
      if (bi === undefined || usedB.has(bi)) pairs.push({ status: 'removed', a: r, key: k, ai });
      else { usedB.add(bi); pairs.push({ status: 'pending', a: r, b: bBody[bi], key: k, ai, bi }); }
    });
    bBody.forEach((r, i) => { if (!usedB.has(i)) pairs.push({ status: 'added', b: r, key: keyOf(r, 'b'), bi: i }); });
    pairs.duplicateKeys = [...dupKeys];
  } else {
    const n = Math.max(aBody.length, bBody.length);
    for (let i = 0; i < n; i++) {
      if (i >= aBody.length) pairs.push({ status: 'added', b: bBody[i], key: String(i + 1), bi: i });
      else if (i >= bBody.length) pairs.push({ status: 'removed', a: aBody[i], key: String(i + 1), ai: i });
      else pairs.push({ status: 'pending', a: aBody[i], b: bBody[i], key: String(i + 1), ai: i, bi: i });
    }
  }
  let changed = 0;
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const p of pairs) {
    if (p.status === 'pending') {
      p.changedCols = [];
      columns.forEach((c, ci) => {
        const va = cell(p.a, c.ai);
        const vb = cell(p.b, c.bi);
        if (va === undefined || vb === undefined) return; // column only on one side
        if (norm(va) !== norm(vb)) p.changedCols.push(ci);
      });
      p.status = p.changedCols.length ? 'changed' : 'same';
    }
    if (p.status === 'changed') changed++;
    else if (p.status === 'added') added++;
    else if (p.status === 'removed') removed++;
    else same++;
  }
  const addedCols = columns.filter((c) => c.ai < 0).map((c) => c.name);
  const removedCols = columns.filter((c) => c.bi < 0).map((c) => c.name);
  return { columns, pairs, changed, added, removed, same, addedCols, removedCols, duplicateKeys: pairs.duplicateKeys || [] };
}
