import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';

export const MAX_EDITOR_ROWS = 200000;
export const MAX_DELTA_BYTES = 300 * 1024 * 1024;
export const EDITOR_TYPES = ['STRING', 'BOOLEAN', 'INT32', 'INT64', 'DOUBLE', 'TIMESTAMP', 'BYTE_ARRAY', 'JSON'];

const NUMERIC = new Set(['INT32', 'INT64', 'DOUBLE']);

export function uniqueName(base, existing = []) {
  const used = new Set(existing.map((x) => String(x).toLowerCase()));
  let name = String(base || '').trim() || 'Column';
  if (!used.has(name.toLowerCase())) return name;
  let i = 2;
  while (used.has(`${name} ${i}`.toLowerCase())) i++;
  return `${name} ${i}`;
}

export function valueType(value) {
  if (value == null) return null;
  if (value instanceof Date) return 'TIMESTAMP';
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return 'BYTE_ARRAY';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'bigint') return 'INT64';
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return 'INT32';
    return 'DOUBLE';
  }
  if (typeof value === 'object') return 'JSON';
  return 'STRING';
}

export function mergeTypes(a, b) {
  if (!a) return b || 'STRING';
  if (!b || a === b) return a;
  if (NUMERIC.has(a) && NUMERIC.has(b)) {
    if (a === 'DOUBLE' || b === 'DOUBLE') return 'DOUBLE';
    if (a === 'INT64' || b === 'INT64') return 'INT64';
    return 'INT32';
  }
  if (a === 'JSON' || b === 'JSON') return 'JSON';
  return 'STRING';
}

export function inferColumns(rows, hints = []) {
  const names = [];
  const seen = new Set();
  for (const h of hints) {
    if (!h?.name || seen.has(h.name)) continue;
    seen.add(h.name);
    names.push(h.name);
  }
  for (const row of rows.slice(0, 2000)) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) { seen.add(key); names.push(key); }
    }
  }
  if (!names.length) return [{ name: 'Column 1', type: 'STRING' }];
  const hintMap = new Map(hints.map((h) => [h.name, h.type]));
  return names.map((name) => {
    let type = hintMap.get(name) || null;
    if (!type) {
      for (const row of rows.slice(0, 1500)) type = mergeTypes(type, valueType(row?.[name]));
    }
    return { name, type: EDITOR_TYPES.includes(type) ? type : 'STRING' };
  });
}

export function displayValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}


function safeMetaValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer) return displayValue(value);
  if (ArrayBuffer.isView(value)) return displayValue(value);
  return value;
}

export function jsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value, (_key, v) => safeMetaValue(v)));
  } catch {
    return String(value);
  }
}

function statValue(stats, ...keys) {
  for (const key of keys) if (stats?.[key] !== undefined) return safeMetaValue(stats[key]);
  return null;
}

export function normalizeKvMetadata(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item?.key ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, value: String(item?.value ?? '') });
  }
  return out;
}

