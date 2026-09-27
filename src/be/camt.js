// ISO 20022 CAMT.052/053/054 (bank-to-customer statements and notifications)
// → common statement schema. Works for versions .001.02 - .001.13.

import { find, findAll, val, text, attr, elements } from '../xml.js';
import { classifyReference } from './statement.js';
import { belgianBank } from './ids.js';

const amt = (node) => (node ? Number(text(node)) : null);
const dateOf = (node) => (node ? (val(node, 'Dt') || val(node, 'DtTm') || '').slice(0, 10) || null : null);
const partyName = (node) => (node ? val(node, 'Nm') || val(node, 'Pty/Nm') : '');
const acctId = (node) => (node ? val(node, 'Id/IBAN') || val(node, 'Id/Othr/Id') : '');

export function camtKind(root) {
  const ns = root.ns || '';
  const m = /camt\.(05[234])\.001\.(\d+)/.exec(ns);
  return m ? { message: `camt.${m[1]}`, version: m[2] } : null;
}

export function isCamt(root) {
  return root.local === 'Document' && !!camtKind(root);
}

const DOMAIN = { PMNT: 'Payments', CAMT: 'Cash management', DERV: 'Derivatives', LDAS: 'Loans & deposits', SECU: 'Securities', FORX: 'Foreign exchange', XTND: 'Extended', ACMT: 'Account management', CMDT: 'Commodities', TRAD: 'Trade services' };
const FAMILY = { RCDT: 'Received credit transfer', ICDT: 'Issued credit transfer', RDDT: 'Received direct debit', IDDT: 'Issued direct debit', CCRD: 'Customer card transaction', MCRD: 'Merchant card transaction', CNTR: 'Counter transaction', CHRG: 'Charges', INTR: 'Interest', RRCT: 'Received real-time credit transfer', IRCT: 'Issued real-time credit transfer', DRFT: 'Drafts', MCOP: 'Miscellaneous credit operations', MDOP: 'Miscellaneous debit operations', LBOX: 'Lockbox', ICHQ: 'Issued cheques', RCHQ: 'Received cheques', CAPL: 'Cash pooling', ACCB: 'Account balancing', OTHR: 'Other' };

function bankTxCode(node) {
  const b = find(node, 'BkTxCd');
  if (!b) return null;
  const dom = val(b, 'Domn/Cd');
  const fam = val(b, 'Domn/Fmly/Cd');
  const sub = val(b, 'Domn/Fmly/SubFmlyCd');
  const prop = val(b, 'Prtry/Cd');
  const code = dom ? `${dom}/${fam}/${sub}` : prop;
  const description = dom ? [DOMAIN[dom] || dom, FAMILY[fam] || fam, sub].filter(Boolean).join(' · ') : `Proprietary ${prop}${val(b, 'Prtry/Issr') ? ` (${val(b, 'Prtry/Issr')})` : ''}`;
  return { code, description, proprietary: prop || undefined };
}

function reference(tx) {
  // Structured creditor reference: ISO RF (SCOR) or Belgian OGM (proprietary "BBA").
  const s = find(tx, 'RmtInf/Strd/CdtrRefInf');
  if (s) {
    const ref = val(s, 'Ref');
    const typeCd = val(s, 'Tp/CdOrPrtry/Cd') || val(s, 'Tp/CdOrPrtry/Prtry');
    const r = classifyReference(ref);
    if (r) return { ...r, scheme: typeCd || undefined };
  }
  return null;
}

