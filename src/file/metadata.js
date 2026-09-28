// Privacy-first metadata inspection and cleaning for common browser-side file formats.
// Supported: JPEG, PNG, WebP and OOXML (DOCX/XLSX/PPTX). No network access.

const dec = new TextDecoder();
const latin = new TextDecoder('latin1');
const enc = new TextEncoder();

const xmlUnescape = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const field = (group, key, label, value, privacy = 'info') =>
  value === undefined || value === null || value === '' ? null : { group, key, label, value: String(value), privacy };

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function u16be(b, p) { return (b[p] << 8) | b[p + 1]; }
function u32le(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
function u16le(b, p) { return b[p] | (b[p + 1] << 8); }

function exifFields(tiff) {
  const out = [];
  if (tiff.length < 8) return out;
  const little = latin.decode(tiff.subarray(0, 2)) === 'II';
  const u16 = (p) => little ? u16le(tiff, p) : u16be(tiff, p);
  const u32 = (p) => little ? u32le(tiff, p) : ((tiff[p] << 24) | (tiff[p + 1] << 16) | (tiff[p + 2] << 8) | tiff[p + 3]) >>> 0;
  if (u16(2) !== 42) return out;

  const ascii = (type, count, valuePos) => {
    if (type !== 2 || !count) return '';
    const p = count <= 4 ? valuePos : u32(valuePos);
    if (p + count > tiff.length) return '';
    return latin.decode(tiff.subarray(p, p + count)).replace(/\0+$/, '').trim();
  };
  const rational = (p) => p + 8 <= tiff.length && u32(p + 4) ? u32(p) / u32(p + 4) : 0;
  const tags = {
    0x010f: ['device', 'make', 'Camera make', 'medium'],
    0x0110: ['device', 'model', 'Camera/device model', 'medium'],
    0x0131: ['software', 'software', 'Software', 'medium'],
    0x0132: ['dates', 'modified', 'Modified', 'medium'],
    0x013b: ['identity', 'artist', 'Artist', 'high'],
    0x8298: ['identity', 'copyright', 'Copyright', 'medium'],
    0x9003: ['dates', 'taken', 'Date taken', 'high'],
    0x9004: ['dates', 'digitized', 'Digitized', 'medium'],
  };
  let exifPtr = 0, gpsPtr = 0;
  const visit = (off) => {
    if (!off || off + 2 > tiff.length) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const p = off + 2 + i * 12;
      if (p + 12 > tiff.length) break;
      const tag = u16(p), type = u16(p + 2), count = u32(p + 4);
      if (tag === 0x8769) exifPtr = u32(p + 8);
      else if (tag === 0x8825) gpsPtr = u32(p + 8);
      else if (tags[tag]) {
        const v = ascii(type, count, p + 8);
        if (v) { const [group, key, label, privacy] = tags[tag]; out.push(field(group, key, label, v, privacy)); }
      }
    }
  };
  visit(u32(4));
  visit(exifPtr);

  if (gpsPtr && gpsPtr + 2 < tiff.length) {
    const n = u16(gpsPtr);
    let latRef = '', lonRef = '', lat = 0, lon = 0;
    for (let i = 0; i < n; i++) {
      const p = gpsPtr + 2 + i * 12;
      if (p + 12 > tiff.length) break;
      const tag = u16(p), type = u16(p + 2), count = u32(p + 4), vo = p + 8;
      if (tag === 1) latRef = ascii(type, count, vo);
      if (tag === 3) lonRef = ascii(type, count, vo);
      if ((tag === 2 || tag === 4) && type === 5 && count >= 3) {
        const q = u32(vo);
        if (q + 24 <= tiff.length) {
          let v = rational(q) + rational(q + 8) / 60 + rational(q + 16) / 3600;
          if ((tag === 2 && latRef === 'S') || (tag === 4 && lonRef === 'W')) v *= -1;
          if (tag === 2) lat = v; else lon = v;
        }
      }
    }
    if (lat || lon) out.push(field('location', 'gps', 'GPS location', `${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'high'));
  }
  return out.filter(Boolean);
}

function exifOrientation(tiff) {
  if (tiff.length < 8) return 1;
  const little = latin.decode(tiff.subarray(0,2)) === 'II';
  const u16 = (p) => little ? u16le(tiff,p) : u16be(tiff,p);
  const u32 = (p) => little ? u32le(tiff,p) : ((tiff[p]<<24)|(tiff[p+1]<<16)|(tiff[p+2]<<8)|tiff[p+3])>>>0;
  if (u16(2) !== 42) return 1;
  const off = u32(4);
  if (!off || off + 2 > tiff.length) return 1;
  const n = u16(off);
  for (let i=0;i<n;i++) {
    const p=off+2+i*12;
    if (p+12>tiff.length) break;
    if (u16(p)===0x0112 && u16(p+2)===3 && u32(p+4)===1) return u16(p+8) || 1;
  }
  return 1;
}

function orientationExifSegment(value) {
  if (!(value >= 2 && value <= 8)) return null;
  const payload = new Uint8Array(32);
  payload.set(enc.encode('Exif\0\0'),0);
  const v = new DataView(payload.buffer);
  payload[6]=0x49; payload[7]=0x49; v.setUint16(8,42,true); v.setUint32(10,8,true);
  v.setUint16(14,1,true); v.setUint16(16,0x0112,true); v.setUint16(18,3,true); v.setUint32(20,1,true); v.setUint16(24,value,true); v.setUint32(28,0,true);
  const seg = new Uint8Array(36);
  seg.set([0xff,0xe1,0,34],0); seg.set(payload,4);
  return seg;
}

function jpeg(bytes) {
  const fields = [], blocks = [], keep = [bytes.subarray(0, 2)];
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1];
    if (marker === 0xda || marker === 0xd9) { keep.push(bytes.subarray(p)); break; }
    const len = u16be(bytes, p + 2);
    if (len < 2 || p + 2 + len > bytes.length) break;
    const seg = bytes.subarray(p, p + 2 + len);
    const body = bytes.subarray(p + 4, p + 2 + len);
    let removable = false, replacement = null;
    if (marker === 0xe1 && latin.decode(body.subarray(0, 6)) === 'Exif\0\0') {
      blocks.push('EXIF'); removable = true;
      const tiff = body.subarray(6);
      fields.push(...exifFields(tiff));
      replacement = orientationExifSegment(exifOrientation(tiff));
    } else if (marker === 0xe1 && latin.decode(body.subarray(0, 29)).includes('ns.adobe.com/xap')) {
      blocks.push('XMP'); removable = true;
      const s = dec.decode(body);
      for (const [key, label, re, privacy] of [
        ['creator', 'Creator', /<dc:creator[^>]*>[\s\S]*?<rdf:li[^>]*>([^<]+)/i, 'high'],
        ['createDate', 'Created', /xmp:CreateDate=["']([^"']+)/i, 'medium'],
        ['modifyDate', 'Modified', /xmp:ModifyDate=["']([^"']+)/i, 'medium'],
      ]) { const m = re.exec(s); if (m) fields.push(field('xmp', key, label, xmlUnescape(m[1]), privacy)); }
    } else if (marker === 0xed) { blocks.push('IPTC'); removable = true; }
    else if (marker === 0xfe) { blocks.push('Comment'); removable = true; fields.push(field('other', 'comment', 'Comment', latin.decode(body), 'medium')); }
    else if (marker === 0xe2 && latin.decode(body.subarray(0, 11)) === 'ICC_PROFILE') blocks.push('ICC colour profile');
    if (!removable) keep.push(seg);
    else if (replacement) keep.push(replacement);
    p += 2 + len;
  }
  return { format: 'jpeg', fields: fields.filter(Boolean), blocks, clean: () => concat(keep) };
}

const pngType = (b, p) => latin.decode(b.subarray(p + 4, p + 8));
function png(bytes) {
  const fields = [], blocks = [], keep = [bytes.subarray(0, 8)];
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = u32le(new Uint8Array([bytes[p+3],bytes[p+2],bytes[p+1],bytes[p]]),0);
    const type = pngType(bytes, p);
    const end = p + 12 + len;
    if (end > bytes.length) break;
    const data = bytes.subarray(p + 8, p + 8 + len);
    let removable = false;
    if (type === 'tEXt') {
      removable = true; blocks.push('PNG text');
      const z = data.indexOf(0); if (z >= 0) fields.push(field('text', latin.decode(data.subarray(0,z)), latin.decode(data.subarray(0,z)), latin.decode(data.subarray(z+1)), 'medium'));
    } else if (type === 'iTXt' || type === 'zTXt') { removable = true; blocks.push(type); }
    else if (type === 'eXIf') { removable = true; blocks.push('EXIF'); fields.push(...exifFields(data)); }
    else if (type === 'iCCP') blocks.push('ICC colour profile');
    if (!removable) keep.push(bytes.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return { format: 'png', fields: fields.filter(Boolean), blocks, clean: () => concat(keep) };
}

function webp(bytes) {
  const fields = [], blocks = [], chunks = [];
  let p = 12;
  while (p + 8 <= bytes.length) {
    const type = latin.decode(bytes.subarray(p, p + 4));
    const len = u32le(bytes, p + 4);
    const end = p + 8 + len + (len & 1);
    if (end > bytes.length) break;
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'EXIF') { blocks.push('EXIF'); const tiff = latin.decode(data.subarray(0,6)) === 'Exif\0\0' ? data.subarray(6) : data; fields.push(...exifFields(tiff)); }
    else if (type === 'XMP ') { blocks.push('XMP'); fields.push(field('xmp','raw','XMP packet',dec.decode(data).slice(0,500),'medium')); }
    else {
      if (type === 'ICCP') blocks.push('ICC colour profile');
      const chunk = bytes.slice(p, end);
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c; // EXIF + XMP feature flags
      chunks.push(chunk);
    }
    p = end;
  }
  const clean = () => {
    const body = concat(chunks);
    const out = new Uint8Array(12 + body.length);
    out.set(enc.encode('RIFF'), 0);
    new DataView(out.buffer).setUint32(4, 4 + body.length, true);
    out.set(enc.encode('WEBP'), 8); out.set(body, 12);
    return out;
  };
  return { format: 'webp', fields: fields.filter(Boolean), blocks, clean };
}

let CRC_TABLE;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  return (~crc) >>> 0;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed Office files.');
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

async function readZip(bytes) {
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32le(bytes,p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP/Office file.');
  const count = u16le(bytes, eocd + 10), cd = u32le(bytes, eocd + 16), files = [];
  let p = cd;
  for (let i = 0; i < count; i++) {
    if (u32le(bytes,p) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
    const method = u16le(bytes,p+10), comp = u32le(bytes,p+20), size = u32le(bytes,p+24);
    const nl = u16le(bytes,p+28), xl = u16le(bytes,p+30), cl = u16le(bytes,p+32), local = u32le(bytes,p+42);
    const name = dec.decode(bytes.subarray(p+46,p+46+nl));
    const lnl = u16le(bytes,local+26), lxl = u16le(bytes,local+28), start = local+30+lnl+lxl;
    const packed = bytes.subarray(start,start+comp);
    const data = method === 0 ? packed.slice() : method === 8 ? await inflateRaw(packed) : null;
    if (!data || data.length !== size) throw new Error(`Unsupported ZIP compression for ${name}.`);
    files.push({ name, data });
    p += 46 + nl + xl + cl;
  }
  return files;
}

function createStoredZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), size = f.data.length, crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x0800,true);
    lv.setUint32(14,crc,true); lv.setUint32(18,size,true); lv.setUint32(22,size,true); lv.setUint16(26,name.length,true); local.set(name,30);
    const central = new Uint8Array(46 + name.length); const cv = new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x0800,true);
    cv.setUint32(16,crc,true); cv.setUint32(20,size,true); cv.setUint32(24,size,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); central.set(name,46);
    locals.push(local,f.data); centrals.push(central); offset += local.length + size;
  }
  const cs = centrals.reduce((s,c)=>s+c.length,0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cs,true); ev.setUint32(16,offset,true);
  return concat([...locals,...centrals,end]);
}

const tag = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`,'i').exec(xml);
  return m ? xmlUnescape(m[1].replace(/<[^>]+>/g,'').trim()) : '';
};
const removeTag = (xml, name) => xml.replace(new RegExp(`\\s*<(?:\\w+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:\\w+:)?${name}>\\s*`,'gi'),'\n');

async function ooxml(bytes, name) {
  const files = await readZip(bytes), map = new Map(files.map(f=>[f.name,f]));
  const isWord = map.has('word/document.xml'), isExcel = map.has('xl/workbook.xml'), isPpt = map.has('ppt/presentation.xml');
  const format = isWord ? 'docx' : isExcel ? 'xlsx' : isPpt ? 'pptx' : 'ooxml';
  const fields = [], blocks = [];
  const names = files.map((f) => f.name);
  const workbookXml = isExcel ? dec.decode(map.get('xl/workbook.xml')?.data || new Uint8Array()) : '';
  const wordXml = isWord ? dec.decode(map.get('word/document.xml')?.data || new Uint8Array()) : '';
  const signals = {
    officeComments: names.filter((n) => /(^|\/)(comments|commentAuthors|threadedComments)(\d*)?\.xml$/i.test(n)).length,
    trackedChanges: isWord && /<w:(ins|del|moveFrom|moveTo)\b/i.test(wordXml),
    hiddenSheets: isExcel ? [...workbookXml.matchAll(/<sheet\b[^>]*\bstate=["'](?:hidden|veryHidden)["']/gi)].length : 0,
    externalLinks: names.some((n) => /(^|\/)externalLinks\//i.test(n)),
    embeddedObjects: names.some((n) => /(^|\/)(embeddings|oleObject|embeddedFiles)\//i.test(n)),
    thumbnail: names.some((n) => /(^|\/)docProps\/thumbnail\./i.test(n)),
  };
  const core = map.get('docProps/core.xml');
  if (core) {
    blocks.push('Core properties'); const x = dec.decode(core.data);
    for (const [k,l,p] of [
      ['title','Title','info'],['subject','Subject','info'],['creator','Author','high'],['keywords','Keywords','info'],
      ['description','Description','info'],['lastModifiedBy','Last modified by','high'],['revision','Revision','medium'],
      ['created','Created','medium'],['modified','Modified','medium']
    ]) { const v=tag(x,k); if(v) fields.push(field('document',k,l,v,p)); }
  }
  const app = map.get('docProps/app.xml');
  if (app) {
    blocks.push('Application properties'); const x = dec.decode(app.data);
    for (const [k,l,p] of [['Application','Application','medium'],['AppVersion','App version','info'],['Company','Company','high'],['Manager','Manager','high'],['TotalTime','Editing time','medium']]) {
      const v=tag(x,k); if(v) fields.push(field('application',k,l,v,p));
    }
  }
  const custom = map.get('docProps/custom.xml');
  if (custom) {
    blocks.push('Custom properties'); const x = dec.decode(custom.data);
    for (const m of x.matchAll(/<property\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/property>/gi)) {
      const v = m[2].replace(/<[^>]+>/g,'').trim(); if(v) fields.push(field('custom',m[1],m[1],xmlUnescape(v),'high'));
    }
  }
  const clean = async () => {
    const cleaned = [];
    for (const f of files) {
      let data = f.data;
      if (f.name === 'docProps/core.xml') {
        let x = dec.decode(data);
        for (const k of ['creator','lastModifiedBy','revision','created','modified']) x = removeTag(x,k);
        data = enc.encode(x);
      } else if (f.name === 'docProps/app.xml') {
        let x = dec.decode(data);
        for (const k of ['Company','Manager','TotalTime']) x = removeTag(x,k);
        data = enc.encode(x);
      } else if (f.name === 'docProps/custom.xml') {
        let x = dec.decode(data);
        x = x.replace(/\s*<property\b[\s\S]*?<\/property>\s*/gi, '\n');
        data = enc.encode(x);
      }
      cleaned.push({name:f.name,data});
    }
    return createStoredZip(cleaned);
  };
  return { format, fields: fields.filter(Boolean), blocks, signals, clean };
}

export async function inspectMetadata(input, { name = '' } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let r;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) r = jpeg(bytes);
  else if (latin.decode(bytes.subarray(1,4)) === 'PNG') r = png(bytes);
  else if (latin.decode(bytes.subarray(0,4)) === 'RIFF' && latin.decode(bytes.subarray(8,12)) === 'WEBP') r = webp(bytes);
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b) r = await ooxml(bytes,name);
  else throw new Error('Metadata inspection is not supported for this file type.');
  return {
    format: r.format,
    fields: r.fields,
    blocks: r.blocks,
    privacyCount: r.fields.filter(f => f.privacy === 'high' || f.privacy === 'medium').length,
    capabilities: { clean: true, edit: false },
    signals: r.signals || {},
    _clean: r.clean,
  };
}

export async function cleanMetadata(input, options = {}) {
  const report = await inspectMetadata(input, options);
  const bytes = await report._clean();
  return { bytes, format: report.format, removed: report.privacyCount };
}
