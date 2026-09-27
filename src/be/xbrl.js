// XBRL 2.1 instance reader (plain .xbrl and inline XBRL in XHTML).
// Reads contexts, units and facts; recognises Belgian NBB annual-account and
// Biztax filings from the taxonomy reference. Labels are not resolved: the
// taxonomies are far too large to ship to the browser.

import { elements, find, findAll, descendants, text, attr } from '../xml.js';
import { parseEnterprise } from './ids.js';
import { toCsv } from '../csv.js';

const NS_XBRLI = 'http://www.xbrl.org/2003/instance';
const NS_LINK = 'http://www.xbrl.org/2003/linkbase';
const NS_IX = /^http:\/\/www\.xbrl\.org\/20(08|13)\/inlineXBRL$/;
const SKIP_NS = new Set([NS_XBRLI, NS_LINK, 'http://www.w3.org/1999/xlink', 'http://xbrl.org/2006/xbrldi']);

export function isXbrl(root) {
  if (root.local === 'xbrl' && root.ns === NS_XBRLI) return true;
  return root.local === 'html' && descendants(root).some((e) => NS_IX.test(e.ns || '') && (e.local === 'nonFraction' || e.local === 'nonNumeric'));
}

/** What kind of Belgian filing a taxonomy reference points to. */
export function classifyTaxonomy(hrefs) {
  const all = hrefs.join(' ').toLowerCase();
  if (/nbb\.be/.test(all) || /\/pfs\//.test(all)) {
    const m = /\/(?:pfs|be-gaap)[^ ]*?\/(\d{4}-\d{2}-\d{2})\//.exec(all);
    return { kind: 'nbb', label: 'NBB annual accounts (Central Balance Sheet Office)', version: m ? m[1] : '' };
  }
  if (/biztax|minfin\.fgov\.be|tax-inc|\/tax\//.test(all)) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(all);
    return { kind: 'biztax', label: 'Biztax tax return (FPS Finance)', version: m ? m[1] : '' };
  }
  return { kind: 'other', label: 'XBRL instance', version: '' };
}

function readPeriod(ctx) {
  const p = find(ctx, 'period');
  if (!p) return { type: 'none' };
  if (find(p, 'instant')) return { type: 'instant', instant: text(find(p, 'instant')).slice(0, 10) };
  if (find(p, 'forever')) return { type: 'forever' };
  return { type: 'duration', start: text(find(p, 'startDate')).slice(0, 10), end: text(find(p, 'endDate')).slice(0, 10) };
}

export const periodLabel = (p) => (!p ? '' : p.type === 'instant' ? p.instant : p.type === 'duration' ? `${p.start} → ${p.end}` : p.type === 'forever' ? 'forever' : '');
/** The date a period "ends" on, for sorting. */
const periodEnd = (p) => (p?.type === 'instant' ? p.instant : p?.type === 'duration' ? p.end : '');

function readContext(ctx) {
  const ident = find(ctx, 'entity/identifier');
  const dims = [];
  for (const holder of ['entity/segment', 'scenario']) {
    const box = find(ctx, holder);
    if (!box) continue;
    for (const m of elements(box)) {
      if (m.local === 'explicitMember') dims.push({ dimension: attr(m, 'dimension'), member: text(m) });
      else if (m.local === 'typedMember') dims.push({ dimension: attr(m, 'dimension'), member: text(m), typed: true });
      else dims.push({ dimension: m.name, member: text(m) });
    }
  }
  return { id: attr(ctx, 'id'), scheme: attr(ident, 'scheme'), identifier: text(ident), period: readPeriod(ctx), dims };
}

function readUnit(u) {
  const div = find(u, 'divide');
  const measures = (node) => findAll(node, 'measure').map((m) => text(m).split(':').pop());
  if (div) return { id: attr(u, 'id'), label: `${measures(find(div, 'unitNumerator')).join('·')}/${measures(find(div, 'unitDenominator')).join('·')}` };
  return { id: attr(u, 'id'), label: measures(u).join('·') };
}

