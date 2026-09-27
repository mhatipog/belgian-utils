// Identify files and pasted text - generic formats and Belgian business /
// government files - from their contents, locally. This module only says
// *what* something is (a `kind` plus facts); which tools to offer is decided
// by the shared action graph in src/ui/actions.js.
//
//   detectBytes(head, name) - binary signatures (PDF, images, DER, ZIP)
//   detectText(text, name)  - text formats (CODA, XML families, JSON, CSV…)

import { parseXml, find, findAll, val, text, attr, descendants } from '../xml.js';
import { isCoda } from './coda.js';
import { isCamt, camtKind } from './camt.js';
import { isXbrl, classifyTaxonomy } from './xbrl.js';
import { isIntervat, INTERVAT_KINDS } from './intervat.js';

const SIGNATURES = [
  { bytes: [0x25, 0x50, 0x44, 0x46], kind: 'pdf', label: 'PDF document' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], kind: 'image', label: 'PNG image' },
  { bytes: [0xff, 0xd8, 0xff], kind: 'image', label: 'JPEG image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], kind: 'image', label: 'GIF image' },
  { bytes: [0x42, 0x4d], kind: 'image', label: 'BMP image' },
  { bytes: [0x00, 0x00, 0x01, 0x00], kind: 'image', label: 'ICO icon' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: 'zip', label: 'ZIP archive' },
];

const r = (kind, label, family, extra = {}) => ({ kind, format: extra.format || kind, label, family, facts: [], ...extra });

/** @param {Uint8Array} head first bytes of the file (≥ 16) */
export function detectBytes(head, name = '') {
  // WebP: "RIFF" .... "WEBP"
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') {
    return r('image', 'WebP image', 'image');
  }
  for (const s of SIGNATURES) {
    if (s.bytes.every((b, i) => head[i] === b)) {
      if (s.kind === 'zip') {
        const office = /\.(xlsx|docx|pptx|odt|ods)$/i.exec(name);
        return r('zip', office ? `Office document (.${office[1].toLowerCase()})` : 'ZIP archive', 'binary');
      }
      return r(s.kind, s.label, s.kind === 'pdf' ? 'document' : 'image');
    }
  }
  // DER certificate: SEQUENCE with a long length, then SEQUENCE (tbsCertificate).
  if (head[0] === 0x30 && (head[1] === 0x82 || head[1] === 0x83) && head[4] === 0x30) {
    return r('cert', 'X.509 certificate (DER) - e.g. an eID certificate', 'security', { format: 'x509-der', binary: true });
  }
  const printable = head.slice(0, 512).every((b) => b === 9 || b === 10 || b === 13 || b >= 32);
  return printable ? null : r('binary', 'Unknown binary file', 'binary');
}

const count = (root, re) => descendants(root).filter((e) => re.test(e.local)).length;

