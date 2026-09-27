// Belgian Intervat XML (FPS Finance): periodic VAT return (VATConsignment),
// annual customer listing (ClientListingConsignment) and intra-Community
// listing (IntraConsignment). Reads the file and runs plausibility checks.

import { find, findAll, val, text, attr, elements } from '../xml.js';
import { parseEnterprise } from './ids.js';

export const INTERVAT_KINDS = {
  VATConsignment: 'Periodic VAT return',
  ClientListingConsignment: 'Annual customer listing',
  IntraConsignment: 'Intra-Community listing',
};

export const isIntervat = (root) => root.local in INTERVAT_KINDS && /minfin\.fgov\.be/.test(root.ns || '');

/** Grids of the periodic VAT return: [number, section, English, Dutch]. */
export const VAT_GRIDS = [
  ['00', 'Output', 'Operations subject to a special regime', 'Handelingen onderworpen aan een bijzondere regeling'],
  ['01', 'Output', 'Operations at 6%', 'Handelingen aan 6%'],
  ['02', 'Output', 'Operations at 12%', 'Handelingen aan 12%'],
  ['03', 'Output', 'Operations at 21%', 'Handelingen aan 21%'],
  ['44', 'Output', 'Services to EU customers (reverse charge abroad)', 'Diensten aan EU-afnemers (verlegging in andere lidstaat)'],
  ['45', 'Output', 'Operations where the customer owes the VAT (Belgian reverse charge)', 'Handelingen waarvoor de btw verschuldigd is door de medecontractant'],
  ['46', 'Output', 'Exempt intra-Community supplies of goods and ABC sales', 'Vrijgestelde intracommunautaire leveringen en ABC-verkopen'],
  ['47', 'Output', 'Other exempt operations and exports', 'Andere vrijgestelde handelingen en uitvoer'],
  ['48', 'Output', 'Credit notes issued on operations in grids 44 and 46', 'Uitgereikte creditnota’s m.b.t. roosters 44 en 46'],
  ['49', 'Output', 'Credit notes issued on other operations', 'Uitgereikte creditnota’s m.b.t. andere handelingen'],
  ['81', 'Input', 'Trade goods, raw materials and consumables', 'Handelsgoederen, grond- en hulpstoffen'],
  ['82', 'Input', 'Services and miscellaneous goods', 'Diensten en diverse goederen'],
  ['83', 'Input', 'Investment (capital) goods', 'Bedrijfsmiddelen'],
  ['84', 'Input', 'Credit notes received on operations in grids 86 and 88', 'Ontvangen creditnota’s m.b.t. roosters 86 en 88'],
  ['85', 'Input', 'Other credit notes received', 'Andere ontvangen creditnota’s'],
  ['86', 'Input', 'Intra-Community acquisitions of goods and ABC purchases', 'Intracommunautaire verwervingen en ABC-aankopen'],
  ['87', 'Input', 'Other incoming operations where the declarant owes the VAT', 'Andere inkomende handelingen waarvoor de aangever de btw verschuldigd is'],
  ['88', 'Input', 'Intra-Community services received (reverse charge)', 'Intracommunautaire diensten met verlegging'],
  ['54', 'VAT due', 'VAT on operations in grids 01, 02 and 03', 'Btw op handelingen in roosters 01, 02 en 03'],
  ['55', 'VAT due', 'VAT on operations in grids 86 and 88', 'Btw op handelingen in roosters 86 en 88'],
  ['56', 'VAT due', 'VAT on operations in grid 87 (except imports with deferral)', 'Btw op handelingen in rooster 87 (behalve invoer met verlegging)'],
  ['57', 'VAT due', 'VAT on imports with deferral of payment', 'Btw op invoer met verlegging van heffing'],
  ['61', 'VAT due', 'Regularisations in favour of the State', 'Diverse btw-regularisaties in het voordeel van de Staat'],
  ['63', 'VAT due', 'VAT to repay on credit notes received', 'Terug te storten btw op ontvangen creditnota’s'],
  ['59', 'Deductible', 'Deductible VAT', 'Aftrekbare btw'],
  ['62', 'Deductible', 'Regularisations in favour of the declarant', 'Diverse btw-regularisaties in het voordeel van de aangever'],
  ['64', 'Deductible', 'VAT to recover on credit notes issued', 'Te recupereren btw op uitgereikte creditnota’s'],
  ['71', 'Balance', 'Amount payable to the State', 'Verschuldigd aan de Staat'],
  ['72', 'Balance', 'Amount owed to the declarant', 'Sommen verschuldigd aan de aangever'],
  ['91', 'Advance', 'December advance payment (monthly filers)', 'Voorschot december (maandaangevers)'],
];
const GRID = Object.fromEntries(VAT_GRIDS.map((g) => [g[0], g]));

