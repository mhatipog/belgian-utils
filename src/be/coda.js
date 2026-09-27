// CODA (Febelfin "Coded statement of account", version 2) parser.
// Fixed-width 128-character records:
//   0 header · 1 old balance · 2.1/2.2/2.3 movement · 3.1/3.2/3.3 information
//   4 free communication · 8 new balance · 9 trailer
// Positions below are 1-based as in the Febelfin standard; slice() is 0-based.

import { classifyReference } from './statement.js';
import { belgianBank, formatOgm } from './ids.js';

export const CODA_FAMILIES = {
  '00': 'Undefined transactions', '01': 'Domestic or SEPA credit transfer', '02': 'Instant SEPA credit transfer', '03': 'Cheques', '04': 'Cards',
  '05': 'Direct debit', '07': 'Domestic commercial paper', '09': 'Counter transactions', '11': 'Securities', '13': 'Credit (loans)',
  '30': 'Various transactions', '35': 'Closing (periodical settlements: interest, costs…)', '39': 'Domestic commercial paper',
  '41': 'International (non-SEPA) credit transfer', '43': 'Foreign cheques', '47': 'Foreign commercial paper', '49': 'Foreign counter transactions',
  '80': 'Separately charged costs and provisions',
};
export const CODA_TYPES = {
  0: 'Simple amount', 1: 'Total amount (globalised by the customer)', 2: 'Total amount (globalised by the bank)', 3: 'Simple amount with detail',
  5: 'Detail of a globalised amount', 6: 'Detail of a globalised amount', 7: 'Detail of a globalised amount', 8: 'Detail of a simple amount with detail', 9: 'Detail',
};
export const STRUCTURED_TYPES = {
  101: 'Structured communication (OGM)', 102: 'Structured communication (reconstituted)', 103: 'Number (e.g. cheque)', 105: 'Original amount of the transaction',
  106: 'Method of calculation (VAT, withholding tax, commission)', 107: 'Direct debit (DOM’80)', 108: 'Closing', 111: 'POS credit - globalisation',
  113: 'ATM/POS debit', 114: 'POS credit - individual transaction', 115: 'Terminal cash deposit', 121: 'Commercial bills', 122: 'Bills - calculation of interest',
  123: 'Fees and commissions', 124: 'Credit card number', 125: 'Credit', 126: 'Term investments', 127: 'European direct debit (SEPA)',
};

