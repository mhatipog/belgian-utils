import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCell,
  readParquetBuffer,
  writeParquet,
  makeDeltaZip,
  appendDeltaZip,
  restoreDeltaZip,
  unzipDelta,
  readDeltaEntries,
  inspectDeltaEntries,
  deltaVersionActions,
  compareDeltaVersions,
  sparkSchema,
} from '../src/parquet-delta.js';

const columns = [
  { name: 'id', type: 'INT64' },
  { name: 'name', type: 'STRING' },
  { name: 'active', type: 'BOOLEAN' },
  { name: 'score', type: 'DOUBLE' },
  { name: 'at', type: 'TIMESTAMP' },
];

const grid = [
  ['9007199254740993', 'Alice', 'true', '12.5', '2026-10-06T07:00:00Z'],
  ['2', 'Bob', 'false', '7', '2026-10-06T08:00:00Z'],
];

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('Parquet editor writes a readable Parquet round trip with inspectable metadata', async () => {
  const buffer = writeParquet(columns, grid, { kvMetadata: [{ key: 'source', value: 'local-test' }] });
  assert.equal(new TextDecoder().decode(new Uint8Array(buffer, 0, 4)), 'PAR1');
  const result = await readParquetBuffer(buffer, 'sample.parquet');
  assert.equal(result.count, 2);
  assert.equal(String(result.rows[0].id), '9007199254740993');
  assert.equal(result.rows[0].name, 'Alice');
  assert.equal(result.rows[0].active, true);
  assert.equal(result.rows[1].score, 7);
  assert.equal(result.inspection.rows, 2);
  assert.ok(result.inspection.rowGroupCount >= 1);
  assert.ok(result.inspection.schema.some((x) => x.name === 'id'));
  assert.ok(result.inspection.chunks.some((x) => x.column === 'name'));
  assert.deepEqual(result.inspection.keyValueMetadata, [{ key: 'source', value: 'local-test' }]);
  assert.equal(typeof result.inspection.raw.num_rows, 'string');
});

test('Delta fresh download reopens through the transaction log', async () => {
  const zip = makeDeltaZip(columns, grid, { configuration: { 'delta.enableChangeDataFeed': 'false' } });
  const result = await readDeltaEntries(unzipDelta(arrayBufferOf(zip)));
  assert.equal(result.version, 0);
  assert.equal(result.files, 1);
  assert.equal(result.count, 2);
  assert.equal(result.rows[1].name, 'Bob');
  assert.equal(result.hints.find((x) => x.name === 'id')?.type, 'INT64');
  assert.equal(result.configuration['delta.enableChangeDataFeed'], 'false');
  assert.equal(result.history.length, 1);
  assert.equal(result.parquetFiles.length, 1);
});

test('Delta edits append history instead of replacing it', async () => {
  const originalZip = makeDeltaZip(columns, grid, { configuration: { owner: 'original' } });
  const originalEntries = unzipDelta(arrayBufferOf(originalZip));
  const editedGrid = [
    ['3', 'Carol', 'true', '99.5', '2026-10-06T09:00:00Z'],
  ];
  const appended = appendDeltaZip(originalEntries, columns, editedGrid, {
    configuration: { owner: 'edited', purpose: 'workbench-test' },
    kvMetadata: [{ key: 'quality', value: 'checked' }],
    userMetadata: 'test edit',
  });
  assert.equal(appended.version, 1);

  const entries = unzipDelta(arrayBufferOf(appended.bytes));
  const info = inspectDeltaEntries(entries);
  assert.equal(info.version, 1);
  assert.equal(info.history.length, 2);
  assert.equal(info.history[1].operation, 'WRITE');
  assert.equal(info.configuration.owner, 'edited');
  assert.equal(info.configuration.purpose, 'workbench-test');

  const oldSnapshot = await readDeltaEntries(entries, { version: 0 });
  const latest = await readDeltaEntries(entries);
  assert.equal(oldSnapshot.rows[0].name, 'Alice');
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].name, 'Carol');
  assert.deepEqual(latest.parquetFiles[0].keyValueMetadata, [{ key: 'quality', value: 'checked' }]);

  const actions = deltaVersionActions(entries, 1);
  assert.ok(actions.actions.some((x) => x.commitInfo?.userMetadata === 'test edit'));
  assert.ok(actions.actions.some((x) => x.remove));
  assert.ok(actions.actions.some((x) => x.add));

  const compare = compareDeltaVersions(entries, 0, 1);
  assert.equal(compare.schemaChanged, false);
  assert.equal(compare.propertiesChanged, true);
  assert.equal(compare.addedFiles.length, 1);
  assert.equal(compare.removedFiles.length, 1);
});

test('Delta restore creates a new commit and keeps earlier versions readable', async () => {
  const originalZip = makeDeltaZip(columns, grid);
  const originalEntries = unzipDelta(arrayBufferOf(originalZip));
  const edited = appendDeltaZip(originalEntries, columns, [['3', 'Carol', 'true', '1', '2026-10-06T09:00:00Z']]);
  const editedEntries = unzipDelta(arrayBufferOf(edited.bytes));

  const restored = restoreDeltaZip(editedEntries, 0);
  assert.equal(restored.version, 2);
  const restoredEntries = unzipDelta(arrayBufferOf(restored.bytes));
  const info = inspectDeltaEntries(restoredEntries);
  assert.equal(info.history.length, 3);
  assert.equal(info.history[2].operation, 'RESTORE');

  const restoredRows = await readDeltaEntries(restoredEntries);
  assert.equal(restoredRows.rows.length, 2);
  assert.equal(restoredRows.rows[0].name, 'Alice');
  assert.equal((await readDeltaEntries(restoredEntries, { version: 1 })).rows[0].name, 'Carol');
});

test('type validation and Delta schema stay explicit', () => {
  assert.equal(parseCell('yes', 'BOOLEAN'), true);
  assert.equal(parseCell('42', 'INT32'), 42);
  assert.equal(parseCell('9007199254740993', 'INT64'), 9007199254740993n);
  assert.throws(() => parseCell('3.5', 'INT32', 0, 'id'), /whole number/);
  const schema = JSON.parse(sparkSchema(columns));
  assert.deepEqual(schema.fields.map((f) => f.type), ['long', 'string', 'boolean', 'double', 'timestamp']);
});