export function inspectParquetMetadata(metadata, fileName = '') {
  const schema = (metadata?.schema || []).map((item, index) => ({
    index,
    name: item?.name || '',
    physicalType: item?.type || '',
    logicalType: item?.logical_type?.type || item?.converted_type || '',
    repetition: item?.repetition_type || '',
    children: Number(item?.num_children || 0),
    typeLength: item?.type_length == null ? null : Number(item.type_length),
    scale: item?.scale == null ? null : Number(item.scale),
    precision: item?.precision == null ? null : Number(item.precision),
    fieldId: item?.field_id == null ? null : Number(item.field_id),
  }));
  const rowGroups = [];
  const chunks = [];
  for (let rgi = 0; rgi < (metadata?.row_groups || []).length; rgi++) {
    const rg = metadata.row_groups[rgi] || {};
    let compressed = 0;
    let uncompressed = 0;
    for (const chunk of rg.columns || []) {
      const md = chunk?.meta_data || {};
      const c = Number(md.total_compressed_size || 0);
      const u = Number(md.total_uncompressed_size || 0);
      compressed += c;
      uncompressed += u;
      const stats = md.statistics || {};
      chunks.push({
        rowGroup: rgi,
        column: (md.path_in_schema || []).join('.'),
        physicalType: md.type || '',
        codec: md.codec || '',
        encodings: (md.encodings || []).join(', '),
        values: Number(md.num_values || 0),
        compressedBytes: c,
        uncompressedBytes: u,
        min: statValue(stats, 'min_value', 'min'),
        max: statValue(stats, 'max_value', 'max'),
        nullCount: statValue(stats, 'null_count'),
        distinctCount: statValue(stats, 'distinct_count'),
        dataPageOffset: safeMetaValue(md.data_page_offset),
        dictionaryPageOffset: safeMetaValue(md.dictionary_page_offset),
      });
    }
    rowGroups.push({
      index: rgi,
      rows: Number(rg.num_rows || 0),
      totalBytes: Number(rg.total_byte_size || 0),
      compressedBytes: Number(rg.total_compressed_size || compressed || 0),
      uncompressedBytes: uncompressed,
      columns: (rg.columns || []).length,
    });
  }
  return {
    fileName,
    rows: Number(metadata?.num_rows || 0),
    version: Number(metadata?.version || 0),
    createdBy: metadata?.created_by || '',
    metadataLength: Number(metadata?.metadata_length || 0),
    rowGroupCount: (metadata?.row_groups || []).length,
    schema,
    rowGroups,
    chunks,
    keyValueMetadata: normalizeKvMetadata(metadata?.key_value_metadata || []),
    raw: jsonSafe(metadata),
  };
}

export function inspectParquetBuffer(buffer, fileName = '') {
  return inspectParquetMetadata(parquetMetadata(buffer), fileName);
}

export function objectsToGrid(rows, columns) {
  return rows.map((row) => columns.map((c) => displayValue(row?.[c.name])));
}

function rowError(rowIndex, name, message) {
  throw new Error(`Row ${rowIndex + 1}, column “${name}”: ${message}`);
}

export function parseCell(text, type, rowIndex = 0, name = '') {
  const raw = String(text ?? '');
  if (raw === '') return null;
  const s = raw.trim();
  if (type === 'STRING') return raw;
  if (type === 'BOOLEAN') {
    if (/^(true|1|yes|y)$/i.test(s)) return true;
    if (/^(false|0|no|n)$/i.test(s)) return false;
    return rowError(rowIndex, name, 'expected true/false, yes/no or 1/0.');
  }
  if (type === 'INT32') {
    if (!/^[+-]?\d+$/.test(s)) return rowError(rowIndex, name, 'expected a whole number.');
    const n = Number(s);
    if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) return rowError(rowIndex, name, 'value is outside the 32-bit integer range.');
    return n;
  }
  if (type === 'INT64') {
    if (!/^[+-]?\d+$/.test(s)) return rowError(rowIndex, name, 'expected a whole number.');
    try { return BigInt(s); } catch { return rowError(rowIndex, name, 'invalid 64-bit integer.'); }
  }
  if (type === 'DOUBLE') {
    const n = Number(s);
    if (!Number.isFinite(n)) return rowError(rowIndex, name, 'expected a finite number.');
    return n;
  }
  if (type === 'TIMESTAMP') {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return rowError(rowIndex, name, 'expected an ISO date/time or another valid date.');
    return d;
  }
  if (type === 'BYTE_ARRAY') {
    if (/^0x(?:[0-9a-f]{2})*$/i.test(s)) {
      const hex = s.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    return new TextEncoder().encode(raw);
  }
  if (type === 'JSON') {
    try { return JSON.stringify(JSON.parse(raw)); } catch (e) { return rowError(rowIndex, name, `invalid JSON (${e.message}).`); }
  }
  return raw;
}

export function effectiveRows(grid) {
  const rows = grid.map((r) => r.slice());
  while (rows.length && rows[rows.length - 1].every((v) => String(v ?? '') === '')) rows.pop();
  return rows;
}

