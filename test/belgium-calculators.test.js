import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticePeriodBelgium, indexAmount, rentIndexationBelgium, companyCarBenefitBelgium, mobilityBudgetSplit } from '../src/be/employment-finance.js';
import { vatGridInfo, suggestVatGrids, cleanEnterpriseNumbers } from '../src/be/vat-enterprise.js';
import { municipalityMergerLookup, schoolHolidayStatus } from '../src/be/calendar-geo.js';
import { statutoryInterestBelgium, belgianPublicHolidays, workingDaysBetweenBelgium, addWorkingDaysBelgium } from '../src/be/interest-days.js';
import { parseXlsxTables, buildNaceMigrationMap, migrateNaceCodes } from '../src/xlsx-lite.js';

test('Belgian notice periods use the 2026 contract-date regimes', () => {
  assert.equal(noticePeriodBelgium({contractStart:'2026-08-01',noticeStart:'2026-10-01',initiator:'employer'}).weeks,1);
  assert.equal(noticePeriodBelgium({contractStart:'2026-08-01',noticeStart:'2027-04-01',initiator:'employee'}).weeks,3);
  assert.equal(noticePeriodBelgium({contractStart:'2020-01-01',noticeStart:'2026-09-01',initiator:'employer'}).weeks,21);
  assert.equal(noticePeriodBelgium({contractStart:'2010-01-01',noticeStart:'2026-09-01'}).supported,false);
});

test('indexation, rent, company-car VAA and mobility budget calculations', () => {
  assert.equal(indexAmount({amount:1000,oldIndex:100,newIndex:110}).indexed,1100);
  assert.equal(rentIndexationBelgium({amount:900,oldIndex:125,newIndex:137.5}).indexed,990);
  const car=companyCarBenefitBelgium({catalogValue:50000,co2:0,fuel:'electric',firstRegistration:'2025-01-01',benefitDate:'2026-01-01'});
  assert.ok(Math.abs(car.ageFactor-.94)<1e-12);
  assert.equal(car.co2Percentage,.04);
  assert.ok(car.taxableAnnual>=1690);
  const mob=mobilityBudgetSplit({budget:10000,grossAnnual:60000,pillar1:3000,pillar2:2000});
  assert.equal(mob.pillar3Gross,5000);
  assert.equal(mob.pillar3Contribution,1903.5);
  assert.equal(mob.pillar3Net,3096.5);
});

test('VAT grids and enterprise batch cleaner', () => {
  assert.equal(vatGridInfo('03').label,'Belgian taxable transactions at 21%');
  assert.deepEqual(suggestVatGrids('eu_service_purchase').map(x=>x.code),['88','55','59']);
  const r=cleanEnterpriseNumbers('BE 0753.124.628\n0753 124 628\nBE 1000.000.021\nBE 0753.124.629');
  assert.equal(r[0].valid,true);
  assert.equal(r[1].duplicate,true);
  assert.equal(r[2].valid,true,'new 1-series enterprise numbers are accepted');
  assert.equal(r[3].valid,false);
});

test('2025 municipal mergers and 2026-27 school calendars', () => {
  assert.equal(municipalityMergerLookup('Borsbeek')[0].newName,'Antwerpen');
  assert.equal(municipalityMergerLookup('44073')[0].newName,'Lochristi');
  assert.equal(schoolHolidayStatus('2026-11-04','flanders').period.name,'Autumn break');
  assert.equal(schoolHolidayStatus('2026-10-26','french').isHoliday,true);
  assert.equal(schoolHolidayStatus('2026-09-15','german').isHoliday,false);
});

test('interest tables split periods and Belgian working days exclude statutory holidays', () => {
  const i=statutoryInterestBelgium({principal:10000,start:'2025-12-31',end:'2026-01-02'});
  assert.equal(i.segments.length,2);
  assert.equal(i.segments[1].rate,4.5);
  const c=statutoryInterestBelgium({principal:10000,start:'2026-07-01',end:'2026-07-31',type:'commercial'});
  assert.equal(c.segments[0].rate,10.5);
  assert.ok(belgianPublicHolidays(2026).some(x=>x.date==='2026-05-14'&&x.name==='Ascension'));
  const d=workingDaysBetweenBelgium({start:'2026-07-20',end:'2026-07-22'});
  assert.equal(d.workdays,2);
  assert.equal(d.holidayWeekdays,1);
  assert.equal(addWorkingDaysBelgium({start:'2026-07-20',days:2}),'2026-07-23');
});

function zipStored(files){
  const enc=new TextEncoder(), parts=[], central=[]; let offset=0;
  for(const [nameText,text] of Object.entries(files)){
    const name=enc.encode(nameText),data=enc.encode(text),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(8,0,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
    const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(10,0,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);
    parts.push(local,data);central.push(c);offset+=local.length+data.length;
  }
  const cs=central.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,central.length,true);ev.setUint16(10,central.length,true);ev.setUint32(12,cs,true);ev.setUint32(16,offset,true);
  const all=[...parts,...central,end],out=new Uint8Array(all.reduce((s,x)=>s+x.length,0));let p=0;for(const x of all){out.set(x,p);p+=x.length;}return out;
}

test('NACE migration parser reads local XLSX and preserves one-to-many mappings', async () => {
  const shared='<sst><si><t>NACE-BEL 2008</t></si><si><t>NACE-BEL 2025</t></si><si><t>Old</t></si><si><t>New</t></si></sst>';
  const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>62010</v></c><c r="B2"><v>62100</v></c></row><row r="3"><c r="A3"><v>62010</v></c><c r="B3"><v>62200</v></c></row></sheetData></worksheet>';
  const bytes=zipStored({'xl/sharedStrings.xml':shared,'xl/worksheets/sheet1.xml':sheet});
  const tables=await parseXlsxTables(bytes);
  const map=buildNaceMigrationMap(tables[0].rows);
  assert.deepEqual(map.mappings['62010'],['62100','62200']);
  assert.equal(migrateNaceCodes('62.010',map.mappings)[0].status,'one-to-many');
});