function entryTransactions(entry, currency) {
  const sign = val(entry, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
  const entryAmount = amt(find(entry, 'Amt'));
  const base = {
    bookingDate: dateOf(find(entry, 'BookgDt')),
    valueDate: dateOf(find(entry, 'ValDt')),
    currency: attr(find(entry, 'Amt'), 'Ccy') || currency,
    direction: sign < 0 ? 'debit' : 'credit',
    bankReference: val(entry, 'AcctSvcrRef'),
    status: val(entry, 'Sts/Cd') || val(entry, 'Sts'),
    reversal: val(entry, 'RvslInd') === 'true',
    code: bankTxCode(entry),
  };
  const txs = findAll(entry, 'NtryDtls/TxDtls');
  if (!txs.length) return [{ ...base, amount: sign * entryAmount, communication: val(entry, 'AddtlNtryInf'), counterparty: {} }];
  return txs.map((tx) => {
    const txAmount = amt(find(tx, 'Amt')) ?? amt(find(tx, 'AmtDtls/TxAmt/Amt')) ?? (txs.length === 1 ? entryAmount : null);
    const txSign = val(tx, 'CdtDbtInd') ? (val(tx, 'CdtDbtInd') === 'DBIT' ? -1 : 1) : sign;
    const rp = find(tx, 'RltdPties');
    const agents = find(tx, 'RltdAgts');
    const cp = txSign > 0
      ? { name: partyName(find(rp, 'Dbtr')), account: acctId(find(rp, 'DbtrAcct')), bic: val(agents, 'DbtrAgt/FinInstnId/BICFI') || val(agents, 'DbtrAgt/FinInstnId/BIC') }
      : { name: partyName(find(rp, 'Cdtr')), account: acctId(find(rp, 'CdtrAcct')), bic: val(agents, 'CdtrAgt/FinInstnId/BICFI') || val(agents, 'CdtrAgt/FinInstnId/BIC') };
    for (const k of Object.keys(cp)) if (!cp[k]) delete cp[k];
    const ustrd = findAll(tx, 'RmtInf/Ustrd').map(text).join(' ');
    return {
      ...base,
      amount: Math.round(txSign * (txAmount ?? 0) * 100) / 100,
      counterparty: cp,
      communication: ustrd || val(tx, 'AddtlTxInf') || val(entry, 'AddtlNtryInf'),
      reference: reference(tx) || classifyReference(ustrd.match(/[+*]{3}\s*\d{3}\/\d{4}\/\d{5}\s*[+*]{3}/)?.[0] || ''),
      endToEndId: (v => (v && v !== 'NOTPROVIDED' ? v : undefined))(val(tx, 'Refs/EndToEndId')),
      purpose: val(tx, 'Purp/Cd') || undefined,
      code: bankTxCode(tx) || base.code,
    };
  });
}

/** Parse a CAMT document root into one statement per Stmt/Ntfctn/Rpt. */
export function parseCamt(root) {
  const kind = camtKind(root);
  if (!kind) throw new Error('This is not a CAMT.052/053/054 document (namespace urn:iso:std:iso:20022:tech:xsd:camt.05x…).');
  const body = elements(root)[0];
  const blocks = elements(body).filter((e) => ['Stmt', 'Ntfctn', 'Rpt'].includes(e.local));
  const msgId = val(body, 'GrpHdr/MsgId');
  return blocks.map((s) => {
    const currency = val(s, 'Acct/Ccy');
    const iban = val(s, 'Acct/Id/IBAN');
    const bic = val(s, 'Acct/Svcr/FinInstnId/BICFI') || val(s, 'Acct/Svcr/FinInstnId/BIC');
    const bal = (codes) => {
      const b = findAll(s, 'Bal').find((x) => codes.includes(val(x, 'Tp/CdOrPrtry/Cd')));
      if (!b) return null;
      const sign = val(b, 'CdtDbtInd') === 'DBIT' ? -1 : 1;
      return { amount: sign * amt(find(b, 'Amt')), date: dateOf(find(b, 'Dt')), type: val(b, 'Tp/CdOrPrtry/Cd') };
    };
    const st = {
      format: kind.message.toUpperCase(),
      version: kind.version,
      messageId: msgId,
      number: val(s, 'ElctrncSeqNb') || val(s, 'LglSeqNb') || val(s, 'Id'),
      id: val(s, 'Id'),
      creationDate: (val(s, 'CreDtTm') || val(body, 'GrpHdr/CreDtTm')).slice(0, 10),
      period: find(s, 'FrToDt') ? { from: val(s, 'FrToDt/FrDtTm').slice(0, 10), to: val(s, 'FrToDt/ToDtTm').slice(0, 10) } : null,
      bank: { bic, name: iban.startsWith('BE') ? belgianBank(iban.slice(4, 7))?.name : undefined },
      account: { iban, currency, holder: partyName(find(s, 'Acct/Ownr')) },
      openingBalance: bal(['OPBD', 'PRCD']),
      closingBalance: bal(['CLBD']),
      available: bal(['CLAV']),
      transactions: findAll(s, 'Ntry').flatMap((e) => entryTransactions(e, currency)).map((t, i) => ({ id: String(i + 1), ...t })),
      checks: [],
    };
    const r = (x) => Math.round(x * 100) / 100;
    if (st.openingBalance && st.closingBalance) {
      const exp = r(st.openingBalance.amount + st.transactions.reduce((a, t) => a + t.amount, 0));
      const ok = exp === r(st.closingBalance.amount);
      st.checks.push({ ok, message: ok ? `Opening balance + entries = closing balance (${st.closingBalance.amount.toFixed(2)}).` : `Opening balance + entries = ${exp.toFixed(2)}, but the closing balance is ${st.closingBalance.amount.toFixed(2)}.` });
    }
    const declared = find(s, 'TxsSummry/TtlNtries/NbOfNtries');
    if (declared) {
      const n = findAll(s, 'Ntry').length;
      const ok = +text(declared) === n;
      st.checks.push({ ok, message: ok ? `Entry count ${n} matches the summary.` : `The summary declares ${text(declared)} entries, the file contains ${n}.` });
    }
    return st;
  });
}
