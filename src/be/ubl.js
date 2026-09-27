// UBL 2.1 Invoice / CreditNote (Peppol BIS Billing 3.0) → normalised model.
import { find, findAll, val, text, attr, elements } from '../xml.js';

export const BIS3_CUSTOMIZATION = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const BIS3_PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const num = (s) => (s === '' || s == null ? null : Number(s));

function address(node) {
  if (!node) return null;
  return {
    street: val(node, 'StreetName'),
    additional: val(node, 'AdditionalStreetName'),
    city: val(node, 'CityName'),
    postalCode: val(node, 'PostalZone'),
    subdivision: val(node, 'CountrySubentity'),
    country: val(node, 'Country/IdentificationCode'),
  };
}

const party = (wrapper) => partyFromNode(find(wrapper, 'Party'));

function partyFromNode(p) {
  if (!p) return null;
  const endpoint = find(p, 'EndpointID');
  const taxSchemes = findAll(p, 'PartyTaxScheme').map((t) => ({ companyId: val(t, 'CompanyID'), scheme: val(t, 'TaxScheme/ID') }));
  const legal = find(p, 'PartyLegalEntity');
  const legalId = find(legal, 'CompanyID');
  return {
    endpointId: text(endpoint),
    endpointScheme: attr(endpoint, 'schemeID'),
    identifiers: findAll(p, 'PartyIdentification').map((i) => ({ id: val(i, 'ID'), scheme: attr(find(i, 'ID'), 'schemeID') })),
    name: val(p, 'PartyName/Name'),
    registrationName: val(legal, 'RegistrationName'),
    legalId: text(legalId),
    legalIdScheme: attr(legalId, 'schemeID'),
    legalForm: val(legal, 'CompanyLegalForm'),
    vat: (taxSchemes.find((t) => t.scheme === 'VAT') || {}).companyId || '',
    taxSchemes,
    address: address(find(p, 'PostalAddress')),
    contact: find(p, 'Contact') ? { name: val(p, 'Contact/Name'), phone: val(p, 'Contact/Telephone'), email: val(p, 'Contact/ElectronicMail') } : null,
  };
}

function amount(node) {
  if (!node) return null;
  return { value: num(text(node)), currency: attr(node, 'currencyID'), raw: text(node) };
}

function allowanceCharges(node) {
  return findAll(node, 'AllowanceCharge').map((a) => ({
    charge: val(a, 'ChargeIndicator') === 'true',
    reasonCode: val(a, 'AllowanceChargeReasonCode'),
    reason: val(a, 'AllowanceChargeReason'),
    percent: num(val(a, 'MultiplierFactorNumeric')),
    amount: amount(find(a, 'Amount')),
    base: amount(find(a, 'BaseAmount')),
    taxCategory: val(a, 'TaxCategory/ID'),
    taxPercent: num(val(a, 'TaxCategory/Percent')),
  }));
}

