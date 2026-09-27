// Readable checks for Peppol BIS Billing 3.0 invoices, with extra Belgian
// checks. This covers the rules that catch most real-world rejections
// (mandatory fields, arithmetic, VAT categories, identifiers). It is not the
// complete official Schematron; the IDs match the official rule IDs so they
// can be looked up.

import { BIS3_CUSTOMIZATION, BIS3_PROFILE } from './ubl.js';
import { parseEnterprise, parseOgm, parseRf, parseIban } from './ids.js';

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
// Totals must match to the cent; per-line and per-category checks pass an explicit rounding tolerance.
const close = (a, b, tol = 0) => Math.abs(r2(a) - r2(b)) <= tol + 0.0001;
const fmt = (x) => (x == null || Number.isNaN(x) ? '-' : x.toFixed(2));

const VAT_CATEGORIES = {
  S: 'Standard rate', Z: 'Zero rated', E: 'Exempt', AE: 'Reverse charge', K: 'Intra-community supply', G: 'Export outside the EU',
  O: 'Not subject to VAT', L: 'Canary Islands (IGIC)', M: 'Ceuta and Melilla (IPSI)',
};
export const PAYMENT_MEANS = {
  1: 'Instrument not defined', 10: 'Cash', 20: 'Cheque', 30: 'Credit transfer', 31: 'Debit transfer', 42: 'Payment to bank account',
  48: 'Bank card', 49: 'Direct debit', 54: 'Credit card', 55: 'Debit card', 57: 'Standing agreement', 58: 'SEPA credit transfer',
  59: 'SEPA direct debit', 68: 'Online payment service', 97: 'Clearing between partners', ZZZ: 'Mutually defined',
};
export const INVOICE_TYPES = { 380: 'Commercial invoice', 381: 'Credit note', 383: 'Debit note', 384: 'Corrected invoice', 386: 'Prepayment invoice', 389: 'Self-billed invoice', 751: 'Invoice information for accounting' };
const BE_RATES = [0, 6, 12, 21];
const decimals = (raw) => ((raw || '').split('.')[1] || '').length;

/**
 * @returns {{ id: string, level: 'error'|'warning'|'info', message: string, where?: string }[]}
 */
