import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEnterprise, parseIban, parseOgm, parsePeppolId,
  parseCoda, parseCamt, readUbl, validateInvoice,
  parseIntervat, parseXbrl, epcPayload,
  wgs84ToLambert72, lambert72ToWgs84
} from '../src/index.js';
import { parseXml } from '../src/xml.js';

import codaSample from '../samples/coda.js';
import camtSample from '../samples/camt053.js';
import ublSample from '../samples/ubl-invoice.js';
import { vatReturn } from '../samples/intervat.js';
import { xbrlCurrent } from '../samples/xbrl.js';

test('Belgian identifiers', () => {
  assert.equal(parseEnterprise('BE 0753.124.628').valid, true);
  assert.equal(parseIban('BE73 7350 1234 5660').valid, true);
  assert.equal(parseOgm('+++202/6000/12320+++').valid, true);
  assert.equal(parsePeppolId('0208:0753124628').valid, true);
});

test('CODA and CAMT', () => {
  const [coda] = parseCoda(codaSample);
  assert.ok(coda.transactions.length > 0);
  const camt = parseCamt(parseXml(camtSample).root);
  assert.ok(Array.isArray(camt) ? camt.length : camt.statements.length);
});

test('UBL and Peppol checks', () => {
  const inv = readUbl(parseXml(ublSample).root);
  assert.equal(validateInvoice(inv).length, 0);
});

test('Intervat and XBRL', () => {
  assert.ok(parseIntervat(parseXml(vatReturn).root).items.length);
  assert.ok(parseXbrl(parseXml(xbrlCurrent).root).facts.length);
});

test('EPC and Lambert', () => {
  const qr = epcPayload({ name: 'Example BV', iban: 'BE73735012345660', amount: 12.5 });
  assert.equal(qr.errors.length, 0);
  const [x, y] = wgs84ToLambert72(50.846777, 4.35236);
  const [lat, lon] = lambert72ToWgs84(x, y);
  assert.ok(Math.abs(lat - 50.846777) < 1e-7);
  assert.ok(Math.abs(lon - 4.35236) < 1e-7);
});