export function columnDataFromGrid(columns, grid) {
  const rows = effectiveRows(grid);
  if (!rows.length) throw new Error('Add or paste at least one data row before downloading.');
  return columns.map((column, ci) => ({
    name: column.name,
    type: column.type === 'JSON' ? 'STRING' : column.type,
    data: rows.map((row, ri) => parseCell(row[ci], column.type, ri, column.name)),
    nullable: true,
  }));
}

export function writeParquet(columns, grid, options = {}) {
  const writeOptions = { columnData: columnDataFromGrid(columns, grid) };
  const kvMetadata = normalizeKvMetadata(options.kvMetadata || []);
  if (kvMetadata.length) writeOptions.kvMetadata = kvMetadata;
  if (options.codec) writeOptions.codec = options.codec;
  if (options.rowGroupSize) writeOptions.rowGroupSize = options.rowGroupSize;
  return parquetWriteBuffer(writeOptions);
}

export function sparkType(type) {
  return ({ STRING: 'string', JSON: 'string', BOOLEAN: 'boolean', INT32: 'integer', INT64: 'long', DOUBLE: 'double', TIMESTAMP: 'timestamp', BYTE_ARRAY: 'binary' })[type] || 'string';
}

export function sparkSchema(columns) {
  return JSON.stringify({
    type: 'struct',
    fields: columns.map((c) => ({ name: c.name, type: sparkType(c.type), nullable: true, metadata: {} })),
  });
}

export function deltaTypeHints(schemaString) {
  if (!schemaString) return [];
  let schema;
  try { schema = typeof schemaString === 'string' ? JSON.parse(schemaString) : schemaString; } catch { return []; }
  return (schema?.fields || []).map((f) => ({ name: f.name, type: sparkToEditorType(f.type) }));
}

