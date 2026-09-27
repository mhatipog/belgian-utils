// Belgian identifiers: enterprise/VAT/establishment numbers (KBO/BCE),
// structured payment references (OGM/VCS), ISO 11649 RF references, IBAN
// (all countries, with Belgian BBAN checks), national register numbers,
// Peppol participant IDs and BIC codes. Pure functions, no network.

import BANKS from '../data/be-banks.json' with { type: 'json' };

const digitsOnly = (s) => String(s || '').replace(/\D/g, '');
const mod97 = (numStr) => {
  let r = 0;
  for (const ch of numStr) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return r;
};

// ---------- enterprise / VAT / establishment numbers ----------

/**
 * Parse a Belgian enterprise number, VAT number or establishment unit number.
 * Accepts BE0123.456.789, 0123456789, 123.456.789 (old 9-digit form), etc.
 */
export function parseEnterprise(input) {
  const raw = String(input || '').trim();
  let s = raw.toUpperCase().replace(/^BE[\s-]*/, '').replace(/^VAT\s*|^BTW\s*|^TVA\s*/, '');
  s = s.replace(/[\s.\-/]/g, '');
  const out = { input: raw, valid: false, errors: [] };
  if (!/^\d+$/.test(s)) {
    out.errors.push('Only digits (optionally with BE, dots or spaces) are allowed.');
    return out;
  }
  if (s.length === 9) {
    out.notes = ['Old 9-digit VAT number: a leading 0 was added (standard since 2007).'];
    s = `0${s}`;
  }
  if (s.length !== 10) {
    out.errors.push(`A Belgian enterprise number has 10 digits; this has ${s.length}.`);
    return out;
  }
  const first = +s[0];
  out.digits = s;
  out.kind = first <= 1 ? 'enterprise' : first <= 8 ? 'establishment' : 'unknown';
  const check = 97 - mod97(s.slice(0, 8));
  out.expectedCheck = String(check).padStart(2, '0');
  out.checksumOk = s.slice(8) === out.expectedCheck;
  if (out.kind === 'unknown') out.errors.push('Numbers starting with 9 are not issued.');
  if (!out.checksumOk) out.errors.push(`Checksum mismatch: the last two digits should be ${out.expectedCheck} (97 − first 8 digits mod 97).`);
  out.valid = out.checksumOk && out.kind !== 'unknown';
  if (out.kind === 'enterprise') {
    out.formatted = `${s.slice(0, 4)}.${s.slice(4, 7)}.${s.slice(7)}`;
    out.vat = `BE${s}`;
    out.vatFormatted = `BE ${out.formatted}`;
    out.peppol = [`0208:${s}`, `9925:BE${s}`];
  } else if (out.kind === 'establishment') {
    out.formatted = `${s[0]}.${s.slice(1, 4)}.${s.slice(4, 7)}.${s.slice(7)}`;
  }
  return out;
}

/** Complete a 10-digit number from its first 8 digits (for test data). */
export function enterpriseWithCheck(first8) {
  const d = digitsOnly(first8).slice(0, 8).padStart(8, '0');
  return d + String(97 - mod97(d)).padStart(2, '0');
}

// ---------- OGM / VCS structured communication ----------

export function ogmCheck(ten) {
  const c = mod97(ten);
  return String(c === 0 ? 97 : c).padStart(2, '0');
}

export function formatOgm(twelve, style = '+') {
  const d = twelve;
  const m = style === '*' ? '***' : '+++';
  return `${m}${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}${m}`;
}

/** Validate an OGM in any common notation: +++123/4567/89012+++, ***…***, or 12 digits. */
export function parseOgm(input) {
  const raw = String(input || '').trim();
  const d = digitsOnly(raw);
  const out = { input: raw, valid: false, errors: [] };
  if (d.length !== 12) {
    out.errors.push(`A structured communication has 12 digits; this has ${d.length}.`);
    return out;
  }
  out.digits = d;
  out.base = d.slice(0, 10);
  out.expectedCheck = ogmCheck(out.base);
  out.valid = d.slice(10) === out.expectedCheck;
  if (!out.valid) out.errors.push(`Check digits should be ${out.expectedCheck} (first 10 digits mod 97, 97 when the remainder is 0).`);
  out.formatted = formatOgm(d);
  return out;
}

/** Make a valid OGM from up to 10 digits of your own (padded left with zeros). */
export function makeOgm(base) {
  const b = digitsOnly(base);
  if (b.length > 10) throw new Error('Use at most 10 digits; the last 2 are the check digits.');
  const ten = b.padStart(10, '0');
  return formatOgm(ten + ogmCheck(ten));
}

