import { PDFDocument, degrees } from 'pdf-lib';

const A4 = [595.28, 841.89];

function toBytes(input, label = 'input') {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError(`${label} must be a Uint8Array, ArrayBuffer or typed-array view.`);
}

function sourceType(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'pdf' || v === 'application/pdf') return 'pdf';
  if (v === 'jpg' || v === 'jpeg' || v === 'image/jpeg') return 'jpeg';
  if (v === 'png' || v === 'image/png') return 'png';
  throw new Error(`Unsupported source type "${value}". Use pdf, jpeg or png.`);
}

function rotation(value = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n % 90 !== 0) throw new Error('Rotation must be a multiple of 90 degrees.');
  return ((n % 360) + 360) % 360;
}

function pageSize(value) {
  if (!value || value === 'natural') return null;
  if (value === 'a4') return A4;
  if (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(+n) && +n > 0)) return value.map(Number);
  throw new Error('pageSize must be "natural", "a4", or [widthPt, heightPt].');
}

/**
 * Return basic page information without rendering the PDF.
 */
export async function inspectPdfPages(input) {
  const doc = await PDFDocument.load(toBytes(input, 'PDF'), { updateMetadata: false });
  return doc.getPages().map((page, i) => ({
    page: i + 1,
    width: page.getWidth(),
    height: page.getHeight(),
    rotation: page.getRotation().angle || 0,
  }));
}

/**
 * Convenience helper for putting every page of one PDF source into a composition.
 */
export function pdfPageDescriptors(source, pageCount, { rotate = 0 } = {}) {
  if (!Number.isInteger(pageCount) || pageCount < 0) throw new Error('pageCount must be a non-negative integer.');
  return Array.from({ length: pageCount }, (_, i) => ({ source, page: i + 1, rotate }));
}

/**
 * Compose a new PDF from PDF pages and images.
 *
 * sources:
 * {
 *   main:   { type: 'pdf',  bytes: Uint8Array },
 *   insert: { type: 'pdf',  bytes: Uint8Array },
 *   photo:  { type: 'jpeg', bytes: Uint8Array }
 * }
 *
 * pages:
 * [
 *   { source: 'main', page: 2 },       // reorder / keep
 *   { source: 'photo' },               // image becomes a PDF page
 *   { source: 'insert', page: 1 },     // insert from another PDF
 *   { source: 'main', page: 1, rotate: 90 }
 * ]
 *
 * Leaving a source PDF page out deletes it from the result.
 * Image pages use their natural size at 96 DPI by default. Set pageSize:'a4'
 * or [widthPt,heightPt] plus an optional margin to fit them onto a fixed page.
 */
export async function composePdfPages({ sources, pages }) {
  if (!sources || typeof sources !== 'object') throw new TypeError('sources must be an object keyed by source id.');
  if (!Array.isArray(pages) || !pages.length) throw new Error('pages must contain at least one output page.');

  const loaded = new Map();
  for (const [id, source] of Object.entries(sources)) {
    if (!source || typeof source !== 'object') throw new TypeError(`Source "${id}" must be an object.`);
    const type = sourceType(source.type);
    const bytes = toBytes(source.bytes, `Source "${id}" bytes`);
    loaded.set(id, {
      type,
      bytes,
      doc: type === 'pdf' ? await PDFDocument.load(bytes, { updateMetadata: false }) : null,
    });
  }

  const out = await PDFDocument.create();
  for (let pos = 0; pos < pages.length; pos++) {
    const item = pages[pos] || {};
    const source = loaded.get(item.source);
    if (!source) throw new Error(`Output page ${pos + 1}: unknown source "${item.source}".`);
    const rotate = rotation(item.rotate);

    if (source.type === 'pdf') {
      if (!Number.isInteger(item.page) || item.page < 1 || item.page > source.doc.getPageCount()) {
        throw new Error(`Output page ${pos + 1}: page must be between 1 and ${source.doc.getPageCount()} for source "${item.source}".`);
      }
      const [page] = await out.copyPages(source.doc, [item.page - 1]);
      if (rotate) page.setRotation(degrees((page.getRotation().angle + rotate) % 360));
      out.addPage(page);
      continue;
    }

    const image = source.type === 'jpeg' ? await out.embedJpg(source.bytes) : await out.embedPng(source.bytes);
    const natural = [image.width * 0.75, image.height * 0.75]; // CSS/typical image pixels: 96 px/in -> 72 pt/in
    const fixed = pageSize(item.pageSize);
    let [width, height] = fixed || natural;
    const margin = Math.max(0, Number(item.margin) || 0);
    if (fixed && item.orientation === 'landscape' && height > width) [width, height] = [height, width];
    if (fixed && item.orientation === 'portrait' && width > height) [width, height] = [height, width];

    const drawableW = Math.max(1, width - margin * 2);
    const drawableH = Math.max(1, height - margin * 2);
    const scale = fixed ? Math.min(drawableW / image.width, drawableH / image.height) : 0.75;
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const page = out.addPage([width, height]);
    page.drawImage(image, {
      x: (width - drawW) / 2,
      y: (height - drawH) / 2,
      width: drawW,
      height: drawH,
    });
    if (rotate) page.setRotation(degrees(rotate));
  }

  return out.save({ useObjectStreams: true });
}
