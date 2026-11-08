// Browser-only invoice ↔ bank allocation engine. No financial records leave the browser.
// Scores rank review candidates; they are not probabilities or proof of payment.
import { parseOgm, parseRf, parseIban } from './ids.js';

const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const token = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const iban = (v) => String(v ?? '').toUpperCase().replace(/\s/g, '');
const money = (v) => Math.round(Number(v || 0) * 100);
const rounded = (v) => money(v) / 100;
const text = (v) => String(v ?? '').trim();
const vat = (v) => token(v).replace(/^BE/, '');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const days = (a, b) => isDate(a) && isDate(b) ? Math.abs(Date.parse(a) - Date.parse(b)) / 86400000 : null;

function refKey(value) {
  const k = token(value);
  if (!k || k === 'NOTPROVIDED' || k.length < 6) return '';
  return k;
}

function structuredReference(value) {
  const k = refKey(value);
  if (/^\d{12}$/.test(k)) return parseOgm(k).valid;
  if (/^RF[0-9]{2}/.test(k)) return parseRf(k).valid;
  return false;
}

function containsReference(communication, reference) {
  const key = refKey(reference);
  // Only validated structured references can be trusted in unstructured text.
  if (!key || !structuredReference(reference)) return false;
  return token(communication).includes(key);
}

export function invoiceRecord(inv, source = '', options = {}) {
  const supplier = inv.supplier || {};
  const customer = inv.customer || {};
  const supplierVat = supplier.vat || supplier.legalId || '';
  const customerVat = customer.vat || customer.legalId || '';
  let direction = options.direction || 'sales';
  if (direction === 'mixed') {
    const mine = vat(options.ownVat);
    direction = mine && vat(supplierVat) === mine ? 'sales'
      : mine && vat(customerVat) === mine ? 'purchases' : 'unclassified';
  }
  const sales = direction === 'sales';
  const party = sales ? customer : supplier;
  const payment = inv.paymentMeans?.find((p) => p.iban || p.paymentId) || inv.paymentMeans?.[0] || {};
  const isCreditNote = inv.type === 'CreditNote';
  const errors = (options.issues || []).filter((x) => x.level === 'error').length;
  return {
    source, id: inv.id || '', type: inv.type || 'Invoice', issueDate: inv.issueDate || '',
    dueDate: inv.dueDate || '', amount: rounded(inv.totals?.payable?.value),
    currency: (inv.currency || 'EUR').toUpperCase(),
    supplier: supplier.registrationName || supplier.name || '', supplierVat,
    customer: customer.registrationName || customer.name || '', customerVat,
    counterparty: party.registrationName || party.name || '',
    counterpartyVat: sales ? customerVat : supplierVat,
    // The PayeeFinancialAccount is the supplier's account; never use it as
    // the customer's IBAN on outgoing sales invoices.
    counterpartyAccount: sales ? '' : iban(payment.iban),
    payeeIban: iban(payment.iban), payeeIbanValid: !!payment.iban && parseIban(payment.iban).valid,
    reference: payment.paymentId || '',
    direction, valid: !isCreditNote && !errors && direction !== 'unclassified' &&
      money(inv.totals?.payable?.value) > 0,
    issue: isCreditNote ? 'Credit note: manual accounting review required.'
      : errors ? 'Invoice failed validation; excluded from automatic allocation.'
        : direction === 'unclassified' ? 'Cannot determine sales/purchase direction from company VAT.'
          : money(inv.totals?.payable?.value) <= 0 ? 'Missing or non-positive amount due.' : '',
  };
}