function sparkToEditorType(type) {
  if (type && typeof type === 'object') return 'JSON';
  const s = String(type || '').toLowerCase();
  if (s === 'boolean') return 'BOOLEAN';
  if (['byte', 'short', 'integer', 'int'].includes(s)) return 'INT32';
  if (s === 'long') return 'INT64';
  if (['float', 'double'].includes(s) || s.startsWith('decimal')) return 'DOUBLE';
  if (s === 'timestamp' || s === 'timestamp_ntz' || s === 'date') return 'TIMESTAMP';
  if (s === 'binary') return 'BYTE_ARRAY';
  return 'STRING';
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

export function makeDeltaZip(columns, grid, options = {}) {
  if (options.entries) return appendDeltaZip(options.entries, columns, grid, options).bytes;
  const rows = effectiveRows(grid);
  if (!rows.length) throw new Error('Add or paste at least one data row before downloading.');
  const parquet = new Uint8Array(writeParquet(columns, rows, { kvMetadata: options.kvMetadata || [] }));
  const id = randomId();
  const part = `part-00000-${id}.snappy.parquet`;
  const now = Date.now();
  const configuration = normalizeDeltaConfiguration(options.configuration || {});
  const log = [
    { commitInfo: { timestamp: now, operation: 'WRITE', operationParameters: { mode: 'Overwrite', partitionBy: '[]' }, isBlindAppend: false, operationMetrics: { numFiles: '1', numOutputRows: String(rows.length), numOutputBytes: String(parquet.byteLength) }, userMetadata: options.userMetadata || undefined, engineInfo: 'gratistools.be' } },
    { protocol: { minReaderVersion: 1, minWriterVersion: 2 } },
    { metaData: { id, format: { provider: 'parquet', options: {} }, schemaString: sparkSchema(columns), partitionColumns: [], configuration, createdTime: now } },
    { add: { path: part, partitionValues: {}, size: parquet.byteLength, modificationTime: now, dataChange: true, stats: JSON.stringify({ numRecords: rows.length }) } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n';
  return zipSync({
    [part]: parquet,
    '_delta_log/00000000000000000000.json': strToU8(log),
  }, { level: 0 });
}

function deltaLogFile(version) {
  return `_delta_log/${String(version).padStart(20, '0')}.json`;
}

export function normalizeDeltaConfiguration(configuration = {}) {
  const out = {};
  const source = Array.isArray(configuration)
    ? Object.fromEntries(configuration.map((x) => [x?.key, x?.value]))
    : configuration;
  for (const [key, value] of Object.entries(source || {})) {
    const clean = String(key || '').trim();
    if (clean) out[clean] = String(value ?? '');
  }
  return out;
}

export function appendDeltaZip(entries, columns, grid, options = {}) {
  const state = replayDelta(entries);
  const rows = effectiveRows(grid);
  if (!rows.length) throw new Error('Add or paste at least one data row before downloading.');
  const parquet = new Uint8Array(writeParquet(columns, rows, { kvMetadata: options.kvMetadata || [] }));
  const id = state.metaData?.id || randomId();
  const part = `part-${String(state.version + 1).padStart(5, '0')}-${randomId()}.snappy.parquet`;
  const now = Date.now();
  const configuration = normalizeDeltaConfiguration(options.configuration ?? state.metaData?.configuration ?? {});
  const metaData = {
    ...(state.metaData || {}),
    id,
    format: state.metaData?.format || { provider: 'parquet', options: {} },
    schemaString: sparkSchema(columns),
    partitionColumns: [],
    configuration,
    createdTime: state.metaData?.createdTime ?? now,
  };
  const actions = [
    { commitInfo: { timestamp: now, operation: 'WRITE', operationParameters: { mode: 'Overwrite', partitionBy: '[]' }, readVersion: state.version, isBlindAppend: false, operationMetrics: { numFiles: '1', numRemovedFiles: String(state.active.size), numOutputRows: String(rows.length), numOutputBytes: String(parquet.byteLength) }, userMetadata: options.userMetadata || 'Edited locally with GratisTools', engineInfo: 'gratistools.be' } },
    { metaData },
    ...Array.from(state.active.values(), (info) => ({ remove: { path: info.add.path, deletionTimestamp: now, dataChange: true, extendedFileMetadata: true, size: info.add.size, partitionValues: info.add.partitionValues || {} } })),
    { add: { path: part, partitionValues: {}, size: parquet.byteLength, modificationTime: now, dataChange: true, stats: JSON.stringify({ numRecords: rows.length }) } },
  ];
  const out = { ...entries };
  out[state.root + part] = parquet;
  out[state.root + deltaLogFile(state.version + 1)] = strToU8(actions.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return { bytes: zipSync(out, { level: 0 }), version: state.version + 1, part };
}

export function restoreDeltaZip(entries, targetVersion, options = {}) {
  const latest = replayDelta(entries);
  const target = replayDelta(entries, targetVersion);
  if (target.version !== Number(targetVersion)) throw new Error(`Delta version ${targetVersion} was not found.`);
  if (target.version >= latest.version) throw new Error('Choose an older Delta version to restore.');
  const now = Date.now();
  const removes = [];
  const adds = [];
  for (const [path, info] of latest.active) if (!target.active.has(path)) {
    removes.push({ remove: { path, deletionTimestamp: now, dataChange: true, extendedFileMetadata: true, size: info.add.size, partitionValues: info.add.partitionValues || {} } });
  }
  for (const [path, info] of target.active) if (!latest.active.has(path)) {
    if (!resolveEntry(entries, info.root, path)) throw new Error(`Cannot restore version ${targetVersion}: data file is missing: ${path}`);
    adds.push({ add: { ...info.add, dataChange: true } });
  }
  const actions = [
    { commitInfo: { timestamp: now, operation: 'RESTORE', operationParameters: { version: String(targetVersion) }, readVersion: latest.version, isBlindAppend: false, operationMetrics: { numRemovedFiles: String(removes.length), numRestoredFiles: String(adds.length) }, userMetadata: options.userMetadata || `Restored Delta snapshot v${targetVersion} with GratisTools`, engineInfo: 'gratistools.be' } },
  ];
  if (target.metaData) actions.push({ metaData: target.metaData });
  actions.push(...removes, ...adds);
  const out = { ...entries };
  out[latest.root + deltaLogFile(latest.version + 1)] = strToU8(actions.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return { bytes: zipSync(out, { level: 0 }), version: latest.version + 1 };
}

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function readParquetBuffer(buffer, fileName = '') {
  const metadata = parquetMetadata(buffer);
  const count = Number(metadata.num_rows || 0);
  if (count > MAX_EDITOR_ROWS) throw new Error(`This file has ${count.toLocaleString()} rows. The editor supports up to ${MAX_EDITOR_ROWS.toLocaleString()} rows at once.`);
  const rows = count ? await parquetReadObjects({ file: buffer, rowStart: 0, rowEnd: count }) : [];
  return { rows, count, inspection: inspectParquetMetadata(metadata, fileName) };
}

export function unzipDelta(buffer) {
  const entries = unzipSync(new Uint8Array(buffer));
  const unpacked = Object.values(entries).reduce((sum, x) => sum + x.byteLength, 0);
  if (unpacked > MAX_DELTA_BYTES) throw new Error('This Delta archive expands beyond the 300 MB browser safety limit.');
  return entries;
}

export async function filesToEntries(files) {
  const entries = {};
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (total > MAX_DELTA_BYTES) throw new Error('This Delta folder is larger than the 300 MB browser safety limit.');
    const path = String(file.webkitRelativePath || file.name).replace(/^\.\//, '');
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  return entries;
}

function findDeltaLogs(entries) {
  const logs = Object.keys(entries).map((path) => {
    const m = /(^|\/)_delta_log\/(\d{20})\.json$/.exec(path);
    return m ? { path, version: Number(m[2]), root: path.slice(0, m.index + m[1].length) } : null;
  }).filter(Boolean).sort((a, b) => a.version - b.version);
  if (!logs.length) throw new Error('No Delta Lake JSON transaction log was found. Choose a Delta table folder or a ZIP that contains _delta_log.');
  if (logs[0].version !== 0) throw new Error('This Delta table starts after version 0, likely because older JSON logs were cleaned up. Checkpoint-only histories are not supported by this editor yet.');
  return logs;
}

function resolveEntry(entries, root, path) {
  const clean = String(path || '').replace(/^\//, '');
  const variants = [root + clean, root + decodeURIComponent(clean), clean, decodeURIComponent(clean)];
  for (const candidate of variants) if (entries[candidate]) return entries[candidate];
  return null;
}

function parseDeltaLog(entries, log) {
  const text = strFromU8(entries[log.path]);
  const actions = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { actions.push(JSON.parse(line)); }
    catch { throw new Error(`Invalid JSON in ${log.path}.`); }
  }
  return actions;
}

export function replayDelta(entries, targetVersion = Number.POSITIVE_INFINITY) {
  const logs = findDeltaLogs(entries);
  const active = new Map();
  let schemaString = null;
  let metaData = null;
  let protocol = null;
  let lastVersion = -1;
  const history = [];
  const firstRoot = logs[0].root;
  for (const log of logs) {
    if (log.version > targetVersion) break;
    const actions = parseDeltaLog(entries, log);
    let commitInfo = null;
    let added = 0;
    let removed = 0;
    let metadataChanged = false;
    let protocolChanged = false;
    for (const action of actions) {
      if (action.commitInfo) commitInfo = action.commitInfo;
      if (action.protocol) { protocol = action.protocol; protocolChanged = true; }
      if (action.metaData) {
        metaData = action.metaData;
        if (action.metaData.schemaString) schemaString = action.metaData.schemaString;
        metadataChanged = true;
      }
      if (action.add?.path) {
        active.set(action.add.path, { root: log.root, add: action.add, partitionValues: action.add.partitionValues || {} });
        added++;
      }
      if (action.remove?.path) {
        active.delete(action.remove.path);
        removed++;
      }
    }
    lastVersion = log.version;
    history.push({
      version: log.version,
      timestamp: commitInfo?.timestamp ?? null,
      operation: commitInfo?.operation || (log.version === 0 ? 'CREATE TABLE' : 'COMMIT'),
      userMetadata: commitInfo?.userMetadata || '',
      operationParameters: jsonSafe(commitInfo?.operationParameters || {}),
      operationMetrics: jsonSafe(commitInfo?.operationMetrics || {}),
      added,
      removed,
      metadataChanged,
      protocolChanged,
      activeFiles: active.size,
      actionCount: actions.length,
      path: log.path,
    });
  }
  if (lastVersion < 0) throw new Error('No readable Delta version was found.');
  return {
    version: lastVersion,
    root: firstRoot,
    active,
    schemaString,
    metaData,
    protocol,
    configuration: normalizeDeltaConfiguration(metaData?.configuration || {}),
    partitionColumns: metaData?.partitionColumns || [],
    history,
  };
}

export function inspectDeltaEntries(entries) {
  const state = replayDelta(entries);
  return {
    version: state.version,
    files: state.active.size,
    schemaString: state.schemaString,
    hints: deltaTypeHints(state.schemaString),
    metadata: jsonSafe(state.metaData),
    protocol: jsonSafe(state.protocol),
    configuration: { ...state.configuration },
    partitionColumns: [...state.partitionColumns],
    history: state.history,
  };
}

export function deltaVersionActions(entries, version) {
  const logs = findDeltaLogs(entries);
  const log = logs.find((x) => x.version === Number(version));
  if (!log) throw new Error(`Delta version ${version} was not found.`);
  return { version: log.version, path: log.path, actions: jsonSafe(parseDeltaLog(entries, log)) };
}

export function compareDeltaVersions(entries, fromVersion, toVersion) {
  const a = replayDelta(entries, fromVersion);
  const b = replayDelta(entries, toVersion);
  const aPaths = new Set(a.active.keys());
  const bPaths = new Set(b.active.keys());
  return {
    fromVersion: a.version,
    toVersion: b.version,
    addedFiles: [...bPaths].filter((x) => !aPaths.has(x)),
    removedFiles: [...aPaths].filter((x) => !bPaths.has(x)),
    schemaChanged: a.schemaString !== b.schemaString,
    propertiesChanged: JSON.stringify(a.configuration) !== JSON.stringify(b.configuration),
    fromActiveFiles: a.active.size,
    toActiveFiles: b.active.size,
  };
}

export async function readDeltaEntries(entries, options = {}) {
  const targetVersion = options.version == null ? Number.POSITIVE_INFINITY : Number(options.version);
  const state = replayDelta(entries, targetVersion);
  const parts = [];
  const parquetFiles = [];
  let totalRows = 0;
  for (const [path, info] of state.active) {
    const bytes = resolveEntry(entries, info.root, path);
    if (!bytes) throw new Error(`Delta data file is missing from the selected files: ${path}`);
    const buffer = arrayBufferOf(bytes);
    const metadata = parquetMetadata(buffer);
    const count = Number(metadata.num_rows || 0);
    totalRows += count;
    if (totalRows > MAX_EDITOR_ROWS) throw new Error(`This Delta table has more than ${MAX_EDITOR_ROWS.toLocaleString()} active rows. The editor loads up to that limit at once.`);
    const inspection = inspectParquetMetadata(metadata, path);
    parquetFiles.push({ path, size: bytes.byteLength, ...inspection });
    parts.push({ buffer, partitionValues: info.partitionValues });
  }
  const rows = [];
  for (const part of parts) {
    const { buffer, partitionValues } = part;
    const metadata = parquetMetadata(buffer);
    const count = Number(metadata.num_rows || 0);
    if (count) {
      const partRows = await parquetReadObjects({ file: buffer, rowStart: 0, rowEnd: count });
      rows.push(...partRows.map((row) => ({ ...partitionValues, ...row })));
    }
  }
  return {
    rows,
    count: rows.length,
    version: state.version,
    files: state.active.size,
    hints: deltaTypeHints(state.schemaString),
    metadata: jsonSafe(state.metaData),
    protocol: jsonSafe(state.protocol),
    configuration: { ...state.configuration },
    partitionColumns: [...state.partitionColumns],
    history: state.history,
    parquetFiles,
  };
}

