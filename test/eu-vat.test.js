import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEuVat, EU_VAT_PREFIXES } from '../src/index.js';

test('EU-27 country scope is explicit', () => {
  assert.equal(EU_VAT_PREFIXES.size, 27);
  assert.equal(parseEuVat('NO998041538MVA').supported, false);
  assert.equal(parseEuVat('GB123456789').supported, false);
  assert.equal(parseEuVat('XI123456789').supported, false);
  assert.equal(parseEuVat('EU123456789').supported, false);
});
test('existing Belgian checksum rules remain authoritative', () => {
  const be = parseEuVat('BE 0417.497.106');
  assert.equal(be.valid, true);
  assert.equal(be.vat, 'BE0417497106');
  assert.equal(be.formatted, '0417.497.106');
  assert.equal(parseEuVat('BE0417497107').valid, false);
  assert.equal(parseEuVat('BE2123456791').valid, false);
  assert.equal(parseEuVat('0417497106').valid, false, 'EU mode requires a country prefix');
});
test('JSVAT checks Germany, France, Poland and Greek EL numbers', () => {
  for (const vat of ['DE136695976', 'FR40303265045', 'PL1132191233', 'EL022188887']) {
    const r = parseEuVat(vat);
    assert.equal(r.valid, true, vat + ': ' + r.errors.join('; '));
  }
  assert.equal(parseEuVat('GR022188887').vat, 'EL022188887');
  assert.equal(parseEuVat('GR022188887').valid, true);
  assert.equal(parseEuVat('PL1234567890').valid, false, 'Poland modulo-11 remainder 10 is invalid');
  assert.equal(parseEuVat('DE111111126').valid, false);
  assert.equal(parseEuVat('FR90000000027').valid, false);
});
test('format checks and normalization do not imply live VAT registration', () => {
  const r = parseEuVat('de 136.695.976');
  assert.equal(r.valid, true);
  assert.equal(r.vat, 'DE136695976');
  assert.equal(r.country, 'Germany');
  assert.equal(parseEuVat('XX999999999').supported, false);
  assert.equal(parseEuVat('not a vat').valid, false);
});

test('the published root exports EU validation and retains the Belgian parser', async () => {
  const { parseEnterprise, parseEuVat, EU_VAT_PREFIXES } = await import('../src/index.js');
  assert.equal(EU_VAT_PREFIXES.size, 27);
  assert.equal(parseEnterprise('0753124628').valid, true);
  assert.equal(parseEuVat('BE0753124628').valid, true);
  assert.equal(parseEuVat('BE0753124629').valid, false);
});
test('offline bulk calling supports mixed-country rows without network access', () => {
  const inputs = ['BE0417497106', 'DE136695976', 'PL1234567890', 'NO998041538MVA'];
  const results = inputs.map(parseEuVat);
  assert.deepEqual(results.map((r) => r.valid), [true, true, false, false]);
  assert.deepEqual(results.map((r) => r.supported), [true, true, true, false]);
  assert.equal(results.every((r) => typeof r.input === 'string' && Array.isArray(r.errors)), true);
});
