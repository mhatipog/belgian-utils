const dec = new TextDecoder();
const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const unesc = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Limits are enforced against actual output, independently of declared ZIP sizes.
// Optional overrides only LOWER them (also useful for small regression fixtures).
export const ZIP_LIMITS = Object.freeze({
  maxEntries: 1024,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
});
export const XLSX_LIMITS = Object.freeze({
  maxRows: 100000,
  maxColumns: 512,
  maxCells: 1000000,
});
const bounded = (defaults, overrides = {}) => {
  const options = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(options)) {
    if (!(k in defaults) || !Number.isSafeInteger(v) || v < 1 || v > defaults[k])
      throw new Error('Invalid or excessive ZIP/XLSX limit: ' + k);
  }
  return options;
};
const inRange = (end, off, length) =>
  Number.isSafeInteger(off) && Number.isSafeInteger(length) &&
  off >= 0 && length >= 0 && off + length <= end;

async function inflateRawLimited(packed, maxBytes, maxRatioBytes) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('This browser cannot open compressed Office files; save the conversion table as CSV instead.');
  const reader = new Blob([packed]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes || length > maxRatioBytes)
        throw new Error('ZIP decompressed output or compression ratio limit exceeded.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

// Validates all central/local headers; decompresses only entries chosen by include.
export async function readLimitedZipEntries(input, { limits: overrides, include = () => true } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const limits = bounded(ZIP_LIMITS, overrides);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(bytes, p) === 0x06054b50 &&
        inRange(bytes.length, p, 22 + u16(bytes, p + 20)) &&
        p + 22 + u16(bytes, p + 20) === bytes.length) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('Invalid XLSX/ZIP file.');
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12), cd = u32(bytes, eocd + 16);
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0 ||
      u16(bytes, eocd + 8) !== count || count > limits.maxEntries ||
      !inRange(eocd, cd, cdSize))
    throw new Error('ZIP entry count or central directory limit exceeded.');
  const files = [], seen = new Set();
  let p = cd, total = 0;
  for (let i = 0; i < count; i++) {
    if (!inRange(cd + cdSize, p, 46) || u32(bytes, p) !== 0x02014b50)
      throw new Error('Invalid ZIP central directory.');
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10);
    const comp = u32(bytes, p + 20), size = u32(bytes, p + 24);
    const nl = u16(bytes, p + 28), xl = u16(bytes, p + 30), cl = u16(bytes, p + 32);
    const local = u32(bytes, p + 42), next = p + 46 + nl + xl + cl;
    if (!inRange(cd + cdSize, p, next - p) ||
        !inRange(cd, local, 30) || u32(bytes, local) !== 0x04034b50 ||
        u16(bytes, local + 8) !== method || (flags & 1) ||
        (u16(bytes, local + 6) & 1))
      throw new Error('Invalid ZIP entry offsets or compression.');
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
    const lnl = u16(bytes, local + 26), lxl = u16(bytes, local + 28);
    const start = local + 30 + lnl + lxl;
    if (!inRange(cd, start, comp) || !inRange(cd, local + 30, lnl) ||
        dec.decode(bytes.subarray(local + 30, local + 30 + lnl)) !== name ||
        seen.has(name) || (method !== 0 && method !== 8) ||
        size > limits.maxEntryBytes || size > comp * limits.maxCompressionRatio ||
        (method === 0 && size !== comp))
      throw new Error('Invalid ZIP entry size, ratio, or offset.');
    seen.add(name);
    let data;
    if (include(name)) {
      const allowed = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total);
      if (method === 0) {
        if (comp > allowed) throw new Error('ZIP total decompressed output limit exceeded.');
        data = bytes.slice(start, start + comp);
      } else {
        data = await inflateRawLimited(bytes.subarray(start, start + comp),
          allowed, comp * limits.maxCompressionRatio);
      }
      total += data.length;
      if (data.length !== size) throw new Error('ZIP declared size does not match actual output.');
    }
    files.push({ name, data });
    p = next;
  }
  if (p !== cd + cdSize) throw new Error('Invalid ZIP central directory length.');
  return files;
}

function sharedStrings(xml){const out=[];for(const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)){let s='';for(const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))s+=unesc(t[1]);out.push(s);}return out;}
const colNo = ref => {
  let n = 0;
  for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};
