import { parseIban, parseOgm, parseRf } from './ids.js';

const x = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const clean = (v, max=35) => String(v ?? '').trim().replace(/\s+/g,' ').slice(0,max);
const amount = (v) => (Math.round((Number(v) + Number.EPSILON) * 100) / 100).toFixed(2);
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const iban = (v) => String(v||'').replace(/\s/g,'').toUpperCase();

export function validatePain001Input(input={}) {
  const issues=[];
  const err=(where,message)=>issues.push({level:'error',where,message});
  const warn=(where,message)=>issues.push({level:'warning',where,message});
  const debtor=input.debtor||{};
  const dib=parseIban(debtor.iban||'');
  if(!clean(input.messageId)) err('Message ID','Required.');
  if(!clean(input.batchId)) err('Batch ID','Required.');
  if(!debtor.name) err('Debtor','Name is required.');
  if(!dib.valid) err('Debtor IBAN',dib.errors.join(' ')||'Invalid IBAN.');
  if(!isoDate(input.executionDate)) err('Execution date','Use YYYY-MM-DD.');
  const payments=input.payments||[];
  if(!payments.length) err('Payments','Add at least one payment.');
  const seen=new Set();
  payments.forEach((p,i)=>{
    const at='Payment '+(i+1);
    if(!p.name) err(at,'Creditor name is required.');
    const ib=parseIban(p.iban||'');
    if(!ib.valid) err(at+' IBAN',ib.errors.join(' ')||'Invalid IBAN.');
    const a=Number(p.amount);
    if(!Number.isFinite(a)||a<=0) err(at+' amount','Amount must be above zero.');
    if((p.currency||'EUR').toUpperCase()!=='EUR') err(at+' currency','SEPA Credit Transfer payments must be in EUR.');
    const e2e=clean(p.endToEndId||'NOTPROVIDED');
    if(seen.has(e2e)&&e2e!=='NOTPROVIDED') warn(at+' EndToEndId','Duplicate EndToEndId in this batch.');
    seen.add(e2e);
    const ref=String(p.reference||'').trim();
    if(ref){
      const d=ref.replace(/\D/g,'');
      if(d.length===12 && /^[\d+*/\s]+$/.test(ref) && !parseOgm(ref).valid) warn(at+' reference','Looks like an OGM but its checksum is invalid.');
      if(/^RF/i.test(ref.replace(/\s/g,'')) && !parseRf(ref).valid) warn(at+' reference','RF creditor reference checksum is invalid.');
    }
  });
  return issues;
}

function remittanceXml(ref){
  const raw=String(ref||'').trim();
  if(!raw) return '';
  const compact=raw.replace(/\s/g,'');
  const rf=parseRf(raw);
  if(/^RF/i.test(compact) && rf.valid){
    return '<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>'+x(compact)+'</Ref></CdtrRefInf></Strd></RmtInf>';
  }
  return '<RmtInf><Ustrd>'+x(clean(raw,140))+'</Ustrd></RmtInf>';
}

function agentXml(tag,bic){
  const b=String(bic||'').replace(/\s/g,'').toUpperCase();
  return '<'+tag+'><FinInstnId>'+(b?'<BICFI>'+x(b)+'</BICFI>':'<Othr><Id>NOTPROVIDED</Id></Othr>')+'</FinInstnId></'+tag+'>';
}

export function buildPain001(input={}) {
  const issues=validatePain001Input(input);
  const errors=issues.filter(i=>i.level==='error');
  if(errors.length) throw new Error(errors.map(e=>e.where+': '+e.message).join(' '));
  const payments=input.payments||[];
  const ctrl=Math.round((payments.reduce((s,p)=>s+Number(p.amount),0)+Number.EPSILON)*100)/100;
  const now=input.createdAt||new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const debtor=input.debtor||{};
  const instant=input.mode==='INST';
  const txs=payments.map((p,i)=>{
    const e2e=clean(p.endToEndId||'NOTPROVIDED');
    return '<CdtTrfTxInf>'+
      '<PmtId><InstrId>'+x(clean(p.instructionId||('TX-'+(i+1))))+'</InstrId><EndToEndId>'+x(e2e)+'</EndToEndId></PmtId>'+
      '<Amt><InstdAmt Ccy="EUR">'+amount(p.amount)+'</InstdAmt></Amt>'+
      agentXml('CdtrAgt',p.bic)+
      '<Cdtr><Nm>'+x(clean(p.name,70))+'</Nm></Cdtr>'+
      '<CdtrAcct><Id><IBAN>'+x(iban(p.iban))+'</IBAN></Id></CdtrAcct>'+
      remittanceXml(p.reference||p.communication)+
    '</CdtTrfTxInf>';
  }).join('');
  const service='<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl>'+(instant?'<LclInstrm><Cd>INST</Cd></LclInstrm>':'')+'</PmtTpInf>';
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn>'+
    '<GrpHdr><MsgId>'+x(clean(input.messageId))+'</MsgId><CreDtTm>'+x(now)+'</CreDtTm><NbOfTxs>'+payments.length+'</NbOfTxs><CtrlSum>'+amount(ctrl)+'</CtrlSum><InitgPty><Nm>'+x(clean(input.initiatingParty||debtor.name,70))+'</Nm></InitgPty></GrpHdr>'+
    '<PmtInf><PmtInfId>'+x(clean(input.batchId))+'</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>'+payments.length+'</NbOfTxs><CtrlSum>'+amount(ctrl)+'</CtrlSum>'+
    service+'<ReqdExctnDt><Dt>'+x(input.executionDate)+'</Dt></ReqdExctnDt><Dbtr><Nm>'+x(clean(debtor.name,70))+'</Nm></Dbtr><DbtrAcct><Id><IBAN>'+x(iban(debtor.iban))+'</IBAN></Id></DbtrAcct>'+
    agentXml('DbtrAgt',debtor.bic)+'<ChrgBr>SLEV</ChrgBr>'+txs+'</PmtInf></CstmrCdtTrfInitn></Document>\n';
  return {xml,issues,count:payments.length,controlSum:ctrl};
}
