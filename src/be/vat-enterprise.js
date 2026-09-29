export const VAT_GRIDS={
'00':{section:'outgoing',label:'Transactions at 0% / specific exempt or special transactions',hint:'Tax base; use only where the VAT return rules assign the operation to grid 00.'},
'01':{section:'outgoing',label:'Belgian taxable transactions at 6%',hint:'Tax base; VAT due normally flows to grid 54.'},
'02':{section:'outgoing',label:'Belgian taxable transactions at 12%',hint:'Tax base; VAT due normally flows to grid 54.'},
'03':{section:'outgoing',label:'Belgian taxable transactions at 21%',hint:'Tax base; VAT due normally flows to grid 54.'},
'44':{section:'outgoing',label:'Intra-EU B2B services taxed at the customer',hint:'Services located in another EU Member State under the general B2B rule where the customer owes the VAT.'},
'45':{section:'outgoing',label:'Belgian transactions where the co-contractor owes VAT',hint:'Domestic reverse-charge situations assigned to grid 45.'},
'46':{section:'outgoing',label:'Intra-EU supplies and assimilated transactions',hint:'Exempt intra-Community supplies and specified triangular transactions.'},
'47':{section:'outgoing',label:'Other exempt / foreign transactions',hint:'Among others exports and qualifying transactions outside Belgium not reported in 44/46.'},
'48':{section:'outgoing',label:'Issued credit notes / negative corrections for grids 44 and 46',hint:'Base amounts reducing transactions previously reported in 44 or 46.'},
'49':{section:'outgoing',label:'Other issued credit notes / negative corrections in outgoing frame',hint:'Base amounts for other negative corrections in frame II.'},
'81':{section:'incoming',label:'Purchases of goods, raw and auxiliary materials',hint:'Input transactions, excluding deductible VAT.'},
'82':{section:'incoming',label:'Purchases of services and other goods',hint:'Input transactions, excluding deductible VAT.'},
'83':{section:'incoming',label:'Investment goods',hint:'Input investment transactions, excluding deductible VAT.'},
'84':{section:'incoming',label:'Received credit notes for grids 86/88',hint:'Negative corrections related to intra-EU acquisitions/services.'},
'85':{section:'incoming',label:'Other received credit notes / negative corrections',hint:'Negative corrections for other input transactions.'},
'86':{section:'incoming',label:'Intra-EU acquisitions of goods and assimilated transactions',hint:'Tax due normally flows to grid 55.'},
'87':{section:'incoming',label:'Other incoming transactions where declarant owes VAT',hint:'Includes specified domestic reverse-charge/import situations; tax can flow to 56/57.'},
'88':{section:'incoming',label:'Intra-EU services received under reverse charge',hint:'Tax due normally flows to grid 55.'},
'54':{section:'tax',label:'VAT due on grids 01, 02 and 03',hint:'Normally 6%, 12% and 21% of the corresponding taxable bases.'},
'55':{section:'tax',label:'VAT due on grids 86 and 88',hint:'Self-assessed Belgian VAT on intra-EU acquisitions/services.'},
'56':{section:'tax',label:'VAT due on grid 87 (excluding import VAT in 57)',hint:'Other self-assessed VAT.'},
'57':{section:'tax',label:'Import VAT due under deferred payment',hint:'Import VAT assigned to grid 57.'},
'59':{section:'deductible',label:'Deductible input VAT',hint:'VAT deductible according to the normal deduction rules.'},
'61':{section:'tax',label:'Adjustments in favour of the State',hint:'Positive VAT adjustments assigned to grid 61.'},
'62':{section:'deductible',label:'Adjustments in favour of the declarant',hint:'VAT adjustments assigned to grid 62.'},
'63':{section:'tax',label:'VAT to repay because of received credit notes',hint:'Tax corrections due to the State.'},
'64':{section:'deductible',label:'Recoverable VAT on issued credit notes',hint:'VAT recovery associated with qualifying issued credit notes.'},
'71':{section:'balance',label:'Amount due to the State',hint:'Positive difference of VAT due versus deductible VAT.'},
'72':{section:'balance',label:'Amount due by the State',hint:'VAT credit where deductible VAT exceeds VAT due.'}
};
export function vatGridInfo(code){const k=String(code??'').replace(/\D/g,'').padStart(2,'0');return VAT_GRIDS[k]?{code:k,...VAT_GRIDS[k]}:null;}
export function suggestVatGrids(kind){const map={sale6:['01','54'],sale12:['02','54'],sale21:['03','54'],eu_service_sale:['44'],domestic_reverse_sale:['45'],eu_goods_sale:['46'],export:['47'],eu_goods_purchase:['86','55','59'],eu_service_purchase:['88','55','59'],domestic_reverse_purchase:['87','56','59'],investment:['83','59'],purchase_goods:['81','59'],purchase_service:['82','59']};return (map[kind]||[]).map(vatGridInfo);}

function digitsOnly(v){return String(v??'').replace(/\D/g,'');}
function enterpriseValid(d){if(!/^[01]\d{9}$/.test(d))return false;const base=+d.slice(0,8),check=+d.slice(8),expected=97-(base%97);return check===expected;}
export function formatEnterprise(d){return `${d.slice(0,4)}.${d.slice(4,7)}.${d.slice(7)}`;}
export function cleanEnterpriseNumbers(text){const lines=String(text??'').split(/\r?\n/),seen=new Set(),out=[];for(const raw of lines){const hits=[...raw.matchAll(/(?:BE\s*)?([01]\D*\d{3}\D*\d{3}\D*\d{3})/gi)];if(!hits.length&&raw.trim())out.push({input:raw.trim(),digits:'',valid:false,duplicate:false,error:'No 10-digit Belgian enterprise number found'});for(const m of hits){const d=digitsOnly(m[1]);const valid=enterpriseValid(d),duplicate=seen.has(d);if(d)seen.add(d);out.push({input:raw.trim(),digits:d,valid,duplicate,kbo:d.length===10?formatEnterprise(d):'',vat:d.length===10?`BE ${formatEnterprise(d)}`:'',error:valid?'': 'Invalid Belgian enterprise-number checksum'});}}return out;}
