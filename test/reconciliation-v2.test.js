import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceRecord, transactionRecord, scoreInvoicePayment,
  deduplicateTransactions, markDuplicateInvoices, reconcileInvoices,
} from '../src/be/reconciliation.js';

const invoice = (overrides = {}) => ({
  id: 'INV-2026-001', amount: 100, currency: 'EUR',
  issueDate: '2026-10-01', dueDate: '2026-10-31',
  direction: 'sales', customer: 'Acme BV', counterparty: 'Acme BV',
  reference: 'RF18539007547034', valid: true, ...overrides,
});
const tx = (overrides = {}) => ({
  id: 'txn-1', bookingDate: '2026-10-15', amount: 100, currency: 'EUR',
  counterparty: 'Acme BV', reference: 'RF18539007547034',
  statementValid: true, ...overrides,
});

test('amount-only matches never automatically allocate funds', () => {
  const r = reconcileInvoices([invoice({ reference: '', counterparty: '' })],
    [tx({ reference: '', counterparty: '', communication: '', endToEndId: '' })]);
  assert.equal(r.matches.length, 0);
  assert.equal(r.invoiceBalances[0].status, 'not-matched');
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].suggestedAmount, 100);
});

test('an explicit reference and amount uniquely allocate payment', () => {
  const r = reconcileInvoices([invoice()], [tx()]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].confidence, 'matched');
  assert.equal(r.matches[0].status, 'paid');
  assert.equal(r.invoiceBalances[0].remaining, 0);
});

test('multiple installments on one reference complete the same invoice', () => {
  const r = reconcileInvoices([invoice()], [tx({ id: 'a', amount: 35 }),
    tx({ id: 'b', amount: 65, bookingDate: '2026-10-18' })]);
  assert.equal(r.matches.length, 2);
  assert.equal(r.matches.reduce((sum, m) => sum + m.amount, 0), 100);
  assert.equal(r.invoiceBalances[0].status, 'paid');
});

test('a partial matching installment leaves a remaining amount', () => {
  const r = reconcileInvoices([invoice()], [tx({ amount: 37 })]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.invoiceBalances[0].remaining, 63);
  assert.equal(r.invoiceBalances[0].status, 'partially-matched');
});

test('shared payment references are not auto-booked to one of two invoices', () => {
  const r = reconcileInvoices([invoice(), invoice({ id: 'INV-2026-002' })], [tx()]);
  assert.equal(r.matches.length, 0);
  assert.equal(r.candidates.length, 2);
});

test('manually allocate a combined bank transfer across two invoices', () => {
  const inv = [invoice({ id: 'INV-2026-001', amount: 80, reference: 'INV-2026-001' }),
    invoice({ id: 'INV-2026-002', amount: 70, reference: 'INV-2026-002' })];
  const bank = [tx({ reference: 'INV-2026-001', amount: 150, counterparty: 'Acme BV' })];
  const before = reconcileInvoices(inv, bank);
  assert.equal(before.matches.length, 0);
  const r = reconcileInvoices(inv, bank, { approvals: [
    { invoiceIndex: 0, transactionIndex: 0, amount: 80 },
    { invoiceIndex: 1, transactionIndex: 0, amount: 70 },
  ] });
  assert.equal(r.matches.length, 2);
  assert.equal(r.invoiceBalances.filter((b) => b.status === 'paid').length, 2);
  assert.equal(r.transactionBalances[0].remaining, 0);
  assert.equal(r.invalidApprovals.length, 0);
});

test('manual approval cannot allocate more than the invoice or bank balance', () => {
  const r = reconcileInvoices([invoice()], [tx()], { approvals: [
    { invoiceIndex: 0, transactionIndex: 0, amount: 101 },
  ] });
  assert.equal(r.invalidApprovals.length, 1);
  assert.equal(r.matches.length, 1); // the unique exact match may still auto-allocate
  assert.equal(r.invoiceBalances[0].remaining, 0);
});

test('supplier debit matches the supplier IBAN, not the customer account', () => {
  const inv = invoice({ direction: 'purchases', supplier: 'Vendor BV', counterparty: 'Vendor BV',
    counterpartyAccount: 'BE73735012345660', reference: 'RF18539007547034' });
  const bank = tx({ amount: -100, counterparty: 'Vendor BV',
    counterpartyAccount: 'BE73735012345660' });
  const r = reconcileInvoices([inv], [bank]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.invoiceBalances[0].status, 'paid');
  assert.equal(scoreInvoicePayment(inv, { ...bank, counterpartyAccount: 'BE00000000000000' }).score, -999);
  assert.equal(scoreInvoicePayment(inv, { ...bank, amount: 100 }).score, -999);
});