export function validateInvoice(inv) {
  const out = [];
  const err = (id, message, where) => out.push({ id, level: 'error', message, where });
  const warn = (id, message, where) => out.push({ id, level: 'warning', message, where });
  const T = inv.totals;
  const cur = inv.currency;

  // ---- document level ----
  if (!inv.customizationId) err('BR-01', 'Missing CustomizationID (the specification the invoice follows).', 'CustomizationID');
  else if (!inv.customizationId.startsWith(BIS3_CUSTOMIZATION)) err('PEPPOL-EN16931-R004', `CustomizationID must start with ${BIS3_CUSTOMIZATION} for Peppol BIS Billing 3.0 - found "${inv.customizationId}".`, 'CustomizationID');
  if (!inv.profileId) err('PEPPOL-EN16931-R001', 'Missing ProfileID (business process). For normal invoicing use ' + BIS3_PROFILE + '.', 'ProfileID');
  else if (!/^urn:fdc:peppol\.eu:2017:poacc:billing:\d\d:1\.0$/.test(inv.profileId)) err('PEPPOL-EN16931-R007', `ProfileID must look like urn:fdc:peppol.eu:2017:poacc:billing:NN:1.0 - found "${inv.profileId}".`, 'ProfileID');
  if (!inv.id) err('BR-02', 'The invoice number (ID) is missing.', 'ID');
  if (!inv.issueDate) err('BR-03', 'The issue date is missing.', 'IssueDate');
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.issueDate)) err('UBL-DT-01', `Dates must be written as YYYY-MM-DD - IssueDate is "${inv.issueDate}".`, 'IssueDate');
  if (inv.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate)) err('UBL-DT-01', `Dates must be written as YYYY-MM-DD - due date is "${inv.dueDate}".`, 'DueDate');
  if (!inv.typeCode) err('BR-04', 'The invoice type code is missing (380 for an invoice, 381 for a credit note).', 'InvoiceTypeCode');
  else if (inv.type === 'Invoice' && !['380', '383', '384', '386', '389', '751', '71', '102', '218', '219', '331', '382', '393', '395', '553', '575', '623', '780', '817', '870', '875', '876', '877'].includes(inv.typeCode)) {
    err('BR-CL-01', `Invoice type code ${inv.typeCode} is not allowed.`, 'InvoiceTypeCode');
  }
  if (!cur) err('BR-05', 'The document currency code is missing.', 'DocumentCurrencyCode');
  else if (!/^[A-Z]{3}$/.test(cur)) err('BR-CL-04', `"${cur}" is not an ISO 4217 currency code.`, 'DocumentCurrencyCode');
  if (!inv.buyerReference && !inv.orderReference) err('PEPPOL-EN16931-R003', 'Give a buyer reference or a purchase order reference - Peppol requires at least one.', 'BuyerReference');

  // ---- parties ----
  const checkParty = (p, role, codes) => {
    const R = role === 'seller' ? 'Seller' : 'Buyer';
    if (!p) { err(codes.name, `The ${role} (Accounting${role === 'seller' ? 'Supplier' : 'Customer'}Party) is missing.`); return; }
    if (!p.registrationName) err(codes.name, `${R} legal name (PartyLegalEntity/RegistrationName) is missing.`, `${R}`);
    if (!p.endpointId) err(codes.endpoint, `${R} electronic address (EndpointID) is missing - Peppol needs it to route the invoice.`, `${R} EndpointID`);
    else if (!p.endpointScheme) err('PEPPOL-EN16931-R020', `${R} EndpointID has no schemeID.`, `${R} EndpointID`);
    if (!p.address || !p.address.country) err(codes.country, `${R} country code (PostalAddress/Country/IdentificationCode) is missing.`, `${R} address`);
    else if (!/^[A-Z]{2}$/.test(p.address.country)) err('BR-CL-14', `${R} country "${p.address.country}" is not an ISO 3166 code.`, `${R} address`);
    if (p.endpointScheme === '0208') {
      const e = parseEnterprise(p.endpointId);
      if (!/^\d{10}$/.test(p.endpointId)) err('BE-ID-01', `${R} EndpointID with scheme 0208 must be the 10-digit enterprise number without "BE", dots or spaces - found "${p.endpointId}".`, `${R} EndpointID`);
      else if (!e.valid) err('BE-ID-02', `${R} enterprise number ${p.endpointId} fails the mod-97 check (${e.errors.join(' ')}). The invoice will not be deliverable.`, `${R} EndpointID`);
    } else if (p.endpointScheme === '9925') {
      if (!/^BE\d{10}$/i.test(p.endpointId) || !parseEnterprise(p.endpointId).valid) err('BE-ID-03', `${R} EndpointID with scheme 9925 must be a valid Belgian VAT number like BE0123456789 - found "${p.endpointId}".`, `${R} EndpointID`);
      else warn('BE-ID-04', `${R} uses scheme 9925 (VAT). Belgian Peppol participants are normally registered under 0208 (enterprise number); make sure the receiver is registered with 9925.`, `${R} EndpointID`);
    }
    if (p.vat) {
      if (!/^[A-Z]{2}/.test(p.vat)) err('BR-CO-09', `${R} VAT identifier must start with a country prefix (e.g. BE) - found "${p.vat}".`, `${R} VAT`);
      else if (/^BE/i.test(p.vat)) {
        const e = parseEnterprise(p.vat);
        if (!e.valid) err('BE-VAT-01', `${R} VAT number ${p.vat} is not a valid Belgian VAT number (${e.errors.join(' ')}).`, `${R} VAT`);
        else if (p.vat !== e.vat) warn('BE-VAT-02', `${R} VAT number should be written without dots or spaces: ${e.vat}.`, `${R} VAT`);
      }
    }
    if (p.legalIdScheme === '0208' && p.legalId && !parseEnterprise(p.legalId).valid) err('BE-ID-05', `${R} legal registration number ${p.legalId} (scheme 0208) is not a valid enterprise number.`, `${R} PartyLegalEntity`);
  };
  checkParty(inv.supplier, 'seller', { name: 'BR-06', endpoint: 'PEPPOL-EN16931-R020', country: 'BR-09' });
  checkParty(inv.customer, 'buyer', { name: 'BR-07', endpoint: 'PEPPOL-EN16931-R010', country: 'BR-11' });
  if (inv.supplier && !inv.supplier.vat && !inv.supplier.legalId && !inv.supplier.taxSchemes.length) {
    warn('BR-CO-26', 'The seller has no VAT number, legal registration ID or tax registration. At least one is needed to identify the seller.', 'Seller');
  }
  if (inv.supplier?.address?.country === 'BE' && !inv.supplier.vat && inv.taxTotals.some((t) => t.subtotals.some((s) => s.category === 'S'))) {
    err('BR-S-02', 'A Belgian seller charging VAT (category S) must give its VAT number (PartyTaxScheme/CompanyID).', 'Seller VAT');
  }

  // ---- lines ----
  if (!inv.lines.length) err('BR-16', 'The invoice has no lines.', 'InvoiceLine');
  let sumLines = 0;
  inv.lines.forEach((l, i) => {
    const at = `Line ${l.id || i + 1}`;
    if (!l.id) err('BR-21', `${at}: the line identifier is missing.`, at);
    if (l.quantity == null || Number.isNaN(l.quantity)) err('BR-22', `${at}: quantity is missing.`, at);
    if (!l.unit) err('BR-23', `${at}: the quantity has no unitCode (e.g. C62 for "one", HUR for hour).`, at);
    if (!l.lineExtension || l.lineExtension.value == null) err('BR-24', `${at}: the line net amount is missing.`, at);
    if (!l.name) err('BR-25', `${at}: the item name is missing.`, at);
    if (!l.price || l.price.value == null) err('BR-26', `${at}: the net price is missing.`, at);
    else if (l.price.value < 0) err('BR-27', `${at}: the item net price can't be negative (use a negative quantity instead).`, at);
    if (!l.taxCategory) err('BR-CO-04', `${at}: the VAT category (ClassifiedTaxCategory/ID) is missing.`, at);
    if (l.lineExtension?.raw && decimals(l.lineExtension.raw) > 2) err('PEPPOL-EN16931-R051', `${at}: the line amount ${l.lineExtension.raw} has more than 2 decimals.`, at);
    if (l.lineExtension && l.lineExtension.currency && cur && l.lineExtension.currency !== cur) err('PEPPOL-EN16931-R051', `${at}: amount currency ${l.lineExtension.currency} differs from the document currency ${cur}.`, at);
    if (l.quantity != null && l.price?.value != null && l.lineExtension?.value != null) {
      const base = l.baseQuantity || 1;
      const allow = l.allowanceCharges.filter((a) => !a.charge).reduce((s, a) => s + (a.amount?.value || 0), 0);
      const charge = l.allowanceCharges.filter((a) => a.charge).reduce((s, a) => s + (a.amount?.value || 0), 0);
      const expected = r2((l.quantity * l.price.value) / base + charge - allow);
      if (!close(expected, l.lineExtension.value, 0.02)) {
        err('PEPPOL-EN16931-R120', `${at}: line amount should be quantity × price${base !== 1 ? ` ÷ base quantity ${base}` : ''}${allow || charge ? ' + charges − allowances' : ''} = ${fmt(expected)}, but it is ${fmt(l.lineExtension.value)}.`, at);
      }
    }
    if (l.taxCategory === 'S' && l.taxPercent != null && l.taxPercent <= 0) err('BR-S-05', `${at}: standard-rated (S) lines need a VAT rate above 0.`, at);
    if (['Z', 'E', 'AE', 'K', 'G', 'O'].includes(l.taxCategory) && l.taxPercent && l.taxCategory !== 'O') err(`BR-${l.taxCategory}-05`, `${at}: category ${l.taxCategory} (${VAT_CATEGORIES[l.taxCategory]}) must have a 0% rate.`, at);
    if (inv.supplier?.address?.country === 'BE' && l.taxCategory === 'S' && l.taxPercent != null && !BE_RATES.includes(l.taxPercent)) {
      warn('BE-VAT-03', `${at}: ${l.taxPercent}% is not a Belgian VAT rate (0, 6, 12 or 21%).`, at);
    }
    sumLines += l.lineExtension?.value || 0;
  });

  // ---- totals ----
  if (!T.lineExtension) err('BR-12', 'The sum of line net amounts (LineExtensionAmount) is missing.', 'LegalMonetaryTotal');
  if (!T.taxExclusive) err('BR-13', 'The total without VAT (TaxExclusiveAmount) is missing.', 'LegalMonetaryTotal');
  if (!T.taxInclusive) err('BR-14', 'The total with VAT (TaxInclusiveAmount) is missing.', 'LegalMonetaryTotal');
  if (!T.payable) err('BR-15', 'The amount due (PayableAmount) is missing.', 'LegalMonetaryTotal');
  for (const [k, a] of Object.entries(T)) {
    if (a?.raw && decimals(a.raw) > 2) err('PEPPOL-EN16931-R051', `Total ${k} (${a.raw}) has more than 2 decimals.`, 'LegalMonetaryTotal');
    if (a?.currency && cur && a.currency !== cur) err('PEPPOL-EN16931-R051', `Total ${k} is in ${a.currency} but the document currency is ${cur}.`, 'LegalMonetaryTotal');
  }
  const docAllow = inv.allowanceCharges.filter((a) => !a.charge).reduce((s, a) => s + (a.amount?.value || 0), 0);
  const docCharge = inv.allowanceCharges.filter((a) => a.charge).reduce((s, a) => s + (a.amount?.value || 0), 0);
  if (T.lineExtension && !close(sumLines, T.lineExtension.value)) err('BR-CO-10', `Sum of line amounts is ${fmt(sumLines)}, but LineExtensionAmount says ${fmt(T.lineExtension.value)}.`, 'LegalMonetaryTotal');
  if (T.allowances && !close(docAllow, T.allowances.value)) err('BR-CO-11', `Sum of document-level allowances is ${fmt(docAllow)}, but AllowanceTotalAmount says ${fmt(T.allowances.value)}.`, 'LegalMonetaryTotal');
  if (T.charges && !close(docCharge, T.charges.value)) err('BR-CO-12', `Sum of document-level charges is ${fmt(docCharge)}, but ChargeTotalAmount says ${fmt(T.charges.value)}.`, 'LegalMonetaryTotal');
  if (T.lineExtension && T.taxExclusive) {
    const exp = r2(T.lineExtension.value - (T.allowances?.value || 0) + (T.charges?.value || 0));
    if (!close(exp, T.taxExclusive.value)) err('BR-CO-13', `Total without VAT should be line total − allowances + charges = ${fmt(exp)}, but it is ${fmt(T.taxExclusive.value)}.`, 'LegalMonetaryTotal');
  }
  const mainTax = inv.taxTotals.find((t) => t.amount?.currency === cur) || inv.taxTotals.find((t) => t.subtotals.length) || null;
  if (!inv.taxTotals.length) err('BR-CO-18', 'There is no VAT breakdown (TaxTotal/TaxSubtotal).', 'TaxTotal');
  if (inv.taxTotals.filter((t) => t.subtotals.length).length > 1) err('PEPPOL-EN16931-R053', 'Only one TaxTotal may contain TaxSubtotals (the one in the document currency).', 'TaxTotal');
  if (inv.taxCurrency && inv.taxCurrency !== cur && !inv.taxTotals.some((t) => t.amount?.currency === inv.taxCurrency)) err('BR-53', `Tax currency ${inv.taxCurrency} is declared but no TaxTotal in that currency is given.`, 'TaxTotal');
  if (mainTax) {
    const sumSub = mainTax.subtotals.reduce((s, x) => s + (x.tax?.value || 0), 0);
    if (mainTax.amount && !close(sumSub, mainTax.amount.value)) err('BR-CO-14', `VAT total is ${fmt(mainTax.amount.value)} but the VAT breakdown adds up to ${fmt(sumSub)}.`, 'TaxTotal');
    if (T.taxExclusive && T.taxInclusive && mainTax.amount) {
      const exp = r2(T.taxExclusive.value + mainTax.amount.value);
      if (!close(exp, T.taxInclusive.value)) err('BR-CO-15', `Total with VAT should be ${fmt(T.taxExclusive.value)} + VAT ${fmt(mainTax.amount.value)} = ${fmt(exp)}, but it is ${fmt(T.taxInclusive.value)}.`, 'LegalMonetaryTotal');
    }
    // Per category: taxable base and VAT amount.
    for (const s of mainTax.subtotals) {
      const cat = s.category;
      const where = `VAT ${cat || '?'} ${s.percent ?? ''}%`;
      if (!VAT_CATEGORIES[cat]) err('BR-CL-17', `"${cat}" is not a valid VAT category code (use S, Z, E, AE, K, G, O, L or M).`, where);
      const base = inv.lines.filter((l) => l.taxCategory === cat && (l.taxPercent ?? 0) === (s.percent ?? 0)).reduce((a, l) => a + (l.lineExtension?.value || 0), 0)
        - inv.allowanceCharges.filter((a) => !a.charge && a.taxCategory === cat && (a.taxPercent ?? 0) === (s.percent ?? 0)).reduce((a, x) => a + (x.amount?.value || 0), 0)
        + inv.allowanceCharges.filter((a) => a.charge && a.taxCategory === cat && (a.taxPercent ?? 0) === (s.percent ?? 0)).reduce((a, x) => a + (x.amount?.value || 0), 0);
      if (s.taxable && !close(base, s.taxable.value)) err(`BR-${cat}-08`, `${where}: taxable amount should be the sum of its lines ± allowances/charges = ${fmt(base)}, but it is ${fmt(s.taxable.value)}.`, where);
      if (s.taxable && s.tax && s.percent != null) {
        const expTax = r2((s.taxable.value * s.percent) / 100);
        if (!close(expTax, s.tax.value, 0.01)) err('BR-CO-17', `${where}: VAT should be ${fmt(s.taxable.value)} × ${s.percent}% = ${fmt(expTax)}, but it is ${fmt(s.tax.value)}.`, where);
      }
      if (['E', 'AE', 'K', 'G', 'O'].includes(cat) && !s.exemptionCode && !s.exemptionReason) err(`BR-${cat}-10`, `${where}: an exemption reason (TaxExemptionReason or code) is required for category ${cat} (${VAT_CATEGORIES[cat]}).`, where);
      if (cat === 'AE') {
        if (!inv.customer?.vat) err('BR-AE-02', 'Reverse charge (AE) requires the buyer’s VAT number.', 'Buyer VAT');
        if (!inv.supplier?.vat) err('BR-AE-02', 'Reverse charge (AE) requires the seller’s VAT number.', 'Seller VAT');
      }
      if (cat === 'K') {
        if (!inv.customer?.vat) err('BR-IC-02', 'Intra-community supply (K) requires the buyer’s VAT number.', 'Buyer VAT');
        if (!inv.delivery?.date && !inv.period) err('BR-IC-11', 'Intra-community supply (K) requires a delivery date or invoicing period.', 'Delivery');
      }
    }
  }
  if (T.taxInclusive && T.payable) {
    const exp = r2(T.taxInclusive.value - (T.prepaid?.value || 0) + (T.rounding?.value || 0));
    if (!close(exp, T.payable.value)) err('BR-CO-16', `Amount due should be total with VAT − prepaid + rounding = ${fmt(exp)}, but it is ${fmt(T.payable.value)}.`, 'LegalMonetaryTotal');
  }
  if (T.payable && T.payable.value > 0 && !inv.dueDate && !inv.paymentTerms.length) err('BR-CO-25', 'When an amount is due, give a due date or payment terms.', 'DueDate');

  // ---- payment ----
  for (const p of inv.paymentMeans) {
    const where = `PaymentMeans ${p.code}`;
    if (!PAYMENT_MEANS[p.code] && !/^\d+$/.test(p.code)) err('BR-CL-16', `Payment means code "${p.code}" is not in the UNCL 4461 list.`, where);
    if (['30', '58'].includes(p.code) && !p.iban) err('BR-61', 'A credit transfer (code 30/58) needs the payee account (PayeeFinancialAccount/ID).', where);
    if (['49', '59'].includes(p.code) && !p.mandate) err('PEPPOL-EN16931-R061', 'A direct debit needs the mandate reference (PaymentMandate/ID).', where);
    if (p.iban && /^[A-Z]{2}\d{2}/.test(p.iban.replace(/\s/g, ''))) {
      const ib = parseIban(p.iban);
      if (!ib.valid) err('BE-PAY-01', `Payee IBAN ${p.iban} is not valid: ${ib.errors.join(' ')}`, where);
      else if (/\s/.test(p.iban)) warn('BE-PAY-02', `Write the IBAN without spaces: ${ib.iban}.`, where);
    }
    if (p.paymentId) {
      const digits = p.paymentId.replace(/\D/g, '');
      if (/^[+*]{3}|^\d{3}\/\d{4}\/\d{5}/.test(p.paymentId.trim()) || (digits.length === 12 && /^[\d+*/\s]+$/.test(p.paymentId))) {
        const o = parseOgm(p.paymentId);
        if (!o.valid) err('BE-PAY-03', `Payment reference ${p.paymentId} looks like a Belgian structured communication (OGM) but ${o.errors.join(' ')}`, where);
      } else if (/^RF\d\d/i.test(p.paymentId.replace(/\s/g, ''))) {
        const r = parseRf(p.paymentId);
        if (!r.valid) err('BE-PAY-04', `RF creditor reference ${p.paymentId} has wrong check digits.`, where);
      }
    }
  }
  if (!inv.paymentMeans.length && T.payable?.value > 0) warn('BR-49', 'No payment instructions (PaymentMeans) are given for an amount due.', 'PaymentMeans');

  // ---- attachments ----
  for (const a of inv.attachments) {
    if (a.base64 && !a.mime) err('BR-CL-24', `Attachment ${a.id}: the mimeCode is missing.`, 'AdditionalDocumentReference');
    if (a.base64 && a.mime && !['application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet'].includes(a.mime)) {
      err('BR-CL-24', `Attachment ${a.id}: mimeCode ${a.mime} is not allowed in Peppol (PDF, PNG, JPEG, CSV, XLSX, ODS).`, 'AdditionalDocumentReference');
    }
    if (a.base64 && !a.filename) err('BR-CL-24', `Attachment ${a.id}: the filename attribute is missing.`, 'AdditionalDocumentReference');
  }
  return out;
}

export { VAT_CATEGORIES };
