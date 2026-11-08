import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInvoices, markDuplicateInvoices } from '../src/be/reconciliation.js';

const inv = (fields = {}) => ({
  id: 'INV-1', supplierVat: 'BE0123456789', customerVat: 'BE0987654321',
  amount: 100, currency: 'EUR', direction: 'sales', valid: true,
  reference: 'RF18539007547034', issueDate: '2026-10-01', ...fields,
});
const tx = (fields = {}) => ({
  amount: 100, currency: 'EUR', reference: 'RF18539007547034',
  bookingDate: '2026-10-12', statementValid: true, ...fields,
});

test('amount-only is review, not proof of payment', () => {
  const result = reconcileInvoices([inv({reference: ''})], [tx({reference: ''})]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.invoiceBalances[0].remaining, 100);
});

test('reference-led installments add up without over-allocation', () => {
  const result = reconcileInvoices([inv()], [tx({amount: 35}), tx({amount: 65})]);
  assert.equal(result.matches.length, 2);
  assert.equal(result.invoiceBalances[0].remaining, 0);
  assert.equal(result.invoiceBalances[0].status, 'paid');
});

test('supplier payments use debits and block contradictory IBANs', () => {
  const bill = inv({direction:'purchases', counterpartyAccount:'BE73735012345660'});
  assert.equal(reconcileInvoices([bill], [tx({amount:-100,counterpartyAccount:'BE73735012345660'})]).matches.length, 1);
  assert.equal(reconcileInvoices([bill], [tx({amount:100,counterpartyAccount:'BE73735012345660'})]).matches.length, 0);
  assert.equal(reconcileInvoices([bill], [tx({amount:-100,counterpartyAccount:'BE00000000000000'})]).matches.length, 0);
});

test('duplicate invoices, conflicting references and foreign currencies stay safe', () => {
  const invoices = markDuplicateInvoices([inv(), inv()]);
  assert.equal(invoices[1].valid, false);
  assert.equal(reconcileInvoices(invoices, [tx()]).matches.length, 1);
  assert.equal(reconcileInvoices([inv(), inv({id:'INV-2'})], [tx()]).matches.length, 0);
  assert.equal(reconcileInvoices([inv()], [tx({currency:'USD'})]).matches.length, 0);
});
