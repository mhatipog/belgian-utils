const FLANDERS = new Set(['Antwerpen','West-Vlaanderen','Oost-Vlaanderen','Vlaams-Brabant','Limburg']);
const WALLONIA = new Set(['Waals-Brabant','Henegouwen','Luik','Luxemburg','Namen']);

export function regionFromPlace(place={}) {
  const province=String(place.province_nl||place.province||'');
  if(province==='Brussel') return 'brussels';
  if(FLANDERS.has(province)) return 'flanders';
  if(WALLONIA.has(province)) return 'wallonia';
  const pc=Number(place.postcode);
  if(pc>=1000&&pc<=1299) return 'brussels';
  return 'unknown';
}

export function authorityProfile(place={}) {
  const region=regionFromPlace(place);
  const base={
    postcode:String(place.postcode||''),
    place:place.place||'',
    municipality:place.municipality||'',
    nis:String(place.nis||'').split(',')[0].trim(),
    province:place.province_nl||place.province||'',
    region,
  };
  const regionName={flanders:'Flanders',wallonia:'Wallonia',brussels:'Brussels-Capital Region',unknown:'Unknown'}[region];
  const exact=[
    {kind:'municipality',label:'Municipality / civil registry',value:base.municipality,confidence:'exact',note:'Population, civil status, local permits and many local services start with the municipality.'},
    {kind:'nis',label:'NIS code',value:base.nis,confidence:'exact',note:'Official municipality identifier from the Belgian place dataset.'},
    {kind:'region',label:'Region',value:regionName,confidence:'exact',note:''},
    ...(base.province&&region!=='brussels'?[{kind:'province',label:'Province',value:base.province,confidence:'exact',note:''}]:[]),
  ];
  const services=[];
  if(region==='flanders'){
    services.push(
      {kind:'energy',label:'Electricity & gas network',value:'Fluvius',confidence:'regional',url:'https://www.fluvius.be/',note:'Fluvius is the distribution network operator in Flanders; connection details can still depend on the address.'},
      {kind:'water',label:'Water supplier / sewer operator',value:'Official locator',confidence:'locator',url:'https://www.aquaflanders.be/',note:'Supplier can differ by municipality and sometimes by street.'},
      {kind:'police',label:'Local police zone',value:'Official Police locator',confidence:'locator',url:'https://www.police.be/',note:'Police zones often cover several municipalities.'},
      {kind:'fire',label:'Fire & rescue zone',value:'Civil Security zone overview',confidence:'locator',url:'https://securitecivile.be/',note:'Belgium is divided into rescue zones; use the official zone information for the municipality.'},
      {kind:'waste',label:'Household waste',value:'Municipality / intermunicipal operator',confidence:'municipal',url:'https://www.vlaanderen.be/afval',note:'Waste collection is organized locally and can be delegated to an intermunicipal operator.'}
    );
  } else if(region==='brussels'){
    services.push(
      {kind:'energy',label:'Electricity & gas network',value:'Sibelga',confidence:'regional',url:'https://www.sibelga.be/',note:'Sibelga manages the electricity and gas distribution networks in the Brussels-Capital Region.'},
      {kind:'water',label:'Drinking water',value:'VIVAQUA',confidence:'regional',url:'https://www.vivaqua.be/',note:'VIVAQUA is the main drinking-water operator in Brussels.'},
      {kind:'police',label:'Local police zone',value:'Official Police locator',confidence:'locator',url:'https://www.police.be/',note:'Brussels municipalities are divided among six local police zones.'},
      {kind:'fire',label:'Fire & emergency medical service',value:'Brussels Fire Brigade / SIAMU',confidence:'regional',url:'https://pompiers.brussels/',note:''},
      {kind:'waste',label:'Household waste',value:'Bruxelles-Propreté / Net Brussel',confidence:'regional',url:'https://www.arp-gan.be/',note:''}
    );
  } else if(region==='wallonia'){
    services.push(
      {kind:'energy',label:'Electricity & gas network',value:'CWaPE official DSO locator',confidence:'locator',url:'https://www.cwape.be/',note:'The distribution network operator varies by municipality/postcode.'},
      {kind:'water',label:'Drinking-water distributor',value:'SPW official distributor information',confidence:'locator',url:'https://environnement.wallonie.be/home/milieux/eau/eau-de-distribution.html',note:'Wallonia has several public/intermunicipal water distributors.'},
      {kind:'police',label:'Local police zone',value:'Official Police locator',confidence:'locator',url:'https://www.police.be/',note:'Police zones can cover several municipalities.'},
      {kind:'fire',label:'Fire & rescue zone',value:'Civil Security zone overview',confidence:'locator',url:'https://securitecivile.be/',note:'Use the official rescue-zone information for the municipality.'},
      {kind:'waste',label:'Household waste',value:'Municipality / intermunicipal operator',confidence:'municipal',url:'https://www.wallonie.be/fr/demarches',note:'Waste collection is organized locally and can be delegated to an intermunicipal operator.'}
    );
  }
  return {...base,exact,services};
}

export function findPlacesByPostcode(data, postcode){
  const pc=String(postcode||'').trim();
  const rows=data?.places||[];
  return rows.filter((r)=>String(r?.[0]||'')===pc).map((r)=>({
    postcode:r[0],place:r[1],municipality:r[2],nis:r[3],province_nl:r[4],province_fr:r[5],
  }));
}
