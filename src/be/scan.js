// Find Belgian identifiers in arbitrary text and validate them.
import { parseEnterprise, parseIban, parseOgm, parseRf, parseNationalNumber, parsePeppolId, parseBic, belgianAccountToIban } from './ids.js';

const PATTERNS = [
  // Peppol IDs first so their inner numbers aren't reported twice.
  { type: 'peppol', re: /\b(?:iso6523-actorid-upis::)?(?:0208|9925|0088|0106|0190|9944|0007|0192):[A-Z0-9]{6,20}\b/gi },
  { type: 'ogm', re: /[+*]{3}\s*\d{3}\s*\/\s*\d{4}\s*\/\s*\d{5}\s*[+*]{3}/g },
  { type: 'rf', re: /\bRF\d{2}(?:\s?[A-Z0-9]{1,4}){1,6}\b/gi },
  { type: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  { type: 'account', re: /\b\d{3}-\d{7}-\d{2}\b/g },
  { type: 'national', re: /\b\d{2}[.]?\d{2}[.]?\d{2}[-\s]?\d{3}[.]?\d{2}\b/g },
  { type: 'vat', re: /\bBE\s?[01]?\d{3}[.\s]?\d{3}[.\s]?\d{3}\b/gi },
  { type: 'enterprise', re: /\b[01]\d{3}\.\d{3}\.\d{3}\b|\b[2-8]\.\d{3}\.\d{3}\.\d{3}\b|\b[01]\d{9}\b/g },
  { type: 'bic', re: /\b[A-Z]{4}BE[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g },
  { type: 'postcode', re: /\b(?:B-)?([1-9]\d{3})\s+([A-ZÀ-Ý][a-zà-ÿ'’-]+(?:[\s-][A-ZÀ-Ý]?[a-zà-ÿ'’-]+)*)/g },
];

export const TYPE_LABELS = {
  peppol: 'Peppol participant ID', ogm: 'Structured communication (OGM)', rf: 'RF creditor reference', iban: 'IBAN', account: 'Belgian account number (old)',
  national: 'National register / BIS number', vat: 'VAT number', enterprise: 'Enterprise / establishment number', bic: 'BIC (Belgian bank)', postcode: 'Postcode + place',
};

/**
 * @returns {{type, value, index, valid, info, tool}[]} in text order, de-duplicated by position
 */
export function scanIdentifiers(text, { places } = {}) {
  const found = [];
  const taken = [];
  const overlaps = (a, b) => taken.some(([s, e]) => a < e && b > s);
  for (const { type, re } of PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const v = m[0].trim();
      let r = null;
      if (type === 'peppol') {
        const p = parsePeppolId(v);
        r = { valid: p.valid, info: `${p.schemeName}${p.errors.length ? ` - ${p.errors.join(' ')}` : ''}`, tool: 'peppol-id' };
      } else if (type === 'ogm') {
        const o = parseOgm(v);
        r = { valid: o.valid, info: o.valid ? o.formatted : o.errors.join(' '), tool: 'ogm-generator' };
      } else if (type === 'rf') {
        const o = parseRf(v);
        if (!o.formatted) continue;
        r = { valid: o.valid, info: o.valid ? `Reference ${o.reference}` : o.errors.join(' '), tool: 'ogm-generator' };
      } else if (type === 'iban') {
        const o = parseIban(v);
        if (!o.country || !/^[A-Z]{2}$/.test(o.country)) continue;
        if (o.errors.some((x) => /does not use IBANs/.test(x))) continue;
        if (!o.valid && /^BE[01]\d{9}$/i.test(v.replace(/[.\s]/g, ''))) continue; // a VAT number, handled below
        r = { valid: o.valid, info: o.valid ? `${o.formatted}${o.bank ? ` · ${o.bank.name}${o.bank.bic ? ` (${o.bank.bic})` : ''}` : ''}` : o.errors.join(' '), tool: 'iban-checker' };
      } else if (type === 'account') {
        try {
          r = { valid: true, info: `IBAN ${belgianAccountToIban(v)}`, tool: 'iban-checker' };
        } catch (e) {
          r = { valid: false, info: e.message, tool: 'iban-checker' };
        }
      } else if (type === 'national') {
        const o = parseNationalNumber(v);
        if (!o.valid && !/[.-]/.test(v)) continue; // plain 11-digit numbers are too ambiguous unless valid
        r = { valid: o.valid, info: o.valid ? `${o.type}, born ${o.birthDate}${o.sex ? `, ${o.sex}` : ''}` : o.errors.join(' '), tool: 'national-number-checker' };
      } else if (type === 'vat' || type === 'enterprise') {
        const o = parseEnterprise(v);
        if (type === 'enterprise' && !o.valid && /^\d{10}$/.test(v)) continue; // bare 10 digits: only report valid ones
        r = { valid: o.valid, info: o.valid ? `${o.kind === 'establishment' ? 'Establishment unit' : 'Enterprise'} ${o.formatted}${o.vat ? ` · VAT ${o.vat}` : ''}` : o.errors.join(' '), tool: 'vat-number-checker' };
      } else if (type === 'bic') {
        const o = parseBic(v);
        if (!o.bank) continue;
        r = { valid: true, info: o.bank, tool: 'belgian-bank-codes' };
      } else if (type === 'postcode') {
        if (!places) continue;
        const pc = m[1];
        const place = m[2];
        const rows = places.filter((p) => p[0] === pc);
        if (!rows.length) continue;
        const lc = place.toLowerCase();
        const match = rows.find((p) => p[1].toLowerCase() === lc) || rows.find((p) => p[2].toLowerCase() === lc);
        r = { valid: !!match, info: match ? `${match[1]}${match[1] !== match[2] ? ` (municipality ${match[2]})` : ''}, NIS ${match[3]}` : `${pc} is ${rows.slice(0, 3).map((p) => p[1]).join(', ')}${rows.length > 3 ? '…' : ''}, not “${place}”`, tool: 'belgian-postcodes' };
      }
      if (!r) continue;
      taken.push([start, end]);
      found.push({ type, value: v, index: start, ...r });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}