const OGM_RE = /(?:[+*]{3}\s*)?(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})(?:\s*[+*]{3})?/g;
/** Find structured communications in free text (e.g. bank statements, emails). */
export function extractOgms(text) {
  const out = [];
  for (const m of String(text).matchAll(OGM_RE)) out.push({ match: m[0], index: m.index, ...parseOgm(m[1] + m[2] + m[3]) });
  return out;
}

// ---------- ISO 11649 RF creditor reference ----------

const alnumToDigits = (s) => s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

export function parseRf(input) {
  const s = String(input || '').replace(/\s/g, '').toUpperCase();
  const out = { input, valid: false, errors: [] };
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(s)) {
    out.errors.push('An RF reference is "RF", 2 check digits and 1-21 letters or digits.');
    return out;
  }
  out.valid = mod97(alnumToDigits(s.slice(4) + s.slice(0, 4))) === 1;
  if (!out.valid) out.errors.push('Check digits are wrong.');
  out.formatted = s.replace(/(.{4})/g, '$1 ').trim();
  out.reference = s.slice(4);
  return out;
}

export function makeRf(reference) {
  const ref = String(reference || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{1,21}$/.test(ref)) throw new Error('Use 1-21 letters or digits.');
  const check = 98 - mod97(alnumToDigits(`${ref}RF00`));
  return `RF${String(check).padStart(2, '0')}${ref}`.replace(/(.{4})/g, '$1 ').trim();
}

// ---------- IBAN ----------

// IBAN lengths per country (SWIFT IBAN registry).
export const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18,
  DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23,
  IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27,
  MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
  SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};
const SEPA = new Set('AD AT BE BG CH CY CZ DE DK EE ES FI FR GB GI GR HR HU IE IS IT LI LT LU LV MC MT NL NO PL PT RO SE SI SK SM VA'.split(' '));

/** Bank for a Belgian bank code (first 3 digits of the BBAN), from the NBB list. */
export function belgianBank(code3) {
  const n = +code3;
  const r = BANKS.ranges.find(([lo, hi]) => n >= lo && n <= hi);
  return r ? { code: String(code3).padStart(3, '0'), range: `${String(r[0]).padStart(3, '0')}-${String(r[1]).padStart(3, '0')}`, bic: r[2], name: r[3], nameFr: r[4] } : null;
}
export const BANK_LIST_VERSION = BANKS.version;
export const bankRanges = () => BANKS.ranges;

export function parseIban(input) {
  const raw = String(input || '').trim();
  const s = raw.toUpperCase().replace(/^IBAN[:\s]*/, '').replace(/[\s.\-]/g, '');
  const out = { input: raw, valid: false, errors: [] };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) {
    out.errors.push('An IBAN starts with a 2-letter country code and 2 check digits.');
    return out;
  }
  out.iban = s;
  out.country = s.slice(0, 2);
  out.formatted = s.replace(/(.{4})/g, '$1 ').trim();
  out.bban = s.slice(4);
  out.sepa = SEPA.has(out.country);
  const len = IBAN_LENGTHS[out.country];
  if (!len) out.errors.push(`${out.country} does not use IBANs (or is not in the IBAN registry).`);
  else if (s.length !== len) out.errors.push(`${out.country} IBANs have ${len} characters; this has ${s.length}.`);
  const rearranged = alnumToDigits(s.slice(4) + s.slice(0, 4));
  out.checksumOk = mod97(rearranged) === 1;
  if (!out.checksumOk) out.errors.push('IBAN check digits are wrong (mod 97 ≠ 1) - probably a typo.');
  if (out.country === 'BE' && /^\d{12}$/.test(out.bban)) {
    const c = mod97(out.bban.slice(0, 10));
    out.bbanCheckOk = out.bban.slice(10) === String(c === 0 ? 97 : c).padStart(2, '0');
    if (!out.bbanCheckOk) out.errors.push('The Belgian account number check (last 2 digits) is wrong.');
    out.bankCode = out.bban.slice(0, 3);
    out.bank = belgianBank(out.bankCode);
    out.accountNumber = `${out.bban.slice(0, 3)}-${out.bban.slice(3, 10)}-${out.bban.slice(10)}`;
  }
  out.valid = !out.errors.length;
  return out;
}

/** Convert an old Belgian account number (xxx-xxxxxxx-xx) to IBAN. */
export function belgianAccountToIban(account) {
  const d = digitsOnly(account);
  if (d.length !== 12) throw new Error('A Belgian account number has 12 digits (xxx-xxxxxxx-xx).');
  const c = mod97(d.slice(0, 10));
  if (d.slice(10) !== String(c === 0 ? 97 : c).padStart(2, '0')) throw new Error('The account number check digits are wrong.');
  const check = 98 - mod97(`${d}111400`); // B=11, E=14, then 00
  return `BE${String(check).padStart(2, '0')}${d}`;
}