const P = (line, from, to) => line.slice(from - 1, to);
const T = (line, from, to) => P(line, from, to).trim();
const date6 = (s) => (/^\d{6}$/.test(s) && s !== '000000' ? `20${s.slice(4, 6)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : null);
const amount15 = (sign, s) => (sign === '1' ? -1 : 1) * (Number(s) / 1000);

function account(structure, s37) {
  // Account structure: 0 Belgian account, 1 foreign account, 2 Belgian IBAN, 3 foreign IBAN
  if (structure === '2') return { iban: s37.slice(0, 16).trim(), currency: s37.slice(34, 37).trim() };
  if (structure === '3') return { iban: s37.slice(0, 34).trim(), currency: s37.slice(34, 37).trim() };
  if (structure === '0') return { number: s37.slice(0, 12).trim(), currency: s37.slice(13, 16).trim() };
  return { number: s37.slice(0, 34).trim(), currency: s37.slice(34, 37).trim() };
}

export function isCoda(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  // Header record: "0", four zeros, creation date DDMMYY, bank ID, application code "05".
  return /^00000\d{6}\d{3}05/.test(first);
}

/**
 * Parse a CODA file (possibly with several statements). Returns an array of
 * statements in the common schema, plus `raw` records per statement.
 */
export function parseCoda(input) {
  const lines = String(input).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  if (!/^0/.test(lines[0])) throw new Error("This doesn't look like a CODA file: the first record should be a header (type 0).");
  const statements = [];
  let st = null;
  let mv = null; // current movement (2.x)
  let info = null; // current information record (3.x)
  const warn = (msg) => st && st.checks.push({ ok: false, message: msg });

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.padEnd(128, ' ');
    const rec = line[0];
    const sub = line[1];
    if (raw.length !== 128 && st) warn(`Line ${lineNo}: record is ${raw.length} characters long instead of 128.`);
    if (rec === '0') {
      st = {
        format: 'CODA',
        version: line[127],
        creationDate: date6(P(line, 6, 11)),
        bank: { code: P(line, 12, 14), bic: T(line, 61, 71) },
        duplicate: line[16] === 'D',
        fileReference: T(line, 25, 34),
        addressee: T(line, 35, 60),
        holderId: T(line, 72, 82),
        account: {},
        transactions: [],
        info: [],
        freeText: [],
        checks: [],
        records: 0,
      };
      if (st.version !== '2') warn(`Version code is "${st.version}"; this tool reads CODA version 2.`);
      const b = belgianBank(st.bank.code);
      if (b) st.bank.name = b.name;
      statements.push(st);
      mv = null;
      return;
    }
    if (!st) throw new Error(`Line ${lineNo}: record before the header.`);
    if (rec === '1') {
      st.records++;
      st.accountStructure = line[1];
      st.account = { ...account(line[1], P(line, 6, 42)), holder: T(line, 65, 90), description: T(line, 91, 125) };
      st.paperNumber = T(line, 3, 5);
      st.number = T(line, 126, 128);
      st.openingBalance = { amount: amount15(line[42], P(line, 44, 58)), date: date6(P(line, 59, 64)) };
      return;
    }
    if (rec === '2') {
      st.records++;
      if (sub === '1') {
        const commType = line[61];
        const typeDigit = +line[53];
        mv = {
          id: `${T(line, 3, 6)}/${T(line, 7, 10)}`,
          sequence: T(line, 3, 6),
          detail: T(line, 7, 10),
          bankReference: T(line, 11, 31),
          amount: amount15(line[31], P(line, 33, 47)),
          valueDate: date6(P(line, 48, 53)),
          code: {
            code: P(line, 54, 61),
            type: typeDigit,
            family: P(line, 55, 56),
            transaction: P(line, 57, 58),
            category: P(line, 59, 61),
          },
          bookingDate: date6(P(line, 116, 121)),
          globalisation: line[124],
          communication: '',
          structured: null,
          counterparty: {},
          currency: st.account.currency,
          lineNo,
        };
        mv.code.description = `${CODA_FAMILIES[mv.code.family] || `Family ${mv.code.family}`} · ${CODA_TYPES[mv.code.type] || `Type ${mv.code.type}`}`;
        mv.direction = mv.amount < 0 ? 'debit' : 'credit';
        mv.isDetail = mv.code.type >= 5;
        if (commType === '1') {
          const t = P(line, 63, 65);
          const body = P(line, 66, 115);
          mv.structured = { type: t, description: STRUCTURED_TYPES[t] || `Structured type ${t}`, raw: body.trim() };
          if (t === '101' || t === '102') mv.reference = classifyReference(formatOgm(body.slice(0, 12)));
          else mv.communication = body.trim();
        } else {
          mv.communication = P(line, 63, 115).trimEnd();
        }
        st.transactions.push(mv);
      } else if (sub === '2' && mv) {
        mv.communication = (mv.communication + P(line, 11, 63)).trimEnd();
        mv.endToEndId = T(line, 64, 98) || undefined;
        mv.counterparty.bic = T(line, 99, 109) || undefined;
        mv.rType = line[112].trim() || undefined;
        mv.returnReason = T(line, 114, 117) || undefined;
        mv.categoryPurpose = T(line, 118, 121) || undefined;
        mv.purpose = T(line, 122, 125) || undefined;
      } else if (sub === '3' && mv) {
        const acc = P(line, 11, 47);
        mv.counterparty.account = acc.slice(0, 34).trim() || undefined;
        mv.counterparty.currency = acc.slice(34, 37).trim() || undefined;
        mv.counterparty.name = T(line, 48, 82) || undefined;
        mv.communication = (mv.communication + P(line, 83, 125)).trimEnd();
      } else {
        warn(`Line ${lineNo}: movement record 2.${sub} without a preceding 2.1.`);
      }
      return;
    }
    if (rec === '3') {
      st.records++;
      if (sub === '1') {
        info = {
          id: `${T(line, 3, 6)}/${T(line, 7, 10)}`,
          bankReference: T(line, 11, 31),
          code: P(line, 32, 39),
          structured: line[39] === '1',
          text: P(line, 41, 113).trimEnd(),
        };
        if (info.structured) {
          info.structuredType = P(line, 41, 43);
          info.text = P(line, 44, 113).trimEnd();
        }
        st.info.push(info);
        // Attach to the movement with the same sequence number.
        const m = st.transactions.find((t) => t.sequence === T(line, 3, 6));
        if (m) (m.details ||= []).push(info);
      } else if (info && sub === '2') info.text = (info.text + P(line, 11, 115)).trimEnd();
      else if (info && sub === '3') info.text = (info.text + P(line, 11, 100)).trimEnd();
      return;
    }
    if (rec === '4') {
      st.records++;
      st.freeText.push(T(line, 33, 112));
      return;
    }
    if (rec === '8') {
      st.records++;
      st.closingBalance = { amount: amount15(line[41], P(line, 43, 57)), date: date6(P(line, 58, 63)) };
      return;
    }
    if (rec === '9') {
      st.trailer = {
        records: +P(line, 17, 22),
        debit: Number(P(line, 23, 37)) / 1000,
        credit: Number(P(line, 38, 52)) / 1000,
        lastFile: line[127] === '2',
      };
      return;
    }
    warn(`Line ${lineNo}: unknown record type "${rec}".`);
  });

  // Integrity checks and clean-up.
  for (const s of statements) {
    for (const t of s.transactions) {
      t.communication = t.communication.replace(/\s{2,}/g, ' ').trim();
      if (!t.reference && t.communication) t.reference = classifyReference(t.communication.match(/[+*]{3}\s*\d{3}\/\d{4}\/\d{5}\s*[+*]{3}/)?.[0] || '') || null;
      if (t.counterparty.account && /^[A-Z]{2}\d{2}/.test(t.counterparty.account)) t.counterparty.account = t.counterparty.account.replace(/\s/g, '');
      delete t.lineNo;
    }
    const main = s.transactions.filter((t) => !t.isDetail);
    const sumOf = (arr, sign) => arr.filter((t) => Math.sign(t.amount) === sign).reduce((a, t) => a + Math.abs(t.amount), 0);
    const r = (x) => Math.round(x * 100) / 100;
    if (s.trailer) {
      const debit = r(sumOf(main, -1));
      const credit = r(sumOf(main, 1));
      const debitAll = r(sumOf(s.transactions, -1));
      const creditAll = r(sumOf(s.transactions, 1));
      const okD = debit === r(s.trailer.debit) || debitAll === r(s.trailer.debit);
      const okC = credit === r(s.trailer.credit) || creditAll === r(s.trailer.credit);
      s.checks.push({ ok: okD, message: okD ? `Debit total ${s.trailer.debit.toFixed(2)} matches the trailer.` : `Debit movements add up to ${debit.toFixed(2)} but the trailer says ${s.trailer.debit.toFixed(2)}.` });
      s.checks.push({ ok: okC, message: okC ? `Credit total ${s.trailer.credit.toFixed(2)} matches the trailer.` : `Credit movements add up to ${credit.toFixed(2)} but the trailer says ${s.trailer.credit.toFixed(2)}.` });
      const okN = s.trailer.records === s.records;
      s.checks.push({ ok: okN, message: okN ? `Record count ${s.records} matches the trailer.` : `The file has ${s.records} records of type 1-8 but the trailer says ${s.trailer.records}.` });
    } else s.checks.push({ ok: false, message: 'No trailer record (type 9): the file may be truncated.' });
    if (s.openingBalance && s.closingBalance) {
      const exp = r(s.openingBalance.amount + main.reduce((a, t) => a + t.amount, 0));
      const ok = exp === r(s.closingBalance.amount);
      s.checks.push({ ok, message: ok ? `Opening balance + movements = closing balance (${s.closingBalance.amount.toFixed(2)}).` : `Opening balance + movements = ${exp.toFixed(2)}, but the closing balance is ${s.closingBalance.amount.toFixed(2)}.` });
    }
    s.transactions = s.transactions.map((t) => ({ ...t, amount: Math.round(t.amount * 100) / 100 }));
  }
  return statements;
}

/** Replace names, accounts and communications with fictional values; amounts and dates stay. */
export function anonymizeCoda(input, fake) {
  const lines = String(input).replace(/\r/g, '').split('\n');
  return lines.map((l) => {
    if (l.length < 128) return l;
    const put = (s, from, to, value) => s.slice(0, from - 1) + value.padEnd(to - from + 1, ' ').slice(0, to - from + 1) + s.slice(to);
    let out = l;
    const rec = l[0];
    const sub = l[1];
    if (rec === '0') out = put(put(out, 35, 60, fake.name('addressee')), 72, 82, fake.enterprise('holder'));
    if (rec === '1') {
      if (l[1] === '2') out = put(out, 6, 21, fake.iban(P(l, 6, 21).trim()));
      out = put(put(out, 65, 90, fake.name(P(l, 65, 90).trim())), 91, 125, '');
    }
    if (rec === '8') {
      const acc = P(l, 5, 20).trim();
      if (/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(acc)) out = put(out, 5, 20, fake.iban(acc));
    }
    if (rec === '2' && sub === '1' && l[61] === '0') out = put(out, 63, 115, fake.text(P(l, 63, 115).trim()));
    if (rec === '2' && sub === '1' && l[61] === '1' && ['101', '102'].includes(P(l, 63, 65))) out = put(out, 66, 77, fake.ogmDigits(P(l, 66, 77)));
    if (rec === '2' && sub === '2') out = put(put(out, 11, 63, fake.text(P(l, 11, 63).trim())), 64, 98, P(l, 64, 98).trim() ? fake.ref(P(l, 64, 98).trim()) : '');
    if (rec === '2' && sub === '3') {
      const acc = P(l, 11, 44).trim();
      out = put(out, 11, 44, acc ? fake.iban(acc) : '');
      out = put(put(out, 48, 82, P(l, 48, 82).trim() ? fake.name(P(l, 48, 82).trim()) : ''), 83, 125, fake.text(P(l, 83, 125).trim()));
    }
    if (rec === '3') out = put(out, sub === '1' ? 41 : 11, sub === '1' ? 113 : sub === '2' ? 115 : 100, fake.text(P(l, sub === '1' ? 41 : 11, sub === '1' ? 113 : 115).trim()));
    if (rec === '4') out = put(out, 33, 112, fake.text(P(l, 33, 112).trim()));
    return out;
  }).join('\n');
}