function describeXml(root, name) {
  const ns = root.ns || '';
  const local = root.local;

  if (isCamt(root)) {
    const k = camtKind(root);
    const names = { 'camt.052': 'intraday account report', 'camt.053': 'bank statement', 'camt.054': 'debit/credit notification' };
    return r('camt', `ISO 20022 ${k.message} ${names[k.message]} (v${k.version})`, 'bank', {
      format: k.message,
      facts: [['Entries', descendants(root, 'Ntry').length], ['Statements', descendants(root, 'Stmt').length || descendants(root, 'Rpt').length || descendants(root, 'Ntfctn').length]],
    });
  }
  const pain = /pain\.(001|008)\.001\.(\d+)/.exec(ns);
  if (pain) {
    const init = pain[1] === '001' ? 'CstmrCdtTrfInitn' : 'CstmrDrctDbtInitn';
    return r('pain', pain[1] === '001' ? 'SEPA credit transfer order (pain.001)' : 'SEPA direct debit order (pain.008)', 'bank', {
      format: `pain.${pain[1]}`,
      facts: [['Payments', descendants(root, pain[1] === '001' ? 'CdtTrfTxInf' : 'DrctDbtTxInf').length], ['Control sum', val(root, `${init}/GrpHdr/CtrlSum`)], ['Created', val(root, `${init}/GrpHdr/CreDtTm`)]],
    });
  }

  // UBL, optionally inside a Peppol StandardBusinessDocument envelope.
  let doc = root;
  let sbdh = false;
  if (local === 'StandardBusinessDocument') {
    sbdh = true;
    doc = descendants(root).find((e) => e.local === 'Invoice' || e.local === 'CreditNote') || root;
  }
  if ((doc.local === 'Invoice' || doc.local === 'CreditNote') && /ubl:schema:xsd/.test(doc.ns || '')) {
    const cust = val(doc, 'CustomizationID');
    const peppol = /peppol/i.test(cust);
    return r('ubl', `${doc.local === 'CreditNote' ? 'Credit note' : 'Invoice'} - UBL 2.1${peppol ? ', Peppol BIS Billing 3.0' : ''}${sbdh ? ' in an SBDH envelope' : ''}`, 'einvoice', {
      facts: [['Number', val(doc, 'ID')], ['Issue date', val(doc, 'IssueDate')],
        ['Seller', val(doc, 'AccountingSupplierParty/Party/PartyLegalEntity/RegistrationName') || val(doc, 'AccountingSupplierParty/Party/PartyName/Name')],
        ['Buyer', val(doc, 'AccountingCustomerParty/Party/PartyLegalEntity/RegistrationName') || val(doc, 'AccountingCustomerParty/Party/PartyName/Name')],
        ['Payable', `${val(doc, 'LegalMonetaryTotal/PayableAmount')} ${val(doc, 'DocumentCurrencyCode')}`.trim()], ['Customization', cust]],
      values: {
        sellerVat: val(doc, 'AccountingSupplierParty/Party/PartyTaxScheme/CompanyID'),
        buyerVat: val(doc, 'AccountingCustomerParty/Party/PartyTaxScheme/CompanyID'),
        paymentRef: val(doc, 'PaymentMeans/PaymentID'),
      },
    });
  }
  if (isXbrl(root)) {
    const t = classifyTaxonomy(descendants(root, 'schemaRef').map((s) => attr(s, 'href')));
    return r('xbrl', `${t.label}${t.version ? ` (taxonomy ${t.version})` : ''}`, 'gov', {
      facts: [['Facts', descendants(root).filter((e) => 'contextRef' in e.attrs).length], ['Contexts', descendants(root, 'context').length]],
    });
  }
  if (isIntervat(root)) {
    const item = local === 'VATConsignment' ? 'VATDeclaration' : local === 'IntraConsignment' ? 'IntraListing' : 'ClientListing';
    return r('intervat', `Intervat: ${INTERVAT_KINDS[local]}`, 'gov', { facts: [['Declarant VAT', val(root, `${item}/Declarant/VATNumber`)]] });
  }
  if (/^DmfA/i.test(local) || /dmfa/i.test(ns)) {
    return r('dmfa', 'DmfA quarterly social security declaration (RSZ/ONSS)', 'social', {
      sensitive: true,
      facts: [['Quarter', text(descendants(root, 'Quarter')[0])], ['Employer ID', text(descendants(root, 'CompanyID')[0]) || text(descendants(root, 'NOSSRegistrationNbr')[0])],
        ['Workers', count(root, /^NaturalPerson$/)], ['Worker lines', count(root, /^Worker(Record)?$/)]],
    });
  }
  if (/^Dimona/i.test(local)) return r('dimona', 'Dimona declaration (RSZ/ONSS)', 'social', { sensitive: true });
  if (local === 'Verzendingen' || local === 'Envois' || /belcotax/i.test(ns)) {
    const fiches = {};
    for (const e of descendants(root)) {
      const m = /^(?:Fiche|Opgave|Relev[eé])_?(28\d|32\d)[._]?(\d{2})/i.exec(e.local);
      if (m) fiches[`${m[1]}.${m[2]}`] = (fiches[`${m[1]}.${m[2]}`] || 0) + 1;
    }
    const year = text(descendants(root).find((e) => /inkomstenjaar|annee_revenus|incomeyear/i.test(e.local)));
    return r('belcotax', 'Belcotax-on-web XML (tax forms 281.xx / 325.xx)', 'gov', {
      sensitive: true,
      facts: [['Income year', year], ['Forms', Object.entries(fiches).map(([k, v]) => `${k}: ${v}`).join(' · ')]],
    });
  }
  // SODA (payroll accounting entries from social secretariats, via Codabox).
  // Its schema is not public, so this is a conservative name-based guess.
  if (/soda/i.test(local) || /soda/i.test(ns) || /(^|[^a-z])soda([^a-z]|$)/i.test(name)) {
    return r('soda', 'SODA payroll entries (probably - social secretariat export)', 'social', {
      sensitive: true, facts: [['Root element', root.name], ['Namespace', ns], ['Elements', descendants(root).length + 1]],
    });
  }
  if (local === 'kmehrmessage' || /ehealth\.fgov\.be\/standards\/kmehr/.test(ns)) {
    const types = [...new Set(descendants(root, 'transaction').map((t) => findAll(t, 'cd').find((c) => attr(c, 'S') === 'CD-TRANSACTION')).filter(Boolean).map((c) => text(c)))];
    return r('kmehr', 'KMEHR health message (eHealth Belgium)', 'health', {
      sensitive: true,
      facts: [['Folders', descendants(root, 'folder').length], ['Transactions', descendants(root, 'transaction').length], ['Transaction types', types.join(', ')], ['Standard', val(root, 'header/standard/cd')]],
    });
  }
  if (ns === 'http://hl7.org/fhir') {
    return r('fhir', `HL7 FHIR ${local} (XML)`, 'health', { format: 'fhir-xml', xml: true, sensitive: true, facts: local === 'Bundle' ? [['Entries', findAll(root, 'entry').length]] : [] });
  }
  return r('xml', `XML document <${root.name}>`, 'generic', { facts: [['Namespace', ns], ['Elements', descendants(root).length + 1]] });
}

