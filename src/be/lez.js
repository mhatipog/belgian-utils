export const LEZ_RULES_AS_OF = '2026-10-01';

const fuelGroup = (fuel) => {
  const f=String(fuel||'').toLowerCase();
  if(/electric|elektr|élect|hydrogen|waterstof|hydrog/.test(f)) return 'zero';
  if(/diesel/.test(f)) return 'diesel';
  if(/petrol|benz|essence|gasoline|lpg|cng|lng|aardgas|gaz/.test(f)) return 'petrol';
  return 'other';
};

const country = (v) => String(v||'BE').trim().toUpperCase();

function zone(id,name,official,check,fuel,euro,countryCode){
  const foreign=countryCode!=='BE';
  let status='check';
  let label='Use the official checker';
  let detail='This combination is not encoded safely enough for an automatic verdict.';
  const g=fuelGroup(fuel);
  const e=Number(euro);
  if(g==='zero'){
    status='allowed'; label='Allowed'; detail='Zero-emission vehicles are not restricted by the encoded emissions threshold.';
  } else if(g==='diesel' && Number.isFinite(e)){
    if(id==='brussels'){
      if(e>=6){status='allowed';label='Allowed';detail='Diesel Euro 6 or higher meets the 2026 Brussels threshold.';}
      else {status='daypass';label='Not automatically allowed';detail='Diesel Euro 5 and lower do not meet the 2026 Brussels access threshold; a day pass or exemption may apply.';}
    } else {
      if(e>=5){status='allowed';label='Allowed';detail='Diesel Euro 5 or higher has automatic access under the current Flemish LEZ threshold.';}
      else if(e===4){status='paid';label='Paid access / day pass';detail='Diesel Euro 4 has no automatic access; paid access or a day pass depends on the city/vehicle situation.';}
      else {status='daypass';label='No automatic access';detail='Older diesel vehicles require a day pass or a specific exemption/authorisation where available.';}
    }
  } else if(g==='petrol' && Number.isFinite(e)){
    if(id==='brussels'){
      if(e>=3){status='allowed';label='Allowed';detail='Petrol/LPG/CNG Euro 3 or higher meets the 2026 Brussels threshold.';}
      else {status='daypass';label='Not automatically allowed';detail='Euro 2 petrol vehicles and lower do not meet the 2026 Brussels threshold; a day pass or exemption may apply.';}
    } else {
      if(e>=2){status='allowed';label='Allowed';detail='Petrol/LPG/CNG Euro 2 or higher has automatic access under the current Flemish LEZ threshold.';}
      else {status='daypass';label='No automatic access';detail='Euro 1 or older petrol/LPG/CNG vehicles need a day pass or specific exemption where available.';}
    }
  }
  let registrationRequired=false;
  let registrationNote='';
  if(foreign){
    if(countryCode==='NL'){
      if(id==='brussels' && status!=='allowed'){
        registrationRequired=true;
        registrationNote='A compliant Dutch vehicle is read via Dutch vehicle data. For a non-compliant Dutch vehicle, Brussels requires registration before a day pass or exemption can be arranged.';
      } else {
        registrationNote=id==='brussels'
          ? 'A compliant Dutch vehicle does not need separate Brussels registration.'
          : 'Compliant Dutch vehicles are read automatically through RDW data and do not need separate registration.';
      }
    } else {
      registrationRequired=true;
      registrationNote='A foreign number plate must be registered with this LEZ even when the vehicle meets the emissions threshold.';
    }
  }
  return {id,name,official,check,status,label,detail,registrationRequired,registrationNote};
}

export function compareBelgianLez({fuel,euro,countryCode='BE',category='M1'}={}){
  const c=country(countryCode);
  const cat=String(category||'M1').toUpperCase();
  const scopeOk=['M1','N1'].includes(cat);
  const zones=[
    zone('brussels','Brussels LEZ','https://lez.brussels/','https://lez.brussels/mytax/en/practical?tab=ZoneLEZ',fuel,euro,c),
    zone('antwerp','Antwerp LEZ','https://www.slimnaarantwerpen.be/nl/lez','https://www.slimnaarantwerpen.be/nl/lez/check-uw-voertuig',fuel,euro,c),
    zone('ghent','Ghent LEZ','https://stad.gent/nl/mobiliteit-openbare-werken/lage-emissiezone','https://stad.gent/nl/mobiliteit-openbare-werken/lage-emissiezone',fuel,euro,c),
  ];
  return {
    asOf:LEZ_RULES_AS_OF,
    input:{fuel:fuelGroup(fuel),euro:Number(euro),countryCode:c,category:cat},
    scopeOk,
    scopeNote:scopeOk?'Rules are compared for ordinary passenger cars/light vans (M1/N1).':'For this vehicle category, use each city’s official checker; category-specific rules can differ.',
    zones,
  };
}
