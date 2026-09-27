// Human-readable names for common Peppol document type identifiers.
const KNOWN = [
  [/poacc:billing:3\.0/, /CreditNote-2::CreditNote/, 'Credit note (Peppol BIS Billing 3.0)'],
  [/poacc:billing:3\.0/, /Invoice-2::Invoice/, 'Invoice (Peppol BIS Billing 3.0)'],
  [/poacc:selfbilling:3\.0/, /CreditNote/, 'Self-billing credit note (BIS 3.0)'],
  [/poacc:selfbilling:3\.0/, /Invoice/, 'Self-billing invoice (BIS 3.0)'],
  [/trns:order/, /Order-2::Order/, 'Order (Peppol BIS Order)'],
  [/trns:order_response/, /OrderResponse/, 'Order response'],
  [/trns:despatch_advice/, /DespatchAdvice/, 'Despatch advice'],
  [/trns:catalogue/, /Catalogue/, 'Catalogue'],
  [/trns:mlr/, /ApplicationResponse/, 'Message level response (MLR)'],
  [/poacc:invoice_response/, /ApplicationResponse/, 'Invoice response'],
  [/xrechnung/, /Invoice/, 'XRechnung invoice (Germany)'],
  [/nlcius/, /Invoice/, 'SI-UBL / NLCIUS invoice (Netherlands)'],
  [/CrossIndustryInvoice/, /./, 'UN/CEFACT Cross Industry Invoice'],
];

export function describeDocType(id) {
  const s = String(id || '');
  for (const [a, b, label] of KNOWN) if (a.test(s) && b.test(s)) return label;
  const root = /::([A-Za-z]+)##/.exec(s);
  return root ? root[1] : 'Other document type';
}
