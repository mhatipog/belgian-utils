import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEnterprise, parseIban, parseOgm, parsePeppolId,
  parseCoda, parseCamt, readUbl, validateInvoice,
  parseIntervat, parseXbrl, epcPayload,
  wgs84ToLambert72, lambert72ToWgs84,
  inspectMetadata, cleanMetadata, interpretMetadata
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


test('JPEG metadata is detected and stripped without touching image data', async () => {
  const ascii = new TextEncoder();
  const comment = ascii.encode('private note');
  const seg = new Uint8Array(4 + comment.length);
  seg.set([0xff, 0xfe, 0, comment.length + 2], 0);
  seg.set(comment, 4);
  const jpeg = new Uint8Array(2 + seg.length + 4);
  jpeg.set([0xff, 0xd8], 0); jpeg.set(seg, 2); jpeg.set([0xff, 0xda, 0xff, 0xd9], 2 + seg.length);
  const report = await inspectMetadata(jpeg, { name: 'photo.jpg' });
  assert.equal(report.format, 'jpeg');
  assert.equal(report.fields.find((f) => f.key === 'comment').value, 'private note');
  const cleaned = await cleanMetadata(jpeg, { name: 'photo.jpg' });
  const after = await inspectMetadata(cleaned.bytes, { name: 'photo.jpg' });
  assert.equal(after.fields.length, 0);
  assert.deepEqual([...cleaned.bytes.slice(-4)], [0xff, 0xda, 0xff, 0xd9]);
});

test('Office core properties are inspected and privacy-cleaned', async () => {
  const enc = new TextEncoder();
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (~crc) >>> 0;
  };
  const zip = (files) => {
    const parts = [], central = []; let offset = 0;
    for (const [nameText, dataText] of files) {
      const name = enc.encode(nameText), data = enc.encode(dataText), crc = crc32(data);
      const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x0800,true);
      lv.setUint32(14,crc,true); lv.setUint32(18,data.length,true); lv.setUint32(22,data.length,true); lv.setUint16(26,name.length,true); local.set(name,30);
      const c = new Uint8Array(46 + name.length); const cv = new DataView(c.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x0800,true);
      cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); c.set(name,46);
      parts.push(local,data); central.push(c); offset += local.length + data.length;
    }
    const cs = central.reduce((s,c)=>s+c.length,0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,cs,true); ev.setUint32(16,offset,true);
    const all=[...parts,...central,end], n=all.reduce((s,p)=>s+p.length,0), out=new Uint8Array(n); let p=0;
    for(const a of all){out.set(a,p);p+=a.length;} return out;
  };
  const core = '<cp:coreProperties xmlns:cp="x"><dc:creator xmlns:dc="x">Alice</dc:creator><cp:lastModifiedBy>Bob</cp:lastModifiedBy><dc:title xmlns:dc="x">Keep me</dc:title></cp:coreProperties>';
  const docx = zip([['word/document.xml','<w:document/>'],['docProps/core.xml',core]]);
  const before = await inspectMetadata(docx,{name:'test.docx'});
  assert.equal(before.format,'docx');
  assert.equal(before.fields.find((f)=>f.key==='creator').value,'Alice');
  const cleaned = await cleanMetadata(docx,{name:'test.docx'});
  const after = await inspectMetadata(cleaned.bytes,{name:'test.docx'});
  assert.equal(after.fields.some((f)=>f.key==='creator'),false);
  assert.equal(after.fields.find((f)=>f.key==='title').value,'Keep me');
});


test('metadata intelligence explains openpyxl and template workflows', () => {
  const x = interpretMetadata({ fields: [
    {group:'document',key:'creator',label:'Author',value:'openpyxl',privacy:'high'},
    {group:'application',key:'Application',label:'Application',value:'Microsoft Excel Compatible / Openpyxl 3.1.5',privacy:'medium'},
  ], signals:{} });
  assert.ok(x.insights.some((i)=>i.title.includes('generated programmatically')));
  assert.ok(x.fields.every((f)=>f.meaning && f.interpretation));

  const p = interpretMetadata({ fields: [
    {group:'document',key:'title',label:'Title',value:'LACO Word template - graphical front page',privacy:'info'},
    {group:'software',key:'creator',label:'Creator',value:'Microsoft Word for Microsoft 365',privacy:'medium'},
    {group:'software',key:'producer',label:'Producer',value:'Microsoft Word for Microsoft 365',privacy:'medium'},
  ], signals:{} });
  assert.ok(p.insights.some((i)=>i.title.includes('Reusable Word template')));
});

test('metadata intelligence surfaces deep document signals', () => {
  const x = interpretMetadata({ fields:[], signals:{ trackedChanges:true, hiddenSheets:2, embeddedObjects:true, incrementalUpdates:3 } });
  assert.ok(x.insights.some((i)=>i.title.includes('Tracked changes')));
  assert.ok(x.insights.some((i)=>i.title.includes('Hidden spreadsheet')));
  assert.ok(x.insights.some((i)=>i.title.includes('Embedded objects')));
  assert.ok(x.insights.some((i)=>i.title.includes('PDF revisions')));
});
