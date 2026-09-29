const DAY=86400000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round2=x=>Math.round((x+Number.EPSILON)*100)/100;
const isoDate=d=>new Date(d).toISOString().slice(0,10);
function date(v,label='date'){const d=v instanceof Date?new Date(v):new Date(`${v}T00:00:00Z`);if(Number.isNaN(d.getTime()))throw new Error(`Invalid ${label}.`);return d;}
function monthsBetween(start,end){const a=date(start),b=date(end);if(b<a)throw new Error('End date cannot be before start date.');let m=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();if(b.getUTCDate()<a.getUTCDate())m--;return Math.max(0,m);}

const DISMISS_OLD=[[3,1],[4,3],[5,4],[6,5],[9,6],[12,7],[15,8],[18,9],[21,10],[24,11],[36,12],[48,13],[60,15],[72,18],[84,21],[96,24],[108,27],[120,30],[132,33],[144,36],[156,39],[168,42],[180,45],[192,48],[204,51],[216,54],[228,57],[240,60],[252,62],[264,63],[276,64],[288,65]];
const RESIGN_OLD=[[3,1],[6,2],[12,3],[18,4],[24,5],[48,6],[60,7],[72,9],[84,10],[96,12],[Infinity,13]];
const RESIGN_NEW=[[6,1],[12,3],[18,4],[24,5],[48,6],[60,7],[72,9],[84,10],[96,12],[Infinity,13]];
function tableWeeks(months,table){for(const [lt,w] of table)if(months<lt)return w;return table.at(-1)[1];}
export function noticePeriodBelgium({contractStart,noticeStart,initiator='employer'}={}){
  const cs=date(contractStart,'contract start'), ns=date(noticeStart,'notice start');
  if(cs>=ns)throw new Error('Notice start must be after the contract start.');
  if(cs<new Date('2014-01-01T00:00:00Z'))return {supported:false,reason:'Contracts started before 1 January 2014 use transitional two-part rules and need a separate calculation.'};
  const months=monthsBetween(cs,ns);
  let weeks,regime;
  if(initiator==='employee'){
    const newer=cs>=new Date('2026-08-01T00:00:00Z');
    weeks=tableWeeks(months,newer?RESIGN_NEW:RESIGN_OLD); regime=newer?'employee resignation · contract started from 1 Aug 2026':'employee resignation · contract started before 1 Aug 2026';
  } else if(initiator==='employer'){
    if(cs>=new Date('2026-08-01T00:00:00Z')){
      if(months<6) weeks=1; else weeks=tableWeeks(months,DISMISS_OLD);
      weeks=Math.min(52,weeks); regime='employer dismissal · contract started from 1 Aug 2026';
    } else if(cs>=new Date('2026-06-01T00:00:00Z')){
      weeks=Math.min(52,tableWeeks(months,DISMISS_OLD)); regime='employer dismissal · contract started 1 Jun–31 Jul 2026';
    } else {
      weeks=tableWeeks(months,DISMISS_OLD);
      if(months>=288)weeks=65+Math.floor((months-276)/12);
      regime='employer dismissal · contract started 1 Jan 2014–31 May 2026';
    }
  } else throw new Error('initiator must be employer or employee');
  return {supported:true,weeks,months,years:Math.floor(months/12),remainingMonths:months%12,regime};
}

export function indexAmount({amount,oldIndex,newIndex}={}){const a=+amount,o=+oldIndex,n=+newIndex;if(!(a>=0)||!(o>0)||!(n>0))throw new Error('Amount must be non-negative and both indices must be positive.');const factor=n/o,indexed=a*factor;return {amount:a,oldIndex:o,newIndex:n,factor,indexed:round2(indexed),difference:round2(indexed-a),percent:(factor-1)*100};}
export function rentIndexationBelgium(opts={}){return {...indexAmount(opts),formula:'base rent × new health index ÷ initial health index'};}

export const CAR_BENEFIT_2026={year:2026,reference:{petrol:70,lpg:70,natural_gas:70,diesel:58,electric:0},minimum:1690};
export function companyCarBenefitBelgium({catalogValue,co2=0,fuel='petrol',firstRegistration,benefitDate='2026-01-01',annualContribution=0}={}){
  const value=+catalogValue,c=+co2,contrib=+annualContribution;if(!(value>0)||!(c>=0)||!(contrib>=0))throw new Error('Enter a positive catalog value and non-negative CO₂/contribution values.');
  const months=monthsBetween(firstRegistration,benefitDate), completedYears=Math.floor(months/12),ageFactor=Math.max(.70,1-.06*Math.min(5,completedYears));
  let co2Percentage;
  if(fuel==='electric')co2Percentage=.04;else {const ref=fuel==='diesel'?58:70;co2Percentage=clamp(.055+.001*(c-ref),.04,.18);}
  const raw=value*(6/7)*ageFactor*co2Percentage, statutory=Math.max(CAR_BENEFIT_2026.minimum,raw), taxable=Math.max(0,statutory-contrib);
  return {year:2026,catalogValue:value,co2:c,fuel,ageMonths:months,ageFactor,co2Percentage,rawAnnual:round2(raw),statutoryAnnual:round2(statutory),annualContribution:contrib,taxableAnnual:round2(taxable),taxableMonthly:round2(taxable/12),minimumApplied:raw<CAR_BENEFIT_2026.minimum};
}

export const MOBILITY_BUDGET_2026={minimum:3233,absoluteMaximum:17244,pillar3Contribution:.3807};
export function mobilityBudgetSplit({budget,grossAnnual,pillar1=0,pillar2=0}={}){const b=+budget,g=+grossAnnual,p1=+pillar1,p2=+pillar2;if(!(b>=0)||!(g>0)||p1<0||p2<0)throw new Error('Enter a non-negative budget/spend and a positive annual gross salary.');if(p1+p2>b)throw new Error('Pillar 1 + pillar 2 exceeds the mobility budget.');const legalMax=Math.min(MOBILITY_BUDGET_2026.absoluteMaximum,g*.20),balance=b-p1-p2,contribution=balance*MOBILITY_BUDGET_2026.pillar3Contribution;return {budget:b,grossAnnual:g,legalMinimum:MOBILITY_BUDGET_2026.minimum,legalMaximum:round2(legalMax),withinRange:b>=MOBILITY_BUDGET_2026.minimum&&b<=legalMax,pillar1:p1,pillar2:p2,pillar3Gross:round2(balance),pillar3Contribution:round2(contribution),pillar3Net:round2(balance-contribution)};}
