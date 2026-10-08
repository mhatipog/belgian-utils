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
  let quoted=false, out='';
  for(let i=0;i<Math.min(text.length,30000);i++){
    const c=text[i]; if(c==='"')quoted=!quoted;
    if(!quoted && (c==='\r'||c==='\n'))break;
    out+=c;
  }
  return out;
}
export function guessDelimiter(text) {
  const line=firstRecord(String(text).replace(/^\uFEFF/,''));
  const counts=[['\t',0],[';',0],[',',0]];
  let quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"' && line[i+1]==='"'){i++;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(!quoted)for(const pair of counts)if(c===pair[0])pair[1]++;
  }
  return counts.sort((a,b)=>b[1]-a[1])[0][1] ? counts[0][0] : ';';
}
export function parseOpenData(text, {delimiter, maxRows=400000}={}) {
  const input=String(text??'').replace(/^\uFEFF/,'');
  const sep=delimiter||guessDelimiter(input);
  const rows=[]; let row=[],cell='',quoted=false;
  // Standard RFC-4180 escaped quotes; CRLF and line feeds accepted.
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(c==='"' && quoted && input[i+1]==='"'){cell+='"';i++;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(!quoted && c===sep){row.push(cell.trim());cell='';continue;}
    if(!quoted && (c==='\r'||c==='\n')){
      if(c==='\r' && input[i+1]==='\n')i++;
      row.push(cell.trim());cell='';
      if(row.some(Boolean))rows.push(row);
      row=[];
      if(rows.length>maxRows+1)throw new Error('Too many records: use a smaller official extract (limit '+maxRows+').');
      continue;
    }
    cell+=c;
  }
  if(quoted)throw new Error('Unclosed quoted field in source file.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(!rows.length)throw new Error('The file contains no records.');
  const headers=rows.shift().map((h,i)=>h||'Column '+(i+1));
  if(headers.length<2)throw new Error('No delimited columns found. Select the TXT/CSV member of the official ZIP.');
  return { headers, rows: rows.map(r=>headers.map((_,i)=>r[i]??'')), delimiter:sep, truncated:false };
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
const HINTS={
  favv: {
    key: ['ondernemingsnummer','numentreprise','entreprisenumber','nummeronderneming','kbonummer','num_bce','bce','kbo'],
    name: ['benaming','denomination','naam','enseigne','operatorname','nom','name'],
    pap: ['papcode','codepap','pap','activiteitencode','codeactivite'],
    permit: ['toelatingsnummer','erkenningsnummer','numerodautorisation','numerodagrement','autorisation','agrement'],
    site: ['vestigingseenheid','uniteetablissement','operatornummer','noperateur'],
  },
  property: {
    geo: ['cdrefnis','refnis','nis9','nis7','gemeentecode','codemunicipality','commune','gemeente','municipality','geography','geo'],
    year: ['jaar','annee','year','period','periode'],
    type: ['typegebouw','typebien','aard','nature','buildingtype','type'],
    count: ['transacties','transaction','aantal','nombre','count','msn'],
    median: ['median','mediane','q50','p50','msp50'],
    p25: ['q25','p25','msp25'],
    p75: ['q75','p75','msp75'],
  },
  sector: {
    nace: ['nace2025','nacebel2025','nacebel','nace','activiteit','activite','activity'],
    month: ['maand','mois','month','periode','period','date','tijd'],
    starts: ['oprichtingen','creations','starters','starts','naissances','start'],
    stops: ['stopzettingen','cessations','closures','cesses','stops','radiations'],
    stock: ['actievebedrijven','assujettis','entreprisesactives','stock','population','total'],
    category: ['beweging','mouvement','indicator','type','measure','variable'],
    amount: ['waarde','valeur','value','nombre','aantal','count'],
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
  const q=foldData(query);if(q.length<3)return[];
  const matched=data.rows.filter(row=>{
    const number=enterpriseKey(query),k=enterpriseKey(cellValue(row,fields,'key'));
    return (number&&k===number) || foldData(cellValue(row,fields,'name')).includes(q) ||
      (fields.name<0 && row.some(x=>foldData(x).includes(q)));
  }).slice(0,max);
  const activityIndex=new Map();
  if(activities&&activityFields){for(const r of activities.rows){const p=foldData(cellValue(r,activityFields,'pap'));if(p)activityIndex.set(p,r);}}
  const smileyKeys=new Set();
  if(smileys&&smileyFields){for(const r of smileys.rows){const key=enterpriseKey(cellValue(r,smileyFields,'key'));if(key)smileyKeys.add(key);}}
  return matched.map(row=>{
    const key=enterpriseKey(cellValue(row,fields,'key'));
    const pap=cellValue(row,fields,'pap');
    const activity=activityIndex.get(foldData(pap));
    return {key,name:cellValue(row,fields,'name'),pap,permit:cellValue(row,fields,'permit'),
      activity:activity?activity.join(' | ').slice(0,220):'',
      smiley:smileys&&smileyFields?.key>=0 && key ? smileyKeys.has(key) : null};
  });
}
export function propertySeries(data,fields,{geo,type}={}){
  if(fields.geo<0||fields.year<0||fields.median<0)throw new Error('Map the geography, year and median-price columns first.');
  const rows=data.rows.filter(r=>(!geo||foldData(cellValue(r,fields,'geo'))===foldData(geo))&&(!type||cellValue(r,fields,'type')===type))
    .map(r=>({geo:cellValue(r,fields,'geo'),type:cellValue(r,fields,'type'),year:cellValue(r,fields,'year'),
      median:numericValue(cellValue(r,fields,'median')),p25:numericValue(cellValue(r,fields,'p25')),
      p75:numericValue(cellValue(r,fields,'p75')),count:numericValue(cellValue(r,fields,'count'))}))
    .filter(x=>x.year).sort((a,b)=>b.year.localeCompare(a.year));
  return rows;
}
export function propertyPosition(price,stats) {
  const p=numericValue(price);
  if(p===null||p<=0||stats?.median===null||!Number.isFinite(stats?.median)||stats.median<=0)return null;
  return {difference:Math.round((p/stats.median-1)*1000)/10,range:stats.p25!==null&&stats.p75!==null ?
    (p<stats.p25?'below-p25':p>stats.p75?'above-p75':'middle-50'):'unknown'};
}
export function sectorSeries(data,fields,{nace}={}){
  if(fields.nace<0||fields.month<0)throw new Error('Map NACE and month columns first.');
  const clean=foldData(nace);
  return data.rows.filter(r=>!clean||foldData(cellValue(r,fields,'nace'))===clean)
   .map(r=>({nace:cellValue(r,fields,'nace'),month:cellValue(r,fields,'month'),
     starts:numericValue(cellValue(r,fields,'starts')),stops:numericValue(cellValue(r,fields,'stops')),
     stock:numericValue(cellValue(r,fields,'stock')),
     category:cellValue(r,fields,'category'),amount:numericValue(cellValue(r,fields,'amount'))}))
   .filter(r=>r.month).sort((a,b)=>a.month.localeCompare(b.month));
}
