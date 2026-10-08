// MIT-licensed. Source: https://github.com/mhatipog/belgian-utils
// Generic Belgian open-data CSV/TSV utilities. Input is untrusted publisher data.
export const OFFICIAL_OPEN_DATA = Object.freeze({
  favv: 'https://www.foodweb.favv-afsca.be/professionelen/praktisch/opendata/',
  property: 'https://statbel.fgov.be/nl/open-data/verkopen-vastgoed-volgens-aard-de-verkoopsakte-belgie',
  propertySector: 'https://statbel.fgov.be/nl/open-data/verkopen-vastgoed-volgens-aard-de-verkoopakte-statistische-sector-nis9',
  sector: 'https://statbel.fgov.be/nl/open-data/maandevolutie-van-de-btw-plichtige-ondernemingen-volgens-nace-2025',
});
export function foldData(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function enterpriseKey(value) {
  const s = String(value ?? '').replace(/^BE/i, '').replace(/\D/g, '');
  return s.length === 9 ? '0' + s : s.length === 10 ? s : '';
}
function firstRecord(text) {
  const s=String(text).replace(/^\uFEFF/,'');
  const end=s.search(/[\r\n]/);
  return end<0?s.slice(0,30000):s.slice(0,Math.min(end,30000));
}
export function guessDelimiter(text) {
  const line=firstRecord(text);
  const counts=[['|',0],['\t',0],[';',0],[',',0]];
  let quoted=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(char==='"' && line[i+1]==='"' && quoted){i++;continue;}
    if(char==='"'){quoted=!quoted;continue;}
    if(!quoted)for(const pair of counts)if(char===pair[0])pair[1]++;
  }
  counts.sort((a,b)=>b[1]-a[1]);
  return counts[0][1]?counts[0][0]:';';
}
/** RFC-4180-style parser, tolerant of literal quotes inside unquoted publisher cells.
 * Rows are bounded; malformed individual quote characters do not swallow the
 * remainder of the 80MB FAVV operator CSV.
 */
