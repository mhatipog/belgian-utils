import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseXlsxTables, readLimitedZipEntries } from '../src/xlsx-lite.js';
import { inspectMetadata, cleanMetadata } from '../src/file/metadata.js';

const worksheet = (ref = 'A1', dimension = 'A1') =>
  '<worksheet><dimension ref="' + dimension + '"/><sheetData><row r="1">' +
  '<c r="' + ref + '" t="inlineStr"><is><t>OK</t></is></c>' +
  '</row></sheetData></worksheet>';
const zip = files => zipSync(Object.fromEntries(
  Object.entries(files).map(([name, data]) => [name, strToU8(data)])), { level: 6 });
const workbook = (xml = worksheet()) =>
  zip({ 'xl/workbook.xml': '<workbook/>', 'xl/worksheets/sheet1.xml': xml });
const props = () => zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Private" state="hidden"/></sheets></workbook>',
  'docProps/core.xml': '<cp:coreProperties><dc:creator>Alice</dc:creator></cp:coreProperties>',
  'docProps/app.xml': '<Properties><Company>Private Company</Company></Properties>',
});
const centralOffset = bytes => {
  for (let i = 0; i < bytes.length - 4; i++)
    if (new DataView(bytes.buffer, bytes.byteOffset + i, 4).getUint32(0, true) === 0x02014b50) return i;
  throw Error('Missing central directory in test fixture');
};
const forge = (source, offset, value) => {
  const bytes = source.slice();
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(centralOffset(bytes) + offset, value, true);
  return bytes;
};

test('valid compressed worksheet and Office metadata remain readable and cleanable', async () => {
  const result = await parseXlsxTables(workbook());
  assert.equal(result[0].name, 'Sheet 1');
  assert.deepEqual(result[0].rows, [['OK']]);
  const inspected = await inspectMetadata(props());
  assert.equal(inspected.format, 'xlsx');
  assert.equal(inspected.signals.hiddenSheets, 1);
  assert.ok(inspected.fields.some(f => f.value === 'Alice'));
  const { bytes } = await cleanMetadata(props());
  const parts = await readLimitedZipEntries(bytes);
  assert.ok(parts.some(f => f.name === 'xl/workbook.xml'));
  assert.ok(!new TextDecoder().decode(parts.find(f => f.name === 'docProps/core.xml').data).includes('Alice'));
});

test('entry count, actual per-entry output and total actual output are bounded', async () => {
  await assert.rejects(() => readLimitedZipEntries(zip({ a: 'a', b: 'b' }),
    { limits: { maxEntries: 1 } }), /entry count/);
  await assert.rejects(() => readLimitedZipEntries(zip({ big: 'Q'.repeat(1000) }),
    { limits: { maxEntryBytes: 100 } }), /limit|size/);
  await assert.rejects(() => readLimitedZipEntries(zip({ a: 'a'.repeat(75), b: 'b'.repeat(75) }),
    { limits: { maxEntryBytes: 100, maxTotalBytes: 100 } }), /limit/);
});

test('forged uncompressed ZIP sizes cannot bypass streaming limits or size verification', async () => {
  const original = zip({ bomb: 'a'.repeat(2000) });
  const falsified = forge(original, 24, 1); // central-directory uncompressed size
  await assert.rejects(() => readLimitedZipEntries(falsified, {
    limits: { maxEntryBytes: 100 },
  }), /limit/);
  const smaller = forge(zip({ a: 'small' }), 24, 3);
  await assert.rejects(() => readLimitedZipEntries(smaller), /declared size/);
});

test('compression ratio is bounded even with forged header sizes', async () => {
  const forged = forge(zip({ a: 'b'.repeat(4000) }), 24, 1);
  await assert.rejects(() => readLimitedZipEntries(forged,
    { limits: { maxCompressionRatio: 3 } }), /ratio|limit/);
});

test('invalid local offsets and compressed lengths are rejected before decompression', async () => {
  const normal = zip({ a: 'hello' });
  await assert.rejects(() => readLimitedZipEntries(forge(normal, 42, 0xfffffff0)),
    /offset/);
  await assert.rejects(() => readLimitedZipEntries(forge(normal, 20, 0xffffffff)),
    /offset|size/);
});

test('extreme cell references and declared worksheet dimensions are refused', async () => {
  await assert.rejects(() => parseXlsxTables(workbook(worksheet('XFE1'))), /reference|dimension/);
  await assert.rejects(() => parseXlsxTables(workbook(worksheet('A1048577'))), /reference|dimension/);
  await assert.rejects(() => parseXlsxTables(workbook(worksheet('A1', 'A1:XFD1048576'))),
    /reference|dimension/);
  await assert.rejects(() => parseXlsxTables(workbook(worksheet('B1')), {
    limits: { maxColumns: 1 },
  }), /reference|dimension/);
  await assert.rejects(() => parseXlsxTables(workbook(worksheet('A1')), {
    limits: { maxCells: 0 },
  }), /limit/);
});

test('metadata inspection skips unrelated OOXML media, but cleaning still verifies it', async () => {
  const original = zip({
    'xl/workbook.xml': '<workbook/>',
    'docProps/core.xml': '<cp:coreProperties><dc:creator>Alice</dc:creator></cp:coreProperties>',
    'xl/media/large.png': 'PAYLOAD'.repeat(100),
  });
  const damaged = original.slice();
  // Corrupt the compressed stream for the first local entry (which is a required XML part
  // or a media part depending on ZIP ordering). Target the media entry by its local name.
  for (let p = 0; p + 30 < damaged.length;) {
    const view = new DataView(damaged.buffer, damaged.byteOffset);
    if (view.getUint32(p, true) !== 0x04034b50) break;
    const nl = view.getUint16(p + 26, true), extra = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(damaged.subarray(p + 30, p + 30 + nl));
    const size = view.getUint32(p + 18, true), start = p + 30 + nl + extra;
    if (name === 'xl/media/large.png') { damaged.fill(0xff, start, start + Math.min(8, size)); break; }
    p = start + size;
  }
  assert.equal((await inspectMetadata(damaged)).format, 'xlsx');
  await assert.rejects(() => cleanMetadata(damaged));
});

test('metadata inspection respects the same configurable limits', async () => {
  await assert.rejects(() => inspectMetadata(props(), { limits: { maxEntries: 1 } }), /entry count/);
  await assert.rejects(() => inspectMetadata(props(), { limits: { maxEntryBytes: 20 } }), /limit|size/);
});
