const round2=(n)=>Math.round((Number(n)||0)*100)/100;
const key=(v)=>String(v??'').trim().toLowerCase();

export function auditInvoices(items, { today = new Date().toISOString().slice(0,10) } = {}) {
  const rows=items.map((item,index)=>{
    const inv=item.inv;
    const errors=(item.issues||[]).filter((x)=>x.level==='error');
    const warnings=(item.issues||[]).filter((x)=>x.level==='warning');
    const tax=inv.taxTotals?.find((t)=>t.subtotals?.length)||inv.taxTotals?.[0];
    return {
      index,source:item.source||'',id:inv.id||'',issueDate:inv.issueDate||'',dueDate:inv.dueDate||'',
      currency:inv.currency||'',seller:inv.supplier?.registrationName||inv.supplier?.name||'',
      sellerId:inv.supplier?.vat||inv.supplier?.legalId||inv.supplier?.endpointId||'',
      customer:inv.customer?.registrationName||inv.customer?.name||'',
      customerId:inv.customer?.vat||inv.customer?.legalId||inv.customer?.endpointId||'',
      net:round2(inv.totals?.taxExclusive?.value),vat:round2(tax?.amount?.value),
      gross:round2(inv.totals?.taxInclusive?.value),payable:round2(inv.totals?.payable?.value),
      reference:inv.paymentMeans?.[0]?.paymentId||'',errors:errors.length,warnings:warnings.length,
      overdue:!!inv.dueDate && inv.dueDate < today && round2(inv.totals?.payable?.value)>0,
      fingerprint:key([inv.supplier?.vat||inv.supplier?.legalId,inv.id,inv.issueDate,round2(inv.totals?.payable?.value),inv.currency].join('|')),
      vatBreakdown:(tax?.subtotals||[]).map((s)=>({category:s.category||'',rate:Number(s.percent)||0,taxable:round2(s.taxable?.value),tax:round2(s.tax?.value)})),
    };
  });
  const duplicateInvoiceNumbers=[];
  const byId=new Map();
  rows.forEach((r)=>{
    const k=key(r.sellerId+'|'+r.id);
    if(!r.id) return;
    if(!byId.has(k)) byId.set(k,[]);
    byId.get(k).push(r);
  });
  for(const list of byId.values()) if(list.length>1) duplicateInvoiceNumbers.push(list);
  const duplicateFingerprints=[];
  const byFp=new Map();
  rows.forEach((r)=>{ if(!byFp.has(r.fingerprint)) byFp.set(r.fingerprint,[]); byFp.get(r.fingerprint).push(r); });
  for(const list of byFp.values()) if(list.length>1) duplicateFingerprints.push(list);
  const bySeller=new Map(), byCustomer=new Map(), vat=new Map();
  const add=(map,k,n)=>map.set(k,round2((map.get(k)||0)+n));
  for(const r of rows){
    add(bySeller,r.seller||r.sellerId||'(unknown)',r.payable);
    add(byCustomer,r.customer||r.customerId||'(unknown)',r.payable);
    for(const v of r.vatBreakdown){
      const k=v.category+' '+v.rate+'%';
      const cur=vat.get(k)||{category:v.category,rate:v.rate,taxable:0,tax:0};
      cur.taxable=round2(cur.taxable+v.taxable); cur.tax=round2(cur.tax+v.tax); vat.set(k,cur);
    }
  }
  return {
    rows,
    summary:{
      invoices:rows.length,
      totalPayable:round2(rows.reduce((s,r)=>s+r.payable,0)),
      errors:rows.reduce((s,r)=>s+r.errors,0),
      warnings:rows.reduce((s,r)=>s+r.warnings,0),
      overdue:rows.filter((r)=>r.overdue).length,
      duplicateInvoiceNumbers:duplicateInvoiceNumbers.length,
      duplicateFingerprints:duplicateFingerprints.length,
    },
    duplicateInvoiceNumbers,duplicateFingerprints,
    bySeller:[...bySeller].map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total),
    byCustomer:[...byCustomer].map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total),
    vat:[...vat.values()].sort((a,b)=>a.rate-b.rate),
  };
}

export function auditRowsCsvRows(audit){
  const head=['source','invoice_id','issue_date','due_date','seller','seller_id','customer','customer_id','currency','net','vat','gross','payable','payment_reference','errors','warnings','overdue'];
  return [head,...audit.rows.map((r)=>[r.source,r.id,r.issueDate,r.dueDate,r.seller,r.sellerId,r.customer,r.customerId,r.currency,r.net.toFixed(2),r.vat.toFixed(2),r.gross.toFixed(2),r.payable.toFixed(2),r.reference,r.errors,r.warnings,r.overdue?'yes':'no'])];
}