export function parseOpenData(text,{delimiter,maxRows=2000000}={}) {
  const input=String(text??'').replace(/^\uFEFF/,'');
  const sep=delimiter||guessDelimiter(input);
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i],next=input[i+1];
    if(ch==='"'){
      if(quoted){
        if(next==='"'){cell+='"';i++;continue;}
        if(next===sep || next==='\r' || next==='\n' || next===undefined){quoted=false;continue;}
        // Publisher includes an unescaped quotation mark mid-value.
        cell+='"';continue;
      }
      if(!cell.trim()){quoted=true;cell='';continue;}
      cell+='"';continue;
    }
    if(!quoted && ch===sep){row.push(cell.trim());cell='';continue;}
    if(!quoted && (ch==='\r'||ch==='\n')){
      if(ch==='\r'&&next==='\n')i++;
      row.push(cell.trim());cell='';
      if(row.some(Boolean))rows.push(row);
      row=[];
      if(rows.length>maxRows+1)throw new Error('Source exceeds permitted record count: '+maxRows);
      continue;
    }
    cell+=ch;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw new Error('No tabular records found in the official source.');
  const headers=rows.shift().map((h,i)=>h||'Column '+(i+1));
  if(headers.length<2)throw new Error('Unsupported column delimiter in official data.');
  // Prevent a badly quoted source from silently accepting millions of broken rows.
  const invalid=rows.slice(0,Math.min(200,rows.length)).filter(r=>r.length!==headers.length).length;
  if(invalid>10)throw new Error('Source file rows do not match the header structure.');
  return {headers,rows:rows.map(r=>headers.map((_,i)=>r[i]??'')),delimiter:sep,truncated:false};
}
export function numericValue(value) {
  let s=String(value??'').trim();
  if(!s||/^(?:na|n\/a|:|\.{1,3}|-|suppressed|null)$/i.test(s))return null;
  s=s.replace(/[\u00a0\u202f\s€]/g,'');
  if(/^-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/.test(s)){
    const last=s.lastIndexOf(',')>s.lastIndexOf('.')?',':'.';
    const pieces=s.split(last);
    s=pieces.length===2&&pieces[1].length!==3 ? pieces[0].replace(/[.,]/g,'')+'.'+pieces[1] : s.replace(/[.,]/g,'');
  }else if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:null;
}
const HINTS = {
 favv:{
  key:['LNO Uniek Nr','ondernemingsnummer','numeroentreprise','entreprisenumber','numentreprise','kbonummer'],
  site:['OP Uniek Nr Id','OP Uniek Nr','vestiginguniek','vestigingseenheid'],
  name:['benaming','vestigingnaam','denomination','operatorname','nomentreprise'],
  pap:['PAP Id','papcode','codepap','pap'],
  permit:['ERK Nummer','toelatingsnummer','erkenningsnummer','numeroautorisation'],
  city:['GEM Naam','gemeente','commune'],
  postcode:['PC Postcode','postcode','codepostal']
 },
 activities:{pap:['PAP Id','papcode'],description:['PAP omschrijving','papdescription','omschrijving']},
 smileys:{site:['Vestiging Uniek nr.','vestiginguniek'],name:['Vestiging Naam'],validUntil:['Smiley geldig tot']},
 property:{
  geo:['CD_REFNIS','CD_STAT_SECTOR','cdrefnis','cdstatsector','nis9','gemeentecode','commune','gemeente'],
  year:['CD_YEAR','year','jaar','annee'],
  period:['CD_PERIOD','period','periode'],
  type:['CD_TYPE_NL','CD_TYPE','typegebouw','typebien','aard'],
  count:['MS_TOTAL_TRANSACTIONS','MS_TRANSACTIONS','transacties','transactions','count'],
  median:['MS_P_50_median','MS_P50 (MEDIAN_PRICE)','msp50median','msp50medianprice','mediane','median','q50','p50'],
  p25:['MS_P_25','MS_P25','q25','p25'],
  p75:['MS_P_75','MS_P75','q75','p75']
 },
 sector:{
  nace:['NACE2','nace2025','nacebel2025','nace','activity'],
  year:['YEAR','CD_YEAR','jaar','annee'],
  month:['MONTH','maand','mois','periode','date'],
  starts:['MS_NUM_VAT_FIRST_STRT','firststart','creations','starters'],
  restarts:['MS_NUM_VAT_RESTART','restart'],
  stops:['MS_NUM_VAT_STOP','stopzettingen','cessations','closures'],
  stock:['MS_NUM_VAT_EOP','stock','entreprisesactives'],
  region:['CD_REGION','region'],
  legal:['TX_LGL_CO_TYPE_NL_LVL1','legalform'],
  category:['indicator','measure','variable'],
  amount:['value','valeur','waarde']
 }
};
export function guessFields(headers,kind){
  const hints=HINTS[kind]||{};const result={};
  const cols=headers.map(foldData);
  for(const [key,terms]of Object.entries(hints)){
    const norm=terms.map(foldData);
    const exact=cols.findIndex(x=>norm.includes(x));
    const fuzzy=cols.findIndex(x=>norm.some(t=>t.length>=4&&(x.includes(t)||t.includes(x))));
    result[key]=exact>=0?exact:fuzzy>=0?fuzzy:-1;
  }
  return result;
}
export function cellValue(row,fields,key){ const i=fields[key];return Number.isInteger(i)&&i>=0?String(row[i]??''):''; }
export function matchFavv(data,fields,query,{activities=null,activityFields=null,smileys=null,smileyFields=null,max=40}={}){
 const q=foldData(query),id=enterpriseKey(query);
 if(q.length<3)return[];
 const matches=[];
 for(const row of data.rows) {
  const key=enterpriseKey(cellValue(row,fields,'key'));
  const site=enterpriseKey(cellValue(row,fields,'site'));
  const rawKey=foldData(cellValue(row,fields,'key'));
  const rawSite=foldData(cellValue(row,fields,'site'));
  const byId=(id&&(key===id||site===id))||(q.length>=5&&(rawKey===q||rawSite===q));
  const byText=(!/^\d+$/.test(q))&&[cellValue(row,fields,'name'),cellValue(row,fields,'city')].some(v=>foldData(v).includes(q));
  const byPostcode=/^\d{4}$/.test(q)&&cellValue(row,fields,'postcode')===q;
  if(byId||byText||byPostcode){matches.push(row);if(matches.length===max)break;}
 }
 const papIndex=new Map();
 if(activities&&activityFields?.pap>=0){
  for(const row of activities.rows){const pap=foldData(cellValue(row,activityFields,'pap'));if(pap)papIndex.set(pap,row);}
 }
 const smilesIndex=new Map();
 if(smileys&&smileyFields?.site>=0){
  for(const row of smileys.rows){
   const site=enterpriseKey(cellValue(row,smileyFields,'site'));
   if(site)smilesIndex.set(site,row);
  }
 }
 return matches.map(row=>{
  const key=enterpriseKey(cellValue(row,fields,'key'));
  const site=enterpriseKey(cellValue(row,fields,'site'));
  const pap=cellValue(row,fields,'pap');
  const activity=papIndex.get(foldData(pap));
  const smiley=smileys&&smileyFields?.site>=0&&site ? smilesIndex.has(site):null;
  return {key,site,name:cellValue(row,fields,'name'),city:cellValue(row,fields,'city'),
   postcode:cellValue(row,fields,'postcode'),pap,permit:cellValue(row,fields,'permit'),
   activity:activity?cellValue(activity,activityFields,'description')||activity.join(' | ').slice(0,220):'',
   smiley,
   smileyValidUntil:smiley?cellValue(smilesIndex.get(site),smileyFields,'validUntil'):''
  };
 });
}
export function propertySeries(data,fields,{geo,type}={}){
 if(fields.geo<0||fields.year<0||fields.median<0)throw new Error('Required geographic, year or median columns are missing.');
 return data.rows.filter(row=>(!geo||foldData(cellValue(row,fields,'geo'))===foldData(geo))&&(!type||cellValue(row,fields,'type')===type))
 .map(row=>{
  const year=cellValue(row,fields,'year'),period=cellValue(row,fields,'period');
  return {geo:cellValue(row,fields,'geo'),type:cellValue(row,fields,'type'),
   year:year+(period&&period.toLowerCase()!=='year'?' '+period:''),
   median:numericValue(cellValue(row,fields,'median')),p25:numericValue(cellValue(row,fields,'p25')),
   p75:numericValue(cellValue(row,fields,'p75')),count:numericValue(cellValue(row,fields,'count'))};
 }).filter(x=>x.year).sort((a,b)=>b.year.localeCompare(a.year));
}
export function propertyPosition(price,stats) {
 const p=numericValue(price);
 if(p===null||p<=0||stats?.median===null||!Number.isFinite(stats?.median)||stats.median<=0)return null;
 return {difference:Math.round((p/stats.median-1)*1000)/10,range:stats.p25!==null&&stats.p75!==null ?
   (p<stats.p25?'below-p25':p>stats.p75?'above-p75':'middle-50'):'unknown'};
}
export function sectorSeries(data,fields,{nace}={}){
 if(fields.nace<0||fields.month<0)throw new Error('NACE and month fields are required.');
 // The official TF_STARTERS_45_2025 source publishes NACE2 divisions, not 5-digit subclasses.
 const raw=String(nace||'').replace(/\D/g,'');
 const code=raw.length>2?raw.slice(0,2):raw.padStart(2,'0');
 const byMonth=new Map();
 for(const row of data.rows){
  if(foldData(cellValue(row,fields,'nace'))!==foldData(code))continue;
  const region=cellValue(row,fields,'region');
  if(fields.region>=0&&region&&!['02000','03000','04000'].includes(region))continue;
  if(fields.region>=0&&!region)continue; // unavailable geography, never infer values
  const y=cellValue(row,fields,'year'),m=cellValue(row,fields,'month').padStart(2,'0');
  const month=(y?y+'-':'')+m;
  if(!month)continue;
  const first=numericValue(cellValue(row,fields,'starts')),restart=numericValue(cellValue(row,fields,'restarts'));
  const stop=numericValue(cellValue(row,fields,'stops')),stock=numericValue(cellValue(row,fields,'stock'));
  let item=byMonth.get(month);
  if(!item){item={month,nace:code,starts:0,stops:0,stock:0,rows:0};byMonth.set(month,item);}
  item.starts+=(first||0)+(restart||0);
  item.stops+=Math.abs(stop||0);
  item.stock+=stock||0;item.rows++;
 }
 return [...byMonth.values()].filter(x=>x.rows>0).sort((a,b)=>a.month.localeCompare(b.month));
}
