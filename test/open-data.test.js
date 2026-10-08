import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenData,guessFields,matchFavv,propertySeries,propertyPosition,sectorSeries,numericValue,enterpriseKey} from '../src/be/open-data.js';
test('CSV quotes, embedded separator and newline, as well as TSV',()=>{
 const r=parseOpenData('KBO;Naam;PAP\r\n0417497106;"Brood; en melk";A01\r\n1234567890;"multi\nline";A02\r\n');
 assert.equal(r.rows.length,2);assert.equal(r.rows[0][1],'Brood; en melk');assert.equal(r.rows[1][1],'multi\nline');
 assert.deepEqual(parseOpenData('code\twaarde\nA\t1').headers,['code','waarde']);
});
test('suppressed observations never become zero or a fabricated median',()=>{
 assert.equal(numericValue(':'),null);assert.equal(numericValue('.'),null);
 assert.equal(numericValue('235.000'),235000);assert.equal(numericValue('123,5'),123.5);
 const d=parseOpenData('Gemeente;Jaar;Q50;Q25;Q75;Aantal\n41081;2024;.;.;.;8\n41081;2023;250000;210000;310000;52');
 const fields=guessFields(d.headers,'property');
 const rows=propertySeries(d,fields,{geo:'41081'});
 assert.equal(rows.length,2);assert.equal(rows[0].median,null);
 assert.equal(rows[1].median,250000);
 assert.equal(propertyPosition('300000',rows[0]),null);
 assert.deepEqual(propertyPosition('300000',rows[1]),{difference:20,range:'middle-50'});
});
test('FAVV operator joins are exact on enterprise number, never name alone',()=>{
 const ops=parseOpenData('Ondernemingsnummer;Benaming;PAP code\n0417497106;Café Café;P1\n0452333329;Andere;P2');
 const pap=parseOpenData('PAP code;Omschrijving\nP1;Restaurant');
 const smiles=parseOpenData('Ondernemingsnummer;Naam\n0417497106;Café Café');
 const result=matchFavv(ops,guessFields(ops.headers,'favv'),'0417497106',{
 activities:pap,activityFields:guessFields(pap.headers,'favv'),
 smileys:smiles,smileyFields:guessFields(smiles.headers,'favv')});
 assert.equal(result.length,1);assert.equal(result[0].smiley,true);
 assert.match(result[0].activity,/Restaurant/);
 assert.equal(enterpriseKey('BE 0417.497.106'),'0417497106');
});
test('NACE sector series must match exact code and month',()=>{
 const data=parseOpenData('NACE;Month;Starts;Stops\n62.1;2026-02;100;70\n62.10;2026-02;8;3\n62.10;2026-01;5;1');
 const rows=sectorSeries(data,guessFields(data.headers,'sector'),{nace:'62.10'});
 assert.deepEqual(rows.map(x=>x.starts),[5,8]);
 assert.deepEqual(rows.map(x=>x.stops),[1,3]);
});