test('cross-currency, reversal, and unreliable statement entries never auto-match', () => {
  const inv = invoice();
  for (const bad of [tx({ currency: 'USD' }), tx({ reversal: true }),
    tx({ statementValid: false }), tx({ isDetail: true })]) {
    assert.equal(reconcileInvoices([inv], [bad]).matches.length, 0);
  }
});

test('credit notes and invalid invoice records are excluded', () => {
  const make = (type, issues = []) => invoiceRecord({
    type, id: 'CR-123', supplier: { vat: 'BE0123456789', registrationName: 'Me' },
    customer: { vat: 'BE0987654321', registrationName: 'Acme BV' },
    paymentMeans: [{ iban: 'BE73735012345660', paymentId: 'RF18539007547034' }],
    totals: { payable: { value: 100 } }, currency: 'EUR',
  }, 'credit.xml', { direction: 'sales', issues });
  assert.equal(make('CreditNote').valid, false);
  assert.equal(make('Invoice', [{ level: 'error' }]).valid, false);
  assert.equal(reconcileInvoices([make('CreditNote')], [tx()]).matches.length, 0);
});

test('mixed import only recognizes invoices tied to the company VAT', () => {
  const ubl = {
    type: 'Invoice', id: 'BILL-1', currency: 'EUR', totals: { payable: { value: 225.25 } },
    supplier: { vat: 'BE0987654321', registrationName: 'Vendor' },
    customer: { vat: 'BE0123456789', registrationName: 'Me' },
    paymentMeans: [{ iban: 'BE73735012345660', paymentId: 'RF18539007547034' }],
  };
  const payable = invoiceRecord(ubl, 'vendor.xml', { direction: 'mixed', ownVat: 'BE0123456789' });
  assert.equal(payable.direction, 'purchases');
  assert.equal(payable.counterpartyAccount, 'BE73735012345660');
  assert.equal(payable.valid, true);
  const unknown = invoiceRecord(ubl, 'vendor.xml', { direction: 'mixed', ownVat: 'BE0000000000' });
  assert.equal(unknown.valid, false);
});

test('duplicated CODA/CAMT exports do not double count the same bank reference', () => {
  const bankA = transactionRecord({ bankReference: 'BANK-123', bookingDate: '2026-10-15',
    amount: 100, reference: { value: 'RF18539007547034' } }, {
    account: { iban: 'BE73735012345660' }, number: '0101', format: 'CODA',
  }, 'coda.txt');
  const bankB = transactionRecord({ bankReference: 'BANK-123', bookingDate: '2026-10-15',
    amount: 100, reference: { value: 'RF18539007547034' } }, {
    account: { iban: 'BE73735012345660' }, number: '0101', format: 'CAMT.053',
  }, 'camt.xml');
  const r = deduplicateTransactions([bankA, bankB]);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.duplicates, 1);
  assert.equal(r.transactions[0].statementNumber, '0101');
  assert.equal(r.transactions[0].source, 'coda.txt');
});

test('an excess payment requires manual allocation; excess stays unallocated', () => {
  const r = reconcileInvoices([invoice()], [tx({ amount: 120 })]);
  assert.equal(r.matches.length, 0);
  assert.equal(r.candidates.length, 1);
  const confirmed = reconcileInvoices([invoice()], [tx({ amount: 120 })], {
    approvals: [{ invoiceIndex: 0, transactionIndex: 0, amount: 100 }],
  });
  assert.equal(confirmed.invoiceBalances[0].status, 'paid');
  assert.equal(confirmed.transactionBalances[0].remaining, 20);
});


test('duplicate invoice uploads cannot be reconciled or sent for a second payment', () => {
  const first = invoice({ supplierVat: 'BE0123456789', customerVat: 'BE0987654321' });
  const second = { ...first, source: 'duplicate-file.xml' };
  const rows = markDuplicateInvoices([first, second]);
  assert.equal(rows[0].valid, true);
  assert.equal(rows[1].valid, false);
  assert.equal(rows[1].duplicate, true);
  const r = reconcileInvoices(rows, [tx()]);
  assert.equal(r.invoiceBalances[0].status, 'paid');
  assert.equal(r.invoiceBalances[1].status, 'needs-review');
});
