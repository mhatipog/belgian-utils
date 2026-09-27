// Common schema for bank statements, shared by the CODA and CAMT parsers so
// every tool (viewer, converters, comparison) works on the same shape.
//
// Statement: { format, file, bank: {bic, name}, account: {iban, number, currency, holder},
//   number, creationDate, openingBalance: {amount, date}, closingBalance: {amount, date},
//   transactions: [Transaction], checks: [{ ok, message }] }
// Transaction: { id, bookingDate, valueDate, amount, currency, direction: 'credit'|'debit',
//   counterparty: {name, account, bic}, communication, reference: {type, value, valid},
//   bankReference, endToEndId, code: {code, description}, purpose, details: [...] }

import { parseOgm, parseRf } from './ids.js';
import { toCsv } from '../csv.js';

/** Classify a payment reference: Belgian OGM, ISO RF, or free text. */
export function classifyReference(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const d = v.replace(/\D/g, '');
  if (d.length === 12 && /^[\d+*/\s]+$/.test(v)) {
    const o = parseOgm(d);
    return { type: 'OGM', value: o.formatted, valid: o.valid };
  }
  if (/^RF\d\d/i.test(v.replace(/\s/g, ''))) {
    const r = parseRf(v);
    return { type: 'RF', value: r.formatted || v, valid: r.valid };
  }
  return { type: 'other', value: v, valid: null };
}

export const STATEMENT_COLUMNS = ['booking_date', 'value_date', 'amount', 'currency', 'counterparty_name', 'counterparty_account', 'counterparty_bic',
  'communication', 'reference_type', 'reference', 'bank_reference', 'end_to_end_id', 'transaction_code', 'description'];

const beDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '');

/** dateFormat: 'iso' (YYYY-MM-DD, default) or 'be' (DD/MM/YYYY). */
export function statementToRows(st, { dateFormat = 'iso' } = {}) {
  const d = dateFormat === 'be' ? beDate : (x) => x || '';
  return [STATEMENT_COLUMNS, ...st.transactions.map((t) => [
    d(t.bookingDate), d(t.valueDate), t.amount.toFixed(2), t.currency || st.account.currency || '',
    t.counterparty?.name || '', t.counterparty?.account || '', t.counterparty?.bic || '',
    t.communication || '', t.reference?.type || '', t.reference?.value || '', t.bankReference || '', t.endToEndId || '',
    t.code?.code || '', t.code?.description || '',
  ])];
}

export const statementToCsv = (st, delimiter = ',', opts = {}) => toCsv(statementToRows(st, opts), delimiter);

export function statementSummary(st) {
  const credits = st.transactions.filter((t) => t.amount > 0);
  const debits = st.transactions.filter((t) => t.amount < 0);
  const sum = (a) => a.reduce((s, t) => s + t.amount, 0);
  return {
    count: st.transactions.length,
    credits: credits.length, creditTotal: sum(credits),
    debits: debits.length, debitTotal: sum(debits),
    withOgm: st.transactions.filter((t) => t.reference?.type === 'OGM').length,
  };
}

/**
 * Match transactions of two statements (e.g. the CODA and CAMT version of
 * the same day) by booking date, amount and reference.
 */
export function compareStatements(a, b) {
  const key = (t) => `${t.bookingDate}|${t.amount.toFixed(2)}`;
  const pool = new Map();
  b.transactions.forEach((t, i) => {
    const k = key(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(i);
  });
  const used = new Set();
  const pairs = [];
  for (const t of a.transactions) {
    const cands = (pool.get(key(t)) || []).filter((i) => !used.has(i));
    let pick = cands.find((i) => (b.transactions[i].reference?.value || '') === (t.reference?.value || '')) ?? cands[0];
    if (pick === undefined) { pairs.push({ a: t, b: null, status: 'only-a' }); continue; }
    used.add(pick);
    const u = b.transactions[pick];
    const diffs = [];
    if ((t.reference?.value || '') !== (u.reference?.value || '')) diffs.push('reference');
    if ((t.counterparty?.account || '').replace(/\s/g, '') !== (u.counterparty?.account || '').replace(/\s/g, '')) diffs.push('counterparty account');
    if ((t.valueDate || '') !== (u.valueDate || '') && t.valueDate && u.valueDate) diffs.push('value date');
    pairs.push({ a: t, b: u, status: diffs.length ? 'different' : 'same', diffs });
  }
  b.transactions.forEach((t, i) => { if (!used.has(i)) pairs.push({ a: null, b: t, status: 'only-b' }); });
  return pairs;
}