const num = (s) => (s === '' || s === undefined ? null : Number(String(s).replace(',', '.')));
const cents = (n) => Math.round(n * 100);

function declarant(node) {
  const d = find(node, 'Declarant');
  if (!d) return null;
  const vat = val(d, 'VATNumber');
  return {
    vat,
    check: vat ? parseEnterprise(vat) : null,
    name: val(d, 'Name'),
    street: val(d, 'Street'),
    postCode: val(d, 'PostCode'),
    city: val(d, 'City'),
    country: val(d, 'CountryCode'),
    email: val(d, 'EmailAddress'),
    phone: val(d, 'Phone'),
  };
}

function period(node) {
  const p = find(node, 'Period');
  if (!p) return null;
  const month = val(p, 'Month');
  const quarter = val(p, 'Quarter');
  const year = val(p, 'Year') || (elements(p).length ? '' : text(p));
  return { month: month ? +month : null, quarter: quarter ? +quarter : null, year: year ? +year : null, label: month ? `${year}-${String(month).padStart(2, '0')}` : quarter ? `Q${quarter} ${year}` : String(year) };
}

function representative(root) {
  const r = find(root, 'Representative');
  if (!r) return null;
  const id = find(r, 'RepresentativeID');
  return { id: text(id), idType: attr(id, 'identificationType'), issuedBy: attr(id, 'issuedBy'), name: val(r, 'Name'), email: val(r, 'EmailAddress') };
}

function readReturn(decl) {
  const grids = {};
  const issues = [];
  for (const a of findAll(decl, 'Data/Amount')) {
    const g = attr(a, 'GridNumber').padStart(2, '0');
    const v = num(text(a));
    if (!GRID[g]) issues.push({ level: 'error', message: `Unknown grid number ${g}.` });
    if (v === null || Number.isNaN(v)) issues.push({ level: 'error', message: `Grid ${g}: "${text(a)}" is not an amount.` });
    else if (v < 0) issues.push({ level: 'error', message: `Grid ${g} is negative; amounts must be positive.` });
    else if (!/^\d+(\.\d{1,2})?$/.test(text(a))) issues.push({ level: 'warning', message: `Grid ${g}: use a dot and at most 2 decimals (${text(a)}).` });
    if (g in grids) issues.push({ level: 'error', message: `Grid ${g} appears twice.` });
    grids[g] = v;
  }
  const G = (g) => grids[g] || 0;
  const due = G('54') + G('55') + G('56') + G('57') + G('61') + G('63');
  const deductible = G('59') + G('62') + G('64');
  const balance = due - deductible;
  const checks = [];
  if ('71' in grids && '72' in grids) issues.push({ level: 'error', message: 'Grids 71 and 72 cannot both be filled.' });
  const expected71 = balance > 0 ? balance : 0;
  const expected72 = balance < 0 ? -balance : 0;
  checks.push({ label: 'Grid 71 = (54+55+56+57+61+63) − (59+62+64)', expected: expected71, actual: G('71'), ok: cents(expected71) === cents(G('71')) });
  checks.push({ label: 'Grid 72 = (59+62+64) − (54+55+56+57+61+63)', expected: expected72, actual: G('72'), ok: cents(expected72) === cents(G('72')) });

  // Plausibility (not errors: cash-basis, margin schemes and regularisations can explain gaps).
  const rate54 = G('01') * 0.06 + G('02') * 0.12 + G('03') * 0.21;
  if (G('01') + G('02') + G('03') > 0 && Math.abs(rate54 - G('54')) > Math.max(1, rate54 * 0.02)) {
    issues.push({ level: 'warning', message: `Grid 54 is ${G('54').toFixed(2)} but 6%/12%/21% of grids 01-03 gives ${rate54.toFixed(2)}. Check the bases or rates.` });
  }
  if ((G('86') + G('88')) > 0 && !G('55')) issues.push({ level: 'warning', message: 'Grids 86/88 are filled but no VAT is due in grid 55.' });
  if (G('55') > 0 && !(G('86') + G('88'))) issues.push({ level: 'warning', message: 'Grid 55 has VAT but grids 86 and 88 are empty.' });
  if (G('87') > 0 && !(G('56') + G('57'))) issues.push({ level: 'warning', message: 'Grid 87 is filled but grids 56 and 57 are empty.' });
  if (G('84') > 0 && !(G('86') + G('88'))) issues.push({ level: 'info', message: 'Grid 84 (credit notes on 86/88) without purchases in 86/88 this period.' });
  if (G('48') > 0 && !(G('44') + G('46'))) issues.push({ level: 'info', message: 'Grid 48 (credit notes on 44/46) without operations in 44/46 this period.' });
  const ask = find(decl, 'Ask');
  const p = period(decl);
  if ('91' in grids && p && !(p.month === 12)) issues.push({ level: 'warning', message: 'Grid 91 (December advance) is only used in the December return of monthly filers.' });
  if (ask && attr(ask, 'Restitution') === 'YES' && !G('72')) issues.push({ level: 'warning', message: 'A refund is requested but grid 72 is empty.' });
  return {
    grids,
    totals: { due, deductible, balance },
    checks,
    issues,
    ask: ask ? { restitution: attr(ask, 'Restitution'), payment: attr(ask, 'Payment') } : null,
    clientListingNihil: val(decl, 'ClientListingNihil'),
  };
}

