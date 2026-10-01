const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const amt = (v) => Math.round((Number(v)||0)*100)/100;
const days = (a,b) => {
  const x=Date.parse(a||''), y=Date.parse(b||'');
  return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/86400000:null;
};
const ref = (v) => String(v||'').replace(/\s/g,'').toUpperCase();

export function invoiceRecord(inv, source='') {
  return {
    source,
    id: inv.id || '',
    issueDate: inv.issueDate || '',
    dueDate: inv.dueDate || '',
    amount: amt(inv.totals?.payable?.value),
    currency: inv.currency || 'EUR',
    customer: inv.customer?.registrationName || inv.customer?.name || '',
    customerVat: inv.customer?.vat || inv.customer?.legalId || '',
    reference: inv.paymentMeans?.[0]?.paymentId || '',
  };
}

export function transactionRecord(t, statement={}) {
  return {
    id:t.id||t.bankReference||'',
    bookingDate:t.bookingDate||t.valueDate||'',
    amount:amt(t.amount),
    currency:t.currency||statement.account?.currency||'EUR',
    counterparty:t.counterparty?.name||'',
    counterpartyAccount:t.counterparty?.account||'',
    reference:t.reference?.value||'',
    communication:t.communication||'',
    endToEndId:t.endToEndId||'',
  };
}

export function scoreInvoicePayment(invoice, tx) {
  if (tx.amount <= 0) return {score:-999,reasons:['outgoing transaction']};
  let score=0;
  const reasons=[];
  const invRef=ref(invoice.reference);
  const txRef=ref(tx.reference);
  const comm=norm(tx.communication+' '+tx.endToEndId);
  if(invRef && txRef && invRef===txRef){ score+=100; reasons.push('payment reference'); }
  else if(invRef && norm(tx.communication).includes(norm(invoice.reference))){ score+=85; reasons.push('reference in communication'); }
  if(invoice.amount && Math.abs(amt(tx.amount)-amt(invoice.amount))<0.005){ score+=45; reasons.push('exact amount'); }
  else if(invoice.amount){
    const delta=Math.abs(amt(tx.amount)-amt(invoice.amount));
    if(delta <= Math.max(1,invoice.amount*.02)){ score+=15; reasons.push('near amount'); }
  }
  if(invoice.id && comm.includes(norm(invoice.id))){ score+=35; reasons.push('invoice number'); }
  if(invoice.customer && tx.counterparty && (norm(invoice.customer).includes(norm(tx.counterparty))||norm(tx.counterparty).includes(norm(invoice.customer)))){
    score+=20; reasons.push('customer name');
  }
  const d=days(invoice.issueDate,tx.bookingDate);
  if(d!==null && d<=90){ score+=10; reasons.push('date proximity'); }
  return {score,reasons};
}

export function reconcileInvoices(invoices, transactions) {
  const candidates=[];
  invoices.forEach((inv,ii)=>transactions.forEach((tx,ti)=>{
    const s=scoreInvoicePayment(inv,tx);
    if(s.score>0) candidates.push({ii,ti,...s});
  }));
  candidates.sort((a,b)=>b.score-a.score);
  const usedI=new Set(), usedT=new Set(), matches=[];
  for(const c of candidates){
    if(usedI.has(c.ii)||usedT.has(c.ti)) continue;
    if(c.score<45) continue;
    usedI.add(c.ii); usedT.add(c.ti);
    const inv=invoices[c.ii], tx=transactions[c.ti];
    const delta=amt(tx.amount-inv.amount);
    const confidence=c.score>=100?'matched':c.score>=65?'probable':'review';
    matches.push({invoice:inv,transaction:tx,score:c.score,confidence,reasons:c.reasons,delta,status:Math.abs(delta)<0.005?'paid':delta>0?'overpaid':'underpaid'});
  }
  const unmatchedInvoices=invoices.filter((_,i)=>!usedI.has(i));
  const unmatchedTransactions=transactions.filter((_,i)=>!usedT.has(i));
  const duplicates=[];
  for(const m of matches){
    for(const tx of unmatchedTransactions){
      const s=scoreInvoicePayment(m.invoice,tx);
      if(s.score>=100) duplicates.push({invoice:m.invoice,transaction:tx,score:s.score,reasons:s.reasons});
    }
  }
  return {matches,unmatchedInvoices,unmatchedTransactions,duplicates};
}