// Importing the same UBL twice must not create another payable or paid invoice.
// Keep the first copy visible; mark subsequent copies for review, never payment.
export function markDuplicateInvoices(invoices) {
  const seen = new Set();
  return invoices.map((invoice) => {
    const id = token(invoice.id), seller = token(invoice.supplierVat);
    const key = seller && id ? [seller, id, invoice.issueDate, money(invoice.amount),
      invoice.currency, token(invoice.customerVat)].join('|') : '';
    if (!key) return invoice;
    if (seen.has(key)) return {
      ...invoice, valid: false, duplicate: true,
      issue: 'Duplicate invoice identity in this import. Inspect the original before payment.',
    };
    seen.add(key);
    return invoice;
  });
}

export function transactionRecord(tx, statement = {}, source = '') {
  const amount = rounded(tx.amount);
  return {
    id: tx.id || tx.bankReference || '',
    source: source || statement.file || '',
    bookingDate: tx.bookingDate || tx.valueDate || '',
    valueDate: tx.valueDate || '',
    amount, currency: (tx.currency || statement.account?.currency || 'EUR').toUpperCase(),
    counterparty: tx.counterparty?.name || '',
    counterpartyAccount: iban(tx.counterparty?.account),
    reference: tx.reference?.value || '',
    communication: tx.communication || '',
    endToEndId: tx.endToEndId || '',
    bankReference: tx.bankReference || '',
    statementNumber: statement.number || statement.id || '',
    statementFormat: statement.format || '',
    statementAccount: iban(statement.account?.iban || statement.account?.number),
    sequence: tx.sequence || tx.id || '',
    reversal: !!tx.reversal, isDetail: !!tx.isDetail,
    statementValid: !statement.checks?.some((c) => c.ok === false),
  };
}

// CODA/CAMT files often overlap by statement, day or export format.
// Preserve legitimately repeated equal-value payments unless bank identity agrees.
export function deduplicateTransactions(rows) {
  const seen = new Set();
  let duplicates = 0;
  const transactions = rows.filter((tx) => {
    const base = [tx.statementAccount, tx.bookingDate, money(tx.amount), tx.currency].join('|');
    const identity = tx.bankReference
      ? 'bank|' + base + '|' + token(tx.bankReference)
      : 'sequence|' + base + '|' + tx.statementNumber + '|' + tx.sequence + '|' + token(tx.reference) +
        '|' + token(tx.counterpartyAccount);
    const key = identity;
    if (seen.has(key)) { duplicates++; return false; }
    seen.add(key);
    return true;
  });
  return { transactions, duplicates };
}

function score(invoice, tx) {
  const reasons = [];
  if (invoice.valid === false || invoice.type === 'CreditNote' || invoice.direction === 'unclassified')
    return { score: -999, reasons: ['Invoice requires review'], strong: false };
  const direction = invoice.direction || 'sales';
  if ((direction === 'sales' && tx.amount <= 0) || (direction === 'purchases' && tx.amount >= 0))
    return { score: -999, reasons: ['Wrong payment direction'], strong: false };
  if (tx.reversal || tx.isDetail || tx.statementValid === false)
    return { score: -999, reasons: ['Bank entry needs statement review'], strong: false };
  if ((invoice.currency || 'EUR').toUpperCase() !== (tx.currency || 'EUR').toUpperCase())
    return { score: -999, reasons: ['Different currencies'], strong: false };
  if (direction === 'purchases' && invoice.counterpartyAccount && tx.counterpartyAccount &&
      iban(invoice.counterpartyAccount) !== iban(tx.counterpartyAccount))
    return { score: -999, reasons: ['Supplier IBAN contradicts statement'], strong: false };

  let total = 0;
  let strong = false;
  const invRef = refKey(invoice.reference);
  const txRef = refKey(tx.reference);
  const endRef = refKey(tx.endToEndId);
  const invId = refKey(invoice.id);
  if (invRef && (invRef === txRef || invRef === endRef)) {
    total += 110; strong = true; reasons.push('Exact payment reference');
  } else if (invRef && containsReference(tx.communication, invoice.reference)) {
    total += 90; strong = true; reasons.push('Structured reference in communication');
  } else if (invId && invId === endRef) {
    total += 90; strong = true; reasons.push('Invoice ID equals end-to-end ID');
  }
  const delta = Math.abs(money(tx.amount)) - money(invoice.amount);
  if (delta === 0) { total += 45; reasons.push('Exact amount'); }
  else if (Math.abs(delta) <= Math.max(100, Math.round(money(invoice.amount) * 0.02))) {
    total += 12; reasons.push('Near amount (check difference)');
  }
  if (invId && token(tx.communication).includes(invId) && invId.length >= 6) {
    total += 30; reasons.push('Invoice number in communication');
  }
  const name = invoice.counterparty || (direction === 'sales' ? invoice.customer : invoice.supplier);
  if (name && tx.counterparty) {
    const a = norm(name), b = norm(tx.counterparty);
    if (a.length >= 4 && b.length >= 4 && (a === b || a.includes(b) || b.includes(a))) {
      total += 20; reasons.push('Counterparty name');
    }
  }
  if (invoice.counterpartyAccount && tx.counterpartyAccount &&
      iban(invoice.counterpartyAccount) === iban(tx.counterpartyAccount)) {
    total += 35; reasons.push('Supplier IBAN');
  }
  const distance = days(invoice.issueDate, tx.bookingDate);
  if (distance !== null && distance <= 90) { total += 8; reasons.push('Date proximity'); }
  return { score: total, reasons, strong };
}