// Belcotax field names look like "f2002_inkomstenjaar" / "v0002_…".
const BELCOTAX_KEY = /^[fv]\d{4,5}_/i;
function hasBelcotaxKeys(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 4) return false;
  if (Array.isArray(v)) return v.slice(0, 5).some((x) => hasBelcotaxKeys(x, depth + 1));
  const keys = Object.keys(v);
  if (keys.filter((k) => BELCOTAX_KEY.test(k)).length >= 2) return true;
  return keys.slice(0, 30).some((k) => hasBelcotaxKeys(v[k], depth + 1));
}

function describeJson(v) {
  if (v && typeof v === 'object' && typeof v.resourceType === 'string') {
    const entries = Array.isArray(v.entry) ? v.entry : [];
    const byType = {};
    for (const e of entries) { const t = e?.resource?.resourceType || '?'; byType[t] = (byType[t] || 0) + 1; }
    const be = JSON.stringify(v.meta?.profile || []).match(/fhir\.[a-z.]*\.be|ehealth\.fgov\.be/i);
    return r('fhir', `HL7 FHIR ${v.resourceType}${be ? ' (Belgian profile)' : ''}`, 'health', {
      format: 'fhir-json', sensitive: true,
      facts: [['Resource', v.resourceType], ['Entries', entries.length ? Object.entries(byType).map(([k, n]) => `${k}: ${n}`).join(' · ') : ''], ['Profile', (v.meta?.profile || []).join(' ')]],
    });
  }
  if (hasBelcotaxKeys(v)) return r('belcotax', 'Belcotax data (JSON)', 'gov', { format: 'belcotax-json', json: true, sensitive: true });
  return r('json', Array.isArray(v) ? `JSON array (${v.length} items)` : 'JSON document', 'generic', { shape: Array.isArray(v) ? 'array' : typeof v });
}

