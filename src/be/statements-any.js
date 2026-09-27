// Parse either a CODA file or CAMT XML into statements.
import { parseCoda, isCoda } from './coda.js';
import { parseCamt } from './camt.js';
import { parseXml } from '../xml.js';

export function parseAnyStatement(text) {
  const t = String(text).trimStart();
  if (t.startsWith('<')) return parseCamt(parseXml(t).root);
  if (isCoda(t) || /^0/.test(t)) return parseCoda(t);
  throw new Error('Not a CODA file or CAMT XML.');
}
