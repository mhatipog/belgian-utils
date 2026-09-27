// Anonymise a UBL invoice tree in place: parties, contacts, addresses,
// identifiers, bank accounts and payment references are replaced with
// fictional but valid values; amounts, items and dates are kept.
import { descendants, elements, text } from '../xml.js';
import { makeFaker } from './fake.js';
import { ogmCheck } from './ids.js';

function setText(node, value) {
  node.children = [value];
}

export function anonymizeUbl(root, faker = makeFaker()) {
  const entMap = (digits) => faker.enterprise(digits);
  const walk = (n) => {
    for (const e of elements(n)) {
      const t = text(e);
      const parent = e.parent?.local;
      switch (e.local) {
        case 'RegistrationName':
          setText(e, faker.name(t)); break;
        case 'Name':
          if (parent === 'PartyName' || parent === 'PayeeFinancialAccount') setText(e, faker.name(t));
          else if (parent === 'Contact') setText(e, faker.person(t));
          break;
        case 'StreetName': case 'AdditionalStreetName': case 'AddressLine':
          if (t) setText(e, faker.street(t)); break;
        case 'ElectronicMail': setText(e, faker.email(t)); break;
        case 'Telephone': setText(e, faker.phone(t)); break;
        case 'EndpointID': case 'CompanyID': case 'ID': {
          const scheme = e.attrs.schemeID || '';
          if (e.local === 'ID' && !['PartyIdentification', 'PayeeFinancialAccount'].includes(parent)) break;
          if (parent === 'PayeeFinancialAccount' || /^[A-Z]{2}\d{2}[A-Z0-9]{8,}$/.test(t.replace(/\s/g, ''))) {
            if (parent === 'PayeeFinancialAccount' || parent === 'PayerFinancialAccount') setText(e, faker.iban(t.replace(/\s/g, '')));
            break;
          }
          if (/^BE\d{10}$/i.test(t)) setText(e, `BE${entMap(t.slice(2))}`);
          else if (/^\d{10}$/.test(t) && (scheme === '0208' || /^[01]/.test(t))) setText(e, entMap(t));
          else if (t) setText(e, faker.ref(t));
          break;
        }
        case 'PaymentID': {
          const d = t.replace(/\D/g, '');
          if (d.length === 12) {
            const ten = faker.ogmDigits(d).slice(0, 10);
            const n = ten + ogmCheck(ten);
            setText(e, /\+/.test(t) ? `+++${n.slice(0, 3)}/${n.slice(3, 7)}/${n.slice(7)}+++` : n);
          } else if (t) setText(e, faker.ref(t));
          break;
        }
        case 'EmbeddedDocumentBinaryObject':
          setText(e, ''); e.attrs.filename = 'removed.pdf'; break;
        case 'Note':
          if (parent === 'Invoice' || parent === 'CreditNote') setText(e, faker.text(t));
          break;
        default:
      }
      walk(e);
    }
  };
  walk(root);
  // Drop now-empty attachments' references to the removed file.
  for (const a of descendants(root, 'Attachment')) {
    const b = elements(a).find((x) => x.local === 'EmbeddedDocumentBinaryObject');
    if (b) b.children = ['UmVtb3ZlZCBieSBhbm9ueW1pc2F0aW9u']; // "Removed by anonymisation"
  }
  return root;
}
