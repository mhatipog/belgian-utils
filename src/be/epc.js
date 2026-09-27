// EPC069-12 "SEPA Credit Transfer" QR payload (a.k.a. GiroCode / scan-to-pay).
import { parseIban, parseOgm, parseRf, parseBic } from './ids.js';

/**
 * @returns {{ payload: string, errors: string[], warnings: string[] }}
 */
export function epcPayload({ name, iban, bic, amount, reference, text }) {
  const errors = [];
  const warnings = [];
  const nm = String(name || '').trim();
  if (!nm) errors.push('Enter the beneficiary name.');
  if (nm.length > 70) errors.push('The name can be at most 70 characters.');
  const ib = parseIban(iban || '');
  if (!iban) errors.push('Enter the IBAN.');
  else if (!ib.valid) errors.push(`IBAN: ${ib.errors.join(' ')}`);
  let b = String(bic || '').replace(/\s/g, '').toUpperCase();
  if (!b && ib.bank?.bic) b = ib.bank.bic;
  if (b && !parseBic(b).valid) errors.push('The BIC is not valid (8 or 11 characters).');
  let amt = '';
  if (String(amount || '').trim()) {
    const clean = String(amount).replace(/\s/g, '').replace(',', '.');
    const v = Number(clean);
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) errors.push('Write the amount as a number with at most 2 decimals, e.g. 1261.94.');
    else if (v < 0.01 || v > 999999999.99) errors.push('The amount must be between 0.01 and 999,999,999.99.');
    else amt = `EUR${v.toFixed(2)}`;
  }
  let structured = '';
  let unstructured = String(text || '').trim();
  const ref = String(reference || '').trim();
  if (ref) {
    if (/^RF/i.test(ref.replace(/\s/g, ''))) {
      const r = parseRf(ref);
      if (!r.valid) errors.push('The RF reference has wrong check digits.');
      structured = ref.replace(/\s/g, '').toUpperCase();
    } else {
      const o = parseOgm(ref);
      if (!o.valid) errors.push(`Structured communication: ${o.errors.join(' ')}`);
      // Belgian banking apps read the OGM from the remittance text in +++ form.
      unstructured = o.formatted || ref;
    }
    if (text && ref && !/^RF/i.test(ref)) warnings.push('A free message is ignored when a structured communication is given.');
  }
  if (unstructured.length > 140) errors.push('The message can be at most 140 characters.');
  const lines = ['BCD', '002', '1', 'SCT', b, nm, ib.iban || '', amt, '', structured, structured ? '' : unstructured];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const payload = lines.join('\n');
  if (new TextEncoder().encode(payload).length > 331) errors.push('The payment data is too long for an EPC QR code (331 bytes).');
  return { payload, errors, warnings, bic: b };
}