export function scoreInvoicePayment(invoice, tx) {
  return score(invoice, tx);
}

export function reconcileInvoices(invoices, transactions, { approvals = [], rejected = [] } = {}) {
  const allocatedInvoice = invoices.map(() => 0);
  const allocatedTx = transactions.map(() => 0);
  const matches = [];
  const invalidApprovals = [];
  const rejectedKeys = new Set(rejected);
  const pairKey = (ii, ti) => ii + ':' + ti;
  const candidates = [];

  invoices.forEach((invoice, ii) => transactions.forEach((tx, ti) => {
    const s = score(invoice, tx);
    if ((s.strong || s.score >= 45) && !rejectedKeys.has(pairKey(ii, ti)))
      candidates.push({ invoiceIndex: ii, transactionIndex: ti, ...s });
  }));
  candidates.sort((a, b) => b.score - a.score || a.invoiceIndex - b.invoiceIndex || a.transactionIndex - b.transactionIndex);

  function add(ii, ti, amountCents, confidence, reasons, scoreValue) {
    const invoice = invoices[ii], transaction = transactions[ti];
    if (!invoice || !transaction || !Number.isSafeInteger(amountCents) || amountCents < 1 ||
        score(invoice, transaction).score < 0) return false;
    const remainingInvoice = money(invoice.amount) - allocatedInvoice[ii];
    const remainingTx = Math.abs(money(transaction.amount)) - allocatedTx[ti];
    if (
        amountCents > remainingInvoice || amountCents > remainingTx) return false;
    allocatedInvoice[ii] += amountCents;
    allocatedTx[ti] += amountCents;
    matches.push({
      invoiceIndex: ii, transactionIndex: ti,
      invoice, transaction, amount: amountCents / 100, score: scoreValue,
      confidence, reasons, delta: rounded(Math.abs(transaction.amount) - invoice.amount),
      status: 'partial',
    });
    return true;
  }

  // Explicit user decisions take precedence over automatic suggestions.
  for (const p of approvals) {
    const ii = Number(p.invoiceIndex), ti = Number(p.transactionIndex);
    const candidate = candidates.find((c) => c.invoiceIndex === ii && c.transactionIndex === ti);
    const evidence = invoices[ii] && transactions[ti] ? score(invoices[ii], transactions[ti]) : null;
    const requested = money(p.amount);
    // A human can allocate a grouped transfer even without a fuzzy candidate,
    // but never override direction, currency, IBAN or statement-integrity blockers.
    if (!evidence || evidence.score < 0 || !add(ii, ti, requested, 'confirmed',
      ['Approved manually', ...evidence.reasons], evidence.score))
      invalidApprovals.push({ ...p, reason: 'Invalid, unsupported or over-allocated payment.' });
  }

  const byInvoice = new Map(), byTx = new Map();
  for (const c of candidates.filter((x) => x.strong)) {
    byInvoice.set(c.invoiceIndex, (byInvoice.get(c.invoiceIndex) || new Set()).add(c.transactionIndex));
    byTx.set(c.transactionIndex, (byTx.get(c.transactionIndex) || new Set()).add(c.invoiceIndex));
  }
  // Only unique, explicit references qualify for allocation without intervention.
  // Same amount alone, a fuzzy name and date NEVER justify booking a payment.
  for (const c of candidates) {
    if (!c.strong || byTx.get(c.transactionIndex)?.size !== 1) continue;
    const ii = c.invoiceIndex, ti = c.transactionIndex;
    const open = money(invoices[ii].amount) - allocatedInvoice[ii];
    const available = Math.abs(money(transactions[ti].amount)) - allocatedTx[ti];
    if (open <= 0 || available <= 0 || available > open) continue;
    // If a reference is shared across several invoices, manual review is mandatory.
    const sameRef = invoices.filter((inv, j) => j !== ii && inv.valid !== false &&
      refKey(inv.reference) && refKey(inv.reference) === refKey(invoices[ii].reference) &&
      inv.direction === invoices[ii].direction && inv.currency === invoices[ii].currency);
    if (sameRef.length) continue;
    add(ii, ti, available, 'matched', c.reasons, c.score);
  }

  const invoiceBalances = invoices.map((invoice, index) => ({
    invoice, invoiceIndex: index, allocated: allocatedInvoice[index] / 100,
    remaining: Math.max(0, money(invoice.amount) - allocatedInvoice[index]) / 100,
    status: invoice.valid === false ? 'needs-review'
      : allocatedInvoice[index] === 0 ? 'not-matched'
        : allocatedInvoice[index] >= money(invoice.amount) ? 'paid' : 'partially-matched',
  }));
  for (const match of matches) match.status = invoiceBalances[match.invoiceIndex].status;

  const pending = candidates.filter((c) => {
    const open = money(invoices[c.invoiceIndex].amount) - allocatedInvoice[c.invoiceIndex];
    const available = Math.abs(money(transactions[c.transactionIndex].amount)) - allocatedTx[c.transactionIndex];
    return open > 0 && available > 0;
  }).map((c) => ({
    ...c, suggestedAmount: Math.min(
      money(invoices[c.invoiceIndex].amount) - allocatedInvoice[c.invoiceIndex],
      Math.abs(money(transactions[c.transactionIndex].amount)) - allocatedTx[c.transactionIndex]
    ) / 100,
  }));
  const duplicates = candidates.filter((c) =>
    c.strong && allocatedInvoice[c.invoiceIndex] >= money(invoices[c.invoiceIndex].amount) &&
    allocatedTx[c.transactionIndex] === 0 && money(invoices[c.invoiceIndex].amount) > 0
  ).map((c) => ({
    invoice: invoices[c.invoiceIndex], transaction: transactions[c.transactionIndex],
    score: c.score, reasons: c.reasons,
  }));
  return {
    matches,
    candidates: pending,
    invoiceBalances,
    transactionBalances: transactions.map((transaction, index) => ({
      transaction, transactionIndex: index,
      remaining: Math.max(0, Math.abs(money(transaction.amount)) - allocatedTx[index]) / 100,
    })),
    unmatchedInvoices: invoices.filter((_, i) => allocatedInvoice[i] === 0),
    outstandingInvoices: invoiceBalances.filter((x) => x.remaining > 0),
    unmatchedTransactions: transactions.filter((_, i) => allocatedTx[i] === 0),
    duplicates, invalidApprovals,
  };
}