const CODE_EXT = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', css: 'CSS', html: 'HTML', htm: 'HTML', sql: 'SQL', py: 'Python', sh: 'Shell script', md: 'Markdown', txt: 'Text' };

/** @returns {{ kind, format, label, family, facts, sensitive?, error?, values? }} */
export function detectText(textIn, name = '') {
  const t = String(textIn).replace(/^﻿/, '');
  const head = t.trimStart().slice(0, 200);
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';

  if (isCoda(t)) {
    const lines = t.split(/\r?\n/).filter(Boolean);
    const acc = lines.find((l) => /^1/.test(l));
    return r('coda', 'CODA bank statement (Febelfin)', 'bank', {
      facts: [['Records', lines.length], ['Movements', lines.filter((l) => /^21/.test(l)).length], ['Account', acc ? acc.slice(5, 42).trim() : '']],
    });
  }
  if (/^-----BEGIN (CERTIFICATE|X509 CRL|PKCS7|TRUSTED CERTIFICATE)/m.test(t)) {
    return r('cert', 'X.509 certificate (PEM)', 'security', { format: 'x509-pem', facts: [['Certificates', (t.match(/-----BEGIN (?:TRUSTED )?CERTIFICATE-----/g) || []).length]] });
  }
  if (head.startsWith('<')) {
    try {
      return describeXml(parseXml(t).root, name);
    } catch (e) {
      return r('xml', 'XML that is not well-formed', 'generic', { format: 'xml-invalid', error: `${e.message}${e.line ? ` (line ${e.line}, column ${e.col})` : ''}` });
    }
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      return describeJson(JSON.parse(t));
    } catch { /* maybe JSON Lines, lenient JSON or CSV */ }
    const lines = t.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1 && lines.slice(0, 50).every((l) => { try { JSON.parse(l); return true; } catch { return false; } })) {
      const first = JSON.parse(lines[0]);
      if (hasBelcotaxKeys(first)) return r('belcotax', 'Belcotax data (JSON Lines)', 'gov', { format: 'belcotax-jsonl', json: true, sensitive: true, facts: [['Records', lines.length]] });
      return r('jsonl', `JSON Lines (${lines.length} records)`, 'generic', { facts: [['Records', lines.length]] });
    }
    if (/^\s*[{[]/.test(t) && /[}\]]\s*$/.test(t)) return r('json', 'JSON with comments or trailing commas', 'generic', { lenient: true });
  }
  if (/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/.test(t.trim())) return r('jwt', 'JSON Web Token', 'security');
  if (ext === 'sql' || (/^\s*(select|insert|update|delete|create|alter|with)\b/i.test(head) && /;\s*$|\bfrom\b/i.test(t.slice(0, 2000)))) return r('sql', 'SQL', 'code');
  if (['js', 'mjs', 'cjs', 'ts', 'css', 'html', 'htm'].includes(ext)) return r('code', `${CODE_EXT[ext]} file`, 'code', { lang: ext });
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  for (const d of [';', ',', '\t']) {
    const counts = lines.map((l) => l.split(d).length);
    if (lines.length >= 2 && counts[0] > 1 && counts.every((c) => c === counts[0])) {
      return r('csv', `${d === '\t' ? 'Tab' : d === ';' ? 'Semicolon' : 'Comma'}-separated table (${counts[0]} columns)`, 'generic', { delimiter: d });
    }
  }
  if (/\.(ya?ml)$/i.test(name) || (lines.length >= 2 && lines.filter((l) => /^\s*(- )?[\w"'.-]+:(\s|$)/.test(l)).length >= Math.min(lines.length, 2))) {
    return r('yaml', 'YAML', 'generic');
  }
  return r('text', CODE_EXT[ext] ? `${CODE_EXT[ext]} text` : 'Plain text', 'generic', { facts: [['Lines', t.split(/\r?\n/).length]] });
}