function sheetRows(xml, shared, limits) {
  const rows = [];
  let cells = 0;
  const checkRef = ref => {
    const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref);
    if (!match || +match[2] > limits.maxRows || colNo(match[1]) >= limits.maxColumns)
      throw new Error('XLSX cell reference or worksheet dimensions exceed limits.');
    return colNo(match[1]);
  };
  const dimension = /<dimension\b[^>]*\bref=["']([^"']+)["']/.exec(xml)?.[1];
  if (dimension) for (const ref of dimension.split(':')) checkRef(ref);
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= limits.maxRows) throw new Error('XLSX worksheet row limit exceeded.');
    const declaredRow = /\br=["']([^"']+)["']/.exec(rm[1])?.[1];
    if (declaredRow && (!/^[1-9][0-9]{0,6}$/.test(declaredRow) || +declaredRow > limits.maxRows))
      throw new Error('XLSX worksheet row reference exceeds limits.');
    const row = [];
    let column = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (++cells > limits.maxCells) throw new Error('XLSX worksheet cell limit exceeded.');
      const attrs = cm[1], body = cm[2], ref = /\br=["']([^"']+)["']/.exec(cm[1])?.[1];
      const i = ref ? checkRef(ref) : column;
      if (i >= limits.maxColumns) throw new Error('XLSX worksheet column limit exceeded.');
      column = i + 1;
      const type = /\bt=["']([^"']+)["']/.exec(attrs)?.[1] || '';
      let v = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) v += unesc(t[1]);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        v = type === 's' ? shared[+raw] ?? '' : unesc(raw);
      }
      row[i] = v;
    }
    while (row.length && row.at(-1) === undefined) row.pop();
    rows.push(row.map(x => x ?? ''));
  }
  return rows;
}
export async function parseXlsxTables(bytes, { limits = {} } = {}) {
  const sheetLimits = bounded(XLSX_LIMITS, Object.fromEntries(
    Object.entries(limits).filter(([key]) => key in XLSX_LIMITS)));
  const files = new Map((await readLimitedZipEntries(bytes, {
    limits: Object.fromEntries(Object.entries(limits).filter(([key]) => key in ZIP_LIMITS)),
    include: name => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  })).filter(f => f.data).map(f => [f.name, f.data]));
  const shared = files.has('xl/sharedStrings.xml') ?
    sharedStrings(dec.decode(files.get('xl/sharedStrings.xml'))) : [];
  const names = [...files.keys()].filter(x => /^xl\/worksheets\/sheet\d+\.xml$/.test(x))
    .sort((a, b) => +(/sheet(\d+)/.exec(a)?.[1] || 0) - +(/sheet(\d+)/.exec(b)?.[1] || 0));
  if (!names.length) throw new Error('No worksheets found in XLSX.');
  return names.map((name, i) => ({
    name: 'Sheet ' + (i + 1),
    rows: sheetRows(dec.decode(files.get(name)), shared, sheetLimits),
  }));
}
const normCode=v=>(String(v??'').match(/\d+/g)||[]).join('');
export function buildNaceMigrationMap(rows){if(!Array.isArray(rows)||!rows.length)throw new Error('Conversion table is empty.');let best=null;for(let r=0;r<Math.min(20,rows.length);r++){const cells=rows[r].map(x=>String(x).toLowerCase());const oldCols=[],newCols=[];cells.forEach((x,i)=>{if(x.includes('2008'))oldCols.push(i);if(x.includes('2025'))newCols.push(i);});if(oldCols.length&&newCols.length){best={headerRow:r,oldCol:oldCols[0],newCol:newCols[0],headers:rows[r]};break;}}if(!best)throw new Error('Could not detect NACE-BEL 2008 and 2025 columns. Save the official table as CSV with headers containing 2008 and 2025, or select a newer official conversion file.');const map=new Map();for(const row of rows.slice(best.headerRow+1)){const old=normCode(row[best.oldCol]),neu=normCode(row[best.newCol]);if(!old||!neu)continue;if(!map.has(old))map.set(old,new Set());map.get(old).add(neu);}return {headerRow:best.headerRow,oldColumn:best.headers[best.oldCol],newColumn:best.headers[best.newCol],mappings:Object.fromEntries([...map].map(([k,v])=>[k,[...v]]))};}
export function migrateNaceCodes(codes,mapping){const list=Array.isArray(codes)?codes:String(codes??'').split(/[\s,;]+/);return list.map(raw=>{const old=normCode(raw),matches=mapping?.[old]||[];return {input:String(raw),oldCode:old,newCodes:matches,status:matches.length===1?'one-to-one':matches.length>1?'one-to-many':'not-found'};}).filter(x=>x.oldCode);}