function readClientListing(l) {
  const issues = [];
  const clients = findAll(l, 'Client').map((c) => {
    const vatNode = find(c, 'CompanyVATNumber');
    const vat = text(vatNode);
    const chk = parseEnterprise(vat);
    const turnover = num(val(c, 'TurnOver'));
    const vatAmount = num(val(c, 'VATAmount'));
    if (!chk.valid) issues.push({ level: 'error', message: `Customer ${attr(c, 'SequenceNumber')}: VAT number ${vat} is invalid (${chk.errors.join(' ')}).` });
    if (turnover !== null && turnover < 250) issues.push({ level: 'info', message: `Customer ${attr(c, 'SequenceNumber')} (${vat}): turnover ${turnover.toFixed(2)} is under the €250 listing threshold.` });
    return { seq: attr(c, 'SequenceNumber'), vat, issuedBy: attr(vatNode, 'issuedBy'), valid: chk.valid, turnover, vatAmount };
  });
  const sumT = clients.reduce((a, c) => a + (c.turnover || 0), 0);
  const sumV = clients.reduce((a, c) => a + (c.vatAmount || 0), 0);
  const checks = [];
  const declaredN = attr(l, 'ClientsNbr');
  if (declaredN) checks.push({ label: 'ClientsNbr = number of customers', expected: clients.length, actual: +declaredN, ok: +declaredN === clients.length, count: true });
  if (attr(l, 'TurnOverSum')) checks.push({ label: 'TurnOverSum = sum of turnovers', expected: sumT, actual: num(attr(l, 'TurnOverSum')), ok: cents(sumT) === cents(num(attr(l, 'TurnOverSum'))) });
  if (attr(l, 'VATAmountSum')) checks.push({ label: 'VATAmountSum = sum of VAT amounts', expected: sumV, actual: num(attr(l, 'VATAmountSum')), ok: cents(sumV) === cents(num(attr(l, 'VATAmountSum'))) });
  const dup = clients.map((c) => c.vat).filter((v, i, a) => a.indexOf(v) !== i);
  for (const d of new Set(dup)) issues.push({ level: 'error', message: `Customer ${d} is listed more than once.` });
  return { clients, totals: { turnover: sumT, vat: sumV }, checks, issues };
}

const INTRA_CODES = { L: 'Goods (intra-Community supply)', T: 'Triangular operation (ABC)', S: 'Services', ' ': '' };

