import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPain001, validatePain001Input } from '../src/be/pain001.js';
import { parseXml } from '../src/xml.js';
import { reconcileInvoices, scoreInvoicePayment } from '../src/be/reconciliation.js';
import { auditInvoices } from '../src/be/invoice-audit.js';

test('pain.001.001.09 batch has current namespace, transaction count and control sum', () => {
  const input = {
    messageId:'PAY-20261001-001', batchId:'BATCH-001', executionDate:'2026-10-02',
    debtor:{name:'Example BV',iban:'BE73735012345660'},
    payments:[
      {name:'Supplier A',iban:'BE73735012345660',amount:100,reference:'RF18 5390 0754 7034',endToEndId:'INV-1'},
      {name:'Supplier B',iban:'BE73735012345660',amount:24.5,reference:'Invoice 2',endToEndId:'INV-2'},
    ],
    createdAt:'2026-10-01T18:00:00Z',
  };
  const out=buildPain001(input);
  assert.equal(out.count,2);
  assert.equal(out.controlSum,124.5);
  assert.match(out.xml,/urn:iso:std:iso:20022:tech:xsd:pain\.001\.001\.09/);
  assert.match(out.xml,/<NbOfTxs>2<\/NbOfTxs>/);
  assert.match(out.xml,/<CtrlSum>124\.50<\/CtrlSum>/);
  assert.match(out.xml,/<Cd>SCOR<\/Cd>/);
  assert.doesNotThrow(()=>parseXml(out.xml));
});

test('pain builder validates IBAN, amount and duplicate end-to-end IDs', () => {
  const issues=validatePain001Input({
    messageId:'x',batchId:'b',executionDate:'2026-10-02',debtor:{name:'Me',iban:'BE00BAD'},
    payments:[{name:'A',iban:'BE00BAD',amount:0,endToEndId:'DUP'},{name:'B',iban:'BE73735012345660',amount:5,endToEndId:'DUP'}],
  });
  assert.ok(issues.some((x)=>x.level==='error' && /Debtor IBAN/.test(x.where)));
  assert.ok(issues.some((x)=>x.level==='error' && /amount/.test(x.where)));
  assert.ok(issues.some((x)=>x.level==='warning' && /Duplicate EndToEndId/.test(x.message)));
});

test('reconciliation strongly prefers exact payment reference and amount', () => {
  const inv={id:'INV-42',issueDate:'2026-09-01',amount:121,customer:'Demo Retail',reference:'+++123/4567/89012+++'};
  const tx={bookingDate:'2026-09-15',amount:121,counterparty:'Demo Retail NV',reference:'+++123/4567/89012+++',communication:'INV-42'};
  const s=scoreInvoicePayment(inv,tx);
  assert.ok(s.score>=180);
  const r=reconcileInvoices([inv],[tx]);
  assert.equal(r.matches.length,1);
  assert.equal(r.matches[0].confidence,'matched');
  assert.equal(r.matches[0].status,'paid');
});

test('reconciliation reports unmatched and duplicate-looking credits', () => {
  const invoices=[{id:'INV-1',issueDate:'2026-09-01',amount:100,customer:'A',reference:'RF18539007547034'}];
  const tx=[
    {id:'t1',bookingDate:'2026-09-02',amount:100,counterparty:'A',reference:'RF18539007547034',communication:''},
    {id:'t2',bookingDate:'2026-09-03',amount:100,counterparty:'A',reference:'RF18539007547034',communication:''},
  ];
  const r=reconcileInvoices(invoices,tx);
  assert.equal(r.matches.length,1);
  assert.equal(r.unmatchedTransactions.length,1);
  assert.equal(r.duplicates.length,1);
});

test('invoice batch audit finds duplicates, errors, VAT totals and overdue invoices', () => {
  const make=(id,source,issues=[])=>({
    source,issues,inv:{
      id,issueDate:'2026-08-01',dueDate:'2026-09-01',currency:'EUR',
      supplier:{registrationName:'Seller',vat:'BE0753124628'},
      customer:{registrationName:'Buyer',vat:'BE0864213778'},
      paymentMeans:[{paymentId:'RF18539007547034'}],
      totals:{taxExclusive:{value:100},taxInclusive:{value:121},payable:{value:121}},
      taxTotals:[{amount:{value:21},subtotals:[{category:'S',percent:21,taxable:{value:100},tax:{value:21}}]}],
    },
  });
  const audit=auditInvoices([make('INV-1','a.xml'),make('INV-1','b.xml',[{level:'error'}])],{today:'2026-10-01'});
  assert.equal(audit.summary.invoices,2);
  assert.equal(audit.summary.errors,1);
  assert.equal(audit.summary.overdue,2);
  assert.equal(audit.summary.duplicateInvoiceNumbers,1);
  assert.equal(audit.summary.duplicateFingerprints,1);
  assert.equal(audit.vat[0].tax,42);
});
