// Local EU VAT validation with the audited, pinned JSVAT-Next fork.
// No network requests. Never interpret local acceptance as an active VAT registration.
// License for the vendored JSVAT code: src/vendor/JSVAT-NEXT-LICENSE.txt.
import { checkVAT, countries } from '../vendor/jsvat-next-7515d4a.js';
import { parseEnterprise } from './ids.js';

// EU Member States (VIES prefix EL for Greece), plus GR as a common pasted alias.
// EU/OSS and GB/XI numbers are intentionally not silently treated as EU-27 registrations.
export const EU_VAT_PREFIXES = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ')
);
const EU_COUNTRY_CODES = new Set([...EU_VAT_PREFIXES, 'GR']);
const EU_COUNTRIES = countries.filter((c) => EU_COUNTRY_CODES.has(c.codes[0]));

export function parseEuVat(input) {
  const raw = String(input ?? '').trim();
  const normalized = raw.toUpperCase().replace(/[\s./-]+/g, '');
  const prefix = normalized.slice(0, 2);
  const vat = prefix === 'GR' ? 'EL' + normalized.slice(2) : normalized;
  const countryCode = vat.slice(0, 2);
  const base = { input: raw, vat, countryCode, valid: false, formatValid: false,
    supported: false, errors: [], kind: 'vat' };
  if (!/^[A-Z]{2}[A-Z0-9]{2,14}$/.test(vat)) {
    base.errors.push('Enter a VAT number with a two-letter country prefix (for example DE136695976).');
    return base;
  }
  if (!EU_VAT_PREFIXES.has(countryCode)) {
    base.errors.push('This checker covers the 27 EU Member States. GB, XI, NO and EU/OSS identifiers are outside its scope.');
    return base;
  }
  base.supported = true;
  if (countryCode === 'BE') {
    // Keep the established Belgian KBO check and old nine-digit normalization.
    const be = parseEnterprise(vat);
    base.country = 'Belgium';
    base.valid = be.valid && be.kind === 'enterprise';
    base.formatValid = be.kind === 'enterprise' && !!be.digits;
    base.vat = be.vat || vat;
    base.formatted = be.formatted || '';
    base.peppol = be.peppol || null;
    base.errors = base.valid ? [] : be.errors.length ? be.errors : ['A VAT number must identify a Belgian enterprise, not an establishment unit.'];
    return base;
  }
  const result = checkVAT(vat, EU_COUNTRIES);
  base.country = result.country?.name || countryCode;
  base.formatValid = !!result.isValidFormat;
  base.valid = !!result.isValid && !!result.isSupportedCountry;
  if (!base.valid) base.errors.push(base.formatValid ?
    'Country-specific checksum failed (or the local rules rejected this number).' :
    'This number does not match the country-specific VAT format.');
  return base;
}
