import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenData,guessFields,matchFavv,propertySeries,propertyPosition,sectorSeries,numericValue} from '../src/be/open-data.js';

test('read official Statbel pipe-separated files and FAVV quoted CSV',()=>{
 const txt=parseOpenData('CD_YEAR|CD_REFNIS|CD_PERIOD|MS_P_50_median\r\n2024|41081|Y|250000');
 assert.deepEqual(txt.headers,['CD_YEAR','CD_REFNIS','CD_PERIOD','MS_P_50_median']);
 assert.equal(txt.rows[0][3],'250000');
 const csv=parseOpenData('"LNO Uniek Nr ","OP Uniek Nr Id ","PAP Id"\r\n"0417497106","2328003364","1017"');
 assert.equal(csv.rows[0][0],'0417497106');
 assert.equal(parseOpenData('A\tB\n1\t2').delimiter,'\t');
 assert.equal(numericValue(':'),null);
 assert.equal(numericValue('235.000'),235000);
});
test('FAVV Smiley join requires exact establishment ID, not enterprise ID',()=>{
 const ops=parseOpenData('"LNO Uniek Nr ","OP Uniek Nr Id ","PAP Id","GEM Naam "\n"0417497106","2328003364","1017","Gent"');
 const pap=parseOpenData('"PAP Id","PAP omschrijving"\n"1017","Hantering bijproducten"');
 const smiles=parseOpenData('"Vestiging Uniek nr.","Vestiging Naam","Smiley geldig tot"\n"2328003364","Demo","2027/03/31"');
 const match=matchFavv(ops,guessFields(ops.headers,'favv'),'0417497106',{
  activities:pap,activityFields:guessFields(pap.headers,'activities'),
  smileys:smiles,smileyFields:guessFields(smiles.headers,'smileys')
 });
 assert.equal(match.length,1);
 assert.equal(match[0].site,'2328003364');
 assert.equal(match[0].smiley,true);
 assert.match(match[0].activity,/Hantering/);
 assert.equal(match[0].smileyValidUntil,'2027/03/31');
 const wrong=parseOpenData('"Vestiging Uniek nr.","Vestiging Naam"\n"2000000000","Demo"');
 const notJoined=matchFavv(ops,guessFields(ops.headers,'favv'),'0417497106',{
  smileys:wrong,smileyFields:guessFields(wrong.headers,'smileys')
 });
 assert.equal(notJoined[0].smiley,false);
});
test('Statbel price suppression is never interpolated, quarter retained',()=>{
 const file=parseOpenData('CD_YEAR|CD_REFNIS|CD_PERIOD|MS_P_25|MS_P_50_median|MS_P_75|MS_TOTAL_TRANSACTIONS\n2024|41081|Q4||||8\n2023|41081|Q4|200000|250000|300000|30');
 const rows=propertySeries(file,guessFields(file.headers,'property'),{geo:'41081'});
 assert.equal(rows.length,2);assert.equal(rows[0].median,null);
 assert.match(rows[0].year,/Q4/);
 assert.equal(propertyPosition('260000',rows[0]),null);
 assert.deepEqual(propertyPosition('260000',rows[1]),{difference:4,range:'middle-50'});
});
test('NACE2 official monthly regions aggregate known records only',()=>{
 const file=parseOpenData('YEAR|MONTH|NACE2|CD_REGION|MS_NUM_VAT_FIRST_STRT|MS_NUM_VAT_RESTART|MS_NUM_VAT_STOP|MS_NUM_VAT_EOP\n2025|01|62|02000|10|2|-4|150\n2025|01|62|03000|5|0|-2|80\n2025|01|63|02000|99|0|-50|1200');
 const rows=sectorSeries(file,guessFields(file.headers,'sector'),{nace:'62.100'});
 assert.equal(rows.length,1);assert.equal(rows[0].month,'2025-01');
 assert.equal(rows[0].starts,17);assert.equal(rows[0].stops,6);
 assert.equal(rows[0].stock,230);
});

test('FAVV operator name search uses the separate Smiley establishment name only',()=>{
 const ops=parseOpenData('"OP Uniek Nr Id ","LNO Uniek Nr ","PAP Id","GEM Naam ","PAP ACT Omschrijving"\n"2328003364","0417497106","1017","Gent","Hanteren"\n"2000000000","0999999999","9999","Leuven","Opslag"');
 const smileys=parseOpenData('"Vestiging Uniek nr.","Vestiging Naam","Smiley geldig tot"\n"2328003364","Demo Bakkerij","2027/03/31"');
 const f=guessFields(ops.headers,'favv'),sf=guessFields(smileys.headers,'smileys');
 const named=matchFavv(ops,f,'bakkerij',{smileys,smileyFields:sf});
 assert.equal(named.length,1);
 assert.equal(named[0].key,'0417497106');
 assert.equal(named[0].name,'Demo Bakkerij');
 assert.equal(named[0].nameSource,'smileys');
 assert.equal(named[0].sourceFields.length,5);
 assert.deepEqual(named[0].sourceFields[4],['PAP ACT Omschrijving','Hanteren']);
 assert.equal(matchFavv(ops,f,'bakkerij').length,0,'No invented company-name coverage without Smiley data');
 assert.equal(matchFavv(ops,f,'Leuven').length,1,'Municipality search still works');
});