/** Read a parsed UBL document (root element) into a plain object. */
export function readUbl(root) {
  const type = root.local; // Invoice | CreditNote
  if (type !== 'Invoice' && type !== 'CreditNote') throw new Error(`The root element is <${root.name}>, not a UBL Invoice or CreditNote.`);
  const isCredit = type === 'CreditNote';
  const lineTag = isCredit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = isCredit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const inv = {
    type,
    customizationId: val(root, 'CustomizationID'),
    profileId: val(root, 'ProfileID'),
    id: val(root, 'ID'),
    issueDate: val(root, 'IssueDate'),
    dueDate: val(root, 'DueDate') || val(root, 'PaymentMeans/PaymentDueDate'),
    typeCode: val(root, isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    notes: findAll(root, 'Note').map(text),
    taxPointDate: val(root, 'TaxPointDate'),
    currency: val(root, 'DocumentCurrencyCode'),
    taxCurrency: val(root, 'TaxCurrencyCode'),
    accountingCost: val(root, 'AccountingCost'),
    buyerReference: val(root, 'BuyerReference'),
    period: find(root, 'InvoicePeriod') ? { start: val(root, 'InvoicePeriod/StartDate'), end: val(root, 'InvoicePeriod/EndDate') } : null,
    orderReference: val(root, 'OrderReference/ID'),
    salesOrderReference: val(root, 'OrderReference/SalesOrderID'),
    billingReference: val(root, 'BillingReference/InvoiceDocumentReference/ID'),
    contractReference: val(root, 'ContractDocumentReference/ID'),
    projectReference: val(root, 'ProjectReference/ID'),
    supplier: party(find(root, 'AccountingSupplierParty')),
    customer: party(find(root, 'AccountingCustomerParty')),
    payee: partyFromNode(find(root, 'PayeeParty')),
    delivery: find(root, 'Delivery') ? {
      date: val(root, 'Delivery/ActualDeliveryDate'),
      locationId: val(root, 'Delivery/DeliveryLocation/ID'),
      address: address(find(root, 'Delivery/DeliveryLocation/Address')),
      partyName: val(root, 'Delivery/DeliveryParty/PartyName/Name'),
    } : null,
    paymentMeans: findAll(root, 'PaymentMeans').map((p) => ({
      code: val(p, 'PaymentMeansCode'),
      name: attr(find(p, 'PaymentMeansCode'), 'name'),
      paymentId: val(p, 'PaymentID'),
      iban: val(p, 'PayeeFinancialAccount/ID'),
      accountName: val(p, 'PayeeFinancialAccount/Name'),
      bic: val(p, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID'),
      mandate: val(p, 'PaymentMandate/ID'),
      debitedAccount: val(p, 'PaymentMandate/PayerFinancialAccount/ID'),
      card: val(p, 'CardAccount/PrimaryAccountNumberID'),
    })),
    paymentTerms: findAll(root, 'PaymentTerms').map((t) => val(t, 'Note')).filter(Boolean),
    allowanceCharges: elements(root).filter((e) => e.local === 'AllowanceCharge').length ? allowanceCharges({ children: elements(root).filter((e) => e.local === 'AllowanceCharge') }) : [],
    taxTotals: findAll(root, 'TaxTotal').map((t) => ({
      amount: amount(find(t, 'TaxAmount')),
      subtotals: findAll(t, 'TaxSubtotal').map((s) => ({
        taxable: amount(find(s, 'TaxableAmount')),
        tax: amount(find(s, 'TaxAmount')),
        category: val(s, 'TaxCategory/ID'),
        percent: num(val(s, 'TaxCategory/Percent')),
        exemptionCode: val(s, 'TaxCategory/TaxExemptionReasonCode'),
        exemptionReason: val(s, 'TaxCategory/TaxExemptionReason'),
        scheme: val(s, 'TaxCategory/TaxScheme/ID'),
      })),
    })),
    totals: (() => {
      const t = find(root, 'LegalMonetaryTotal');
      const g = (n) => amount(find(t, n));
      return {
        lineExtension: g('LineExtensionAmount'), taxExclusive: g('TaxExclusiveAmount'), taxInclusive: g('TaxInclusiveAmount'),
        allowances: g('AllowanceTotalAmount'), charges: g('ChargeTotalAmount'), prepaid: g('PrepaidAmount'),
        rounding: g('PayableRoundingAmount'), payable: g('PayableAmount'),
      };
    })(),
    attachments: findAll(root, 'AdditionalDocumentReference').map((d) => {
      const b = find(d, 'Attachment/EmbeddedDocumentBinaryObject');
      return {
        id: val(d, 'ID'),
        typeCode: val(d, 'DocumentTypeCode'),
        description: val(d, 'DocumentDescription'),
        filename: attr(b, 'filename'),
        mime: attr(b, 'mimeCode'),
        base64: b ? text(b).replace(/\s+/g, '') : '',
        uri: val(d, 'Attachment/ExternalReference/URI'),
      };
    }),
    lines: findAll(root, lineTag).map((l) => {
      const q = find(l, qtyTag);
      return {
        id: val(l, 'ID'),
        note: val(l, 'Note'),
        quantity: num(text(q)),
        unit: attr(q, 'unitCode'),
        lineExtension: amount(find(l, 'LineExtensionAmount')),
        accountingCost: val(l, 'AccountingCost'),
        period: find(l, 'InvoicePeriod') ? { start: val(l, 'InvoicePeriod/StartDate'), end: val(l, 'InvoicePeriod/EndDate') } : null,
        orderLineRef: val(l, 'OrderLineReference/LineID'),
        allowanceCharges: allowanceCharges({ children: elements(l).filter((e) => e.local === 'AllowanceCharge') }),
        name: val(l, 'Item/Name'),
        description: val(l, 'Item/Description'),
        sellersItemId: val(l, 'Item/SellersItemIdentification/ID'),
        buyersItemId: val(l, 'Item/BuyersItemIdentification/ID'),
        standardItemId: val(l, 'Item/StandardItemIdentification/ID'),
        taxCategory: val(l, 'Item/ClassifiedTaxCategory/ID'),
        taxPercent: num(val(l, 'Item/ClassifiedTaxCategory/Percent')),
        price: amount(find(l, 'Price/PriceAmount')),
        baseQuantity: num(val(l, 'Price/BaseQuantity')) || null,
        node: l,
      };
    }),
  };
  inv.isBis3 = inv.customizationId.startsWith(BIS3_CUSTOMIZATION);
  return inv;
}

/** Flatten for CSV export: one row per line with invoice header columns. */
export function ublToRows(inv) {
  const head = ['invoice_id', 'type', 'issue_date', 'due_date', 'currency', 'supplier', 'supplier_vat', 'customer', 'customer_vat',
    'line_id', 'item', 'sellers_item_id', 'quantity', 'unit', 'price', 'line_net', 'vat_category', 'vat_percent'];
  const rows = inv.lines.map((l) => [inv.id, inv.type, inv.issueDate, inv.dueDate, inv.currency,
    inv.supplier?.registrationName || inv.supplier?.name || '', inv.supplier?.vat || '',
    inv.customer?.registrationName || inv.customer?.name || '', inv.customer?.vat || '',
    l.id, l.name, l.sellersItemId, l.quantity ?? '', l.unit, l.price?.raw ?? '', l.lineExtension?.raw ?? '', l.taxCategory, l.taxPercent ?? '']);
  return [head, ...rows];
}

/** JSON-friendly copy (drops parser nodes and attachment bytes). */
export function ublToJson(inv, { includeAttachments = false } = {}) {
  return JSON.parse(JSON.stringify(inv, (k, v) => {
    if (k === 'node') return undefined;
    if (k === 'base64' && !includeAttachments) return v ? `(${Math.round((v.length * 3) / 4 / 1024)} KB base64 omitted)` : '';
    return v;
  }));
}