// Inline XBRL number transformation (the common ixt formats).
function ixNumber(raw, format, scale, sign) {
  let s = raw.replace(/\s/g, '');
  const f = (format || '').split(':').pop();
  if (/zerodash|fixed-zero|numdotdecimal$|^zero/.test(f) && /^[---]$/.test(s)) s = '0';
  else if (/comma-?decimal|numcommadecimal|num-comma-decimal/.test(f)) s = s.replace(/[.  ']/g, '').replace(',', '.');
  else s = s.replace(/[,  ']/g, '');
  let n = Number(s);
  if (!Number.isFinite(n)) return raw;
  if (scale) n *= 10 ** Number(scale);
  if (sign === '-') n = -n;
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Parse an XBRL instance root into a model:
 * { taxonomy, schemaRefs, entity, contexts, units, facts, periods, issues }
 */
export function parseXbrl(root) {
  if (!isXbrl(root)) throw new Error('This is not an XBRL instance: expected an <xbrli:xbrl> root (or inline XBRL).');
  const inline = root.local === 'html';
  const schemaRefs = descendants(root, 'schemaRef').map((s) => attr(s, 'href')).filter(Boolean);
  const contexts = new Map();
  const units = new Map();
  for (const c of descendants(root, 'context')) if (c.ns === NS_XBRLI) contexts.set(attr(c, 'id'), readContext(c));
  for (const u of descendants(root, 'unit')) if (u.ns === NS_XBRLI) units.set(attr(u, 'id'), readUnit(u));

  const facts = [];
  const pushFact = (e, value, extra = {}) => {
    const concept = inline ? attr(e, 'name') : e.name;
    const ctxRef = attr(e, 'contextRef');
    const unitRef = attr(e, 'unitRef');
    const ctx = contexts.get(ctxRef);
    const nil = attr(e, 'nil') === 'true';
    const numeric = !!unitRef;
    facts.push({
      concept,
      prefix: concept.includes(':') ? concept.split(':')[0] : '',
      local: concept.split(':').pop(),
      value: nil ? null : value,
      numeric,
      number: numeric && !nil && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null,
      unit: unitRef ? units.get(unitRef)?.label || unitRef : '',
      unitRef,
      decimals: attr(e, 'decimals'),
      contextRef: ctxRef,
      period: ctx?.period || null,
      dims: ctx?.dims || [],
      line: e.line,
      ...extra,
    });
  };

  if (inline) {
    for (const e of descendants(root)) {
      if (!NS_IX.test(e.ns || '')) continue;
      if (e.local === 'nonFraction') pushFact(e, ixNumber(text(e), attr(e, 'format'), attr(e, 'scale'), attr(e, 'sign')));
      else if (e.local === 'nonNumeric') pushFact(e, text(e));
    }
  } else {
    // Facts are root children (or inside tuples) that carry a contextRef.
    const walk = (node) => {
      for (const e of elements(node)) {
        if (SKIP_NS.has(e.ns)) continue;
        if ('contextRef' in e.attrs) pushFact(e, text(e));
        else walk(e); // tuple
      }
    };
    walk(root);
  }

  // Entity: the most common identifier across contexts.
  const idCount = new Map();
  for (const c of contexts.values()) if (c.identifier) idCount.set(`${c.scheme}|${c.identifier}`, (idCount.get(`${c.scheme}|${c.identifier}`) || 0) + 1);
  const [topId] = [...idCount.entries()].sort((a, b) => b[1] - a[1])[0] || [''];
  const [scheme = '', identifier = ''] = topId.split('|');
  const ent = /^\d[\d .]{8,}$/.test(identifier.replace(/^BE/i, '')) ? parseEnterprise(identifier) : null;

  const issues = [];
  if (ent && !ent.valid) issues.push({ level: 'error', message: `Entity identifier ${identifier} fails the enterprise-number check (${ent.errors.join(' ')})` });
  if (idCount.size > 1) issues.push({ level: 'warning', message: `Contexts use ${idCount.size} different entity identifiers.` });
  const seen = new Map();
  for (const f of facts) {
    if (!f.contextRef || !contexts.has(f.contextRef)) issues.push({ level: 'error', message: `${f.concept} refers to missing context "${f.contextRef}".`, line: f.line });
    if (f.unitRef && !units.has(f.unitRef)) issues.push({ level: 'error', message: `${f.concept} refers to missing unit "${f.unitRef}".`, line: f.line });
    if (f.numeric && f.value !== null && f.number === null) issues.push({ level: 'error', message: `${f.concept} is numeric but its value "${String(f.value).slice(0, 40)}" is not a number.`, line: f.line });
    const key = `${f.concept}|${f.contextRef}|${f.unitRef}`;
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (String(prev.value) !== String(f.value)) issues.push({ level: 'error', message: `Inconsistent duplicate: ${f.concept} in context ${f.contextRef} is both "${prev.value}" and "${f.value}".`, line: f.line });
      else issues.push({ level: 'warning', message: `Duplicate fact ${f.concept} in context ${f.contextRef}.`, line: f.line });
    } else seen.set(key, f);
  }
  const usedCtx = new Set(facts.map((f) => f.contextRef));
  const unused = [...contexts.keys()].filter((id) => !usedCtx.has(id));
  if (unused.length) issues.push({ level: 'info', message: `${unused.length} context${unused.length === 1 ? ' is' : 's are'} not used by any fact.` });

  const periods = [...new Map([...contexts.values()].filter((c) => usedCtx.has(c.id)).map((c) => [periodLabel(c.period), c.period])).values()]
    .sort((a, b) => periodEnd(b).localeCompare(periodEnd(a)) || (a.type === 'instant' ? -1 : 1));

  return {
    inline,
    taxonomy: classifyTaxonomy(schemaRefs),
    schemaRefs,
    entity: { scheme, identifier, enterprise: ent?.valid ? ent : null },
    contexts,
    units,
    facts,
    periods,
    issues,
  };
}

const dimsLabel = (dims) => dims.map((d) => `${d.dimension.split(':').pop()}=${d.member.split(':').pop()}`).join(', ');

/**
 * Pivot: one row per concept (+ dimensions), one column per period.
 * Returns { periods: [label], rows: [{ concept, dims, values: {label: fact} }] }
 */
export function pivotFacts(model) {
  const labels = model.periods.map(periodLabel);
  const rows = new Map();
  for (const f of model.facts) {
    const d = dimsLabel(f.dims);
    const key = `${f.concept}|${d}`;
    if (!rows.has(key)) rows.set(key, { concept: f.concept, dims: d, values: {} });
    rows.get(key).values[periodLabel(f.period)] = f;
  }
  return { periods: labels, rows: [...rows.values()] };
}

export const XBRL_COLUMNS = ['concept', 'value', 'unit', 'decimals', 'period_type', 'period_start', 'period_end', 'dimensions', 'context'];

export function xbrlToRows(model) {
  return model.facts.map((f) => ({
    concept: f.concept,
    value: f.value ?? '',
    unit: f.unit,
    decimals: f.decimals,
    period_type: f.period?.type || '',
    period_start: f.period?.type === 'duration' ? f.period.start : '',
    period_end: f.period?.type === 'instant' ? f.period.instant : f.period?.type === 'duration' ? f.period.end : '',
    dimensions: dimsLabel(f.dims),
    context: f.contextRef,
  }));
}

export function xbrlToCsv(model) {
  return toCsv([XBRL_COLUMNS, ...xbrlToRows(model).map((r) => XBRL_COLUMNS.map((c) => r[c]))]);
}

export function xbrlToJson(model) {
  return {
    format: model.inline ? 'inline XBRL' : 'XBRL',
    taxonomy: { ...model.taxonomy, schemaRefs: model.schemaRefs },
    entity: { scheme: model.entity.scheme, identifier: model.entity.identifier, enterpriseNumber: model.entity.enterprise?.formatted || null },
    periods: model.periods.map(periodLabel),
    facts: model.facts.map((f) => ({
      concept: f.concept,
      value: f.number ?? f.value,
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.decimals ? { decimals: f.decimals } : {}),
      period: f.period?.type === 'instant' ? f.period.instant : f.period?.type === 'duration' ? { start: f.period.start, end: f.period.end } : null,
      ...(f.dims.length ? { dimensions: Object.fromEntries(f.dims.map((d) => [d.dimension, d.member])) } : {}),
    })),
  };
}

/**
 * Compare two filings. For each concept(+dimensions), take each file's value
 * for its latest period of the same type (instant vs duration) and diff them.
 */
export function compareXbrl(a, b) {
  const latest = (m) => {
    const best = new Map();
    for (const f of m.facts) {
      const key = `${f.concept}|${dimsLabel(f.dims)}|${f.period?.type}`;
      const cur = best.get(key);
      if (!cur || periodEnd(f.period) > periodEnd(cur.period)) best.set(key, f);
    }
    return best;
  };
  const la = latest(a);
  const lb = latest(b);
  const keys = [...new Set([...la.keys(), ...lb.keys()])].sort();
  const rows = keys.map((k) => {
    const fa = la.get(k);
    const fb = lb.get(k);
    const [concept, dims] = k.split('|');
    const same = fa && fb && String(fa.value) === String(fb.value);
    const delta = fa?.number !== null && fa?.number !== undefined && fb?.number !== null && fb?.number !== undefined ? fa.number - fb.number : null;
    return {
      concept, dims,
      a: fa ? fa.value : undefined, periodA: fa ? periodLabel(fa.period) : '',
      b: fb ? fb.value : undefined, periodB: fb ? periodLabel(fb.period) : '',
      delta,
      pct: delta !== null && fb.number ? (delta / Math.abs(fb.number)) * 100 : null,
      status: !fa ? 'only-b' : !fb ? 'only-a' : same ? 'same' : 'different',
    };
  });
  return rows;
}