// ---------- national register number (rijksregisternummer / NISS / INSZ) ----------

export function parseNationalNumber(input) {
  const raw = String(input || '').trim();
  const d = digitsOnly(raw);
  const out = { input: raw, valid: false, errors: [] };
  if (d.length !== 11) {
    out.errors.push(`A national register number has 11 digits; this has ${d.length}.`);
    return out;
  }
  const base = d.slice(0, 9);
  const check = +d.slice(9);
  const before2000 = 97 - (Number(BigInt(base) % 97n)) === check;
  const after2000 = 97 - (Number(BigInt(`2${base}`) % 97n)) === check;
  out.formatted = `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}-${d.slice(6, 9)}.${d.slice(9)}`;
  if (!before2000 && !after2000) {
    out.errors.push('Check digits are wrong.');
    return out;
  }
  let month = +d.slice(2, 4);
  const day = +d.slice(4, 6);
  out.type = 'national register number';
  if (month >= 40) { month -= 40; out.type = 'BIS number (sex known)'; } else if (month >= 20) { month -= 20; out.type = 'BIS number (sex unknown at registration)'; }
  if (month > 12 || day > 31) {
    out.errors.push('The birth-date part is not a possible date.');
    return out;
  }
  const year = (after2000 ? 2000 : 1900) + +d.slice(0, 2);
  if (month && day && new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) {
    out.errors.push('The birth-date part is not a possible date.');
    return out;
  }
  out.birthDate = month && day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${year} (exact date unknown)`;
  const seq = +d.slice(6, 9);
  if (out.type !== 'BIS number (sex unknown at registration)') out.sex = seq % 2 ? 'male' : 'female';
  out.sequence = seq;
  out.valid = true;
  return out;
}

// ---------- Peppol participant IDs ----------

export const PEPPOL_SCHEMES = {
  '0208': 'Belgian enterprise number (KBO/BCE)',
  '9925': 'Belgian VAT number (legacy)',
  '0088': 'GLN (GS1)',
  '0106': 'Dutch KvK number',
  '0190': 'Dutch OIN',
  '9944': 'Dutch VAT number',
  '0009': 'French SIRET',
  '0002': 'French SIRENE',
  '9957': 'French VAT number',
  '0204': 'German Leitweg-ID',
  '9930': 'German VAT number',
  '0192': 'Norwegian organisation number',
  '0007': 'Swedish organisation number',
  '0184': 'Danish CVR',
  '0151': 'Australian ABN',
  '0060': 'DUNS',
  '0130': 'EU institution directorates',
};

export function parsePeppolId(input) {
  const raw = String(input || '').trim();
  const s = raw.replace(/^iso6523-actorid-upis::/i, '');
  const out = { input: raw, valid: false, errors: [] };
  const m = /^(\d{4}):(.+)$/.exec(s);
  if (!m) {
    out.errors.push('Expected scheme:identifier, e.g. 0208:0123456789 (optionally prefixed with iso6523-actorid-upis::).');
    return out;
  }
  out.scheme = m[1];
  out.value = m[2];
  out.schemeName = PEPPOL_SCHEMES[m[1]] || 'Other ICD scheme';
  out.full = `iso6523-actorid-upis::${m[1]}:${m[2]}`;
  if (m[1] === '0208') {
    const e = parseEnterprise(m[2]);
    if (!/^\d{10}$/.test(m[2])) out.errors.push('0208 identifiers are the 10-digit enterprise number without dots or BE.');
    if (!e.valid) out.errors.push(...e.errors);
    out.enterprise = e;
  } else if (m[1] === '9925') {
    if (!/^BE\d{10}$/i.test(m[2])) out.errors.push('9925 identifiers are BE + 10 digits.');
    const e = parseEnterprise(m[2]);
    if (!e.valid) out.errors.push(...e.errors);
    out.enterprise = e;
  }
  out.valid = !out.errors.length;
  return out;
}

// ---------- BIC ----------

export function parseBic(input) {
  const s = String(input || '').replace(/\s/g, '').toUpperCase();
  const out = { input, valid: /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s), bic: s };
  if (out.valid) {
    out.institution = s.slice(0, 4);
    out.country = s.slice(4, 6);
    out.location = s.slice(6, 8);
    out.branch = s.slice(8) || 'XXX (head office)';
    if (out.country === 'BE') {
      const b = BANKS.ranges.find((r) => r[2] && r[2].slice(0, 8) === s.slice(0, 8));
      if (b) out.bank = b[3];
    }
  }
  return out;
}