function readIntraListing(l) {
  const issues = [];
  const clients = findAll(l, 'IntraClient').map((c) => {
    const vatNode = find(c, 'CompanyVATNumber');
    const country = attr(vatNode, 'issuedBy');
    const vat = text(vatNode);
    const code = val(c, 'Code');
    const amount = num(val(c, 'Amount'));
    if (country === 'BE') issues.push({ level: 'error', message: `Customer ${attr(c, 'SequenceNumber')}: a Belgian VAT number does not belong in an intra-Community listing.` });
    if (!/^[A-Z]{2}$/.test(country)) issues.push({ level: 'error', message: `Customer ${attr(c, 'SequenceNumber')}: missing country (issuedBy).` });
    if (vat && /^[A-Z]{2}/.test(vat)) issues.push({ level: 'warning', message: `Customer ${attr(c, 'SequenceNumber')}: the VAT number should not repeat the country prefix (${vat}).` });
    if (code && !INTRA_CODES[code]) issues.push({ level: 'error', message: `Customer ${attr(c, 'SequenceNumber')}: unknown code "${code}" (L, T or S).` });
    const corr = find(c, 'CorrectingPeriod');
    return { seq: attr(c, 'SequenceNumber'), country, vat, code, codeLabel: INTRA_CODES[code] || '', amount, correcting: corr ? text(corr) : '' };
  });
  const sum = clients.reduce((a, c) => a + (c.amount || 0), 0);
  const checks = [];
  if (attr(l, 'ClientsNbr')) checks.push({ label: 'ClientsNbr = number of customers', expected: clients.length, actual: +attr(l, 'ClientsNbr'), ok: +attr(l, 'ClientsNbr') === clients.length, count: true });
  if (attr(l, 'AmountSum')) checks.push({ label: 'AmountSum = sum of amounts', expected: sum, actual: num(attr(l, 'AmountSum')), ok: cents(sum) === cents(num(attr(l, 'AmountSum'))) });
  const byCode = {};
  for (const c of clients) byCode[c.code || '?'] = (byCode[c.code || '?'] || 0) + (c.amount || 0);
  return { clients, totals: { amount: sum, byCode }, checks, issues };
}

/** Parse any Intervat consignment root. */
export function parseIntervat(root) {
  if (!isIntervat(root)) throw new Error('Not an Intervat file: expected VATConsignment, ClientListingConsignment or IntraConsignment (FPS Finance namespace).');
  const kind = root.local;
  const itemName = { VATConsignment: 'VATDeclaration', ClientListingConsignment: 'ClientListing', IntraConsignment: 'IntraListing' }[kind];
  const countAttr = { VATConsignment: 'VATDeclarationsNbr', ClientListingConsignment: 'ClientListingsNbr', IntraConsignment: 'IntraListingsNbr' }[kind];
  const items = findAll(root, itemName).map((node) => {
    const base = {
      seq: attr(node, 'SequenceNumber'),
      reference: attr(node, 'DeclarantReference'),
      declarant: declarant(node),
      period: period(node),
      comment: val(node, 'Comment'),
    };
    const body = kind === 'VATConsignment' ? readReturn(node) : kind === 'ClientListingConsignment' ? readClientListing(node) : readIntraListing(node);
    if (base.declarant?.check && !base.declarant.check.valid) body.issues.unshift({ level: 'error', message: `Declarant VAT number ${base.declarant.vat} is invalid (${base.declarant.check.errors.join(' ')}).` });
    return { ...base, ...body };
  });
  const issues = [];
  const declared = attr(root, countAttr);
  if (declared && +declared !== items.length) issues.push({ level: 'error', message: `${countAttr} says ${declared} but the file contains ${items.length}.` });
  return { kind, kindLabel: INTERVAT_KINDS[kind], representative: representative(root), items, issues };
}

export function intervatToJson(m) {
  const strip = ({ check, ...d }) => ({ ...d, vatValid: check ? check.valid : null });
  return {
    kind: m.kind,
    representative: m.representative,
    items: m.items.map((it) => ({ ...it, declarant: it.declarant ? strip(it.declarant) : null })),
    issues: m.issues,
  };
}

export function intervatToRows(m) {
  if (m.kind === 'VATConsignment') {
    return [['declaration', 'period', 'grid', 'section', 'description', 'amount'], ...m.items.flatMap((it) => Object.keys(it.grids).sort().map((g) => [it.seq, it.period?.label || '', g, GRID[g]?.[1] || '', GRID[g]?.[2] || '', it.grids[g]?.toFixed(2) ?? '']))];
  }
  if (m.kind === 'ClientListingConsignment') {
    return [['listing', 'year', 'seq', 'vat_number', 'valid', 'turnover', 'vat_amount'], ...m.items.flatMap((it) => it.clients.map((c) => [it.seq, it.period?.label || '', c.seq, c.vat, c.valid ? 'yes' : 'no', c.turnover?.toFixed(2) ?? '', c.vatAmount?.toFixed(2) ?? '']))];
  }
  return [['listing', 'period', 'seq', 'country', 'vat_number', 'code', 'amount', 'correcting_period'], ...m.items.flatMap((it) => it.clients.map((c) => [it.seq, it.period?.label || '', c.seq, c.country, c.vat, c.code, c.amount?.toFixed(2) ?? '', c.correcting]))];
}
