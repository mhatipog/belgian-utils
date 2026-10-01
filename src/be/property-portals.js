const OFFICIAL = {
  cadgis:'https://www.minfin.fgov.be/ecad-web/',
  flanders:{
    geo:'https://www.geopunt.be/',
    flood:'https://www.waterinfo.be/',
    soil:'https://www.dov.vlaanderen.be/',
    heritage:'https://inventaris.onroerenderfgoed.be/',
    planning:'https://omgeving.vlaanderen.be/',
  },
  wallonia:{
    geo:'https://geoportail.wallonie.be/walonmap',
    parcel:'https://geoportail.wallonie.be/home/ressources/georeferentiel-de-la-wallonie/parcellaire-cadastral.html',
    flood:'https://geoportail.wallonie.be/',
    soil:'https://geoportail.wallonie.be/',
    heritage:'https://agencewallonnedupatrimoine.be/',
    planning:'https://geoportail.wallonie.be/',
  },
  brussels:{
    geo:'https://gis.urban.brussels/brugis/',
    environment:'https://geodata.environnement.brussels/',
    heritage:'https://monument.heritage.brussels/',
    planning:'https://urban.brussels/',
  },
};

export function propertyResources({region='unknown',lat=null,lon=null,address='',postcode='',municipality=''}={}){
  const r=String(region||'unknown');
  const point=Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))?{lat:Number(lat),lon:Number(lon)}:null;
  const common=[
    {id:'cadgis',label:'Federal CadGIS parcel map',authority:'FPS Finance',url:OFFICIAL.cadgis,kind:'parcel',note:'Authoritative federal cadastral parcel-plan viewer. Use this to confirm parcel boundaries/references.'},
  ];
  if(point) common.push({
    id:'osm-position',label:'Position used by this tool',authority:'OpenStreetMap',kind:'position',
    url:`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=18/${point.lat}/${point.lon}`,
    note:'Convenience map only; this position is not a cadastral determination.',
  });
  const regional=[];
  if(r==='flanders'){
    regional.push(
      {id:'geopunt',label:'Geopunt',authority:'Digitaal Vlaanderen',url:OFFICIAL.flanders.geo,kind:'geo',note:'Official Flemish geoportal for parcels, addresses, planning and many reference layers.'},
      {id:'flood',label:'Flood & water context',authority:'VMM / Waterinfo',url:OFFICIAL.flanders.flood,kind:'risk',note:'Use official flood/water layers for the exact location.'},
      {id:'soil',label:'Soil & subsoil context',authority:'DOV Vlaanderen',url:OFFICIAL.flanders.soil,kind:'soil',note:'Official soil/subsoil datasets and map viewers.'},
      {id:'heritage',label:'Built & landscape heritage',authority:'Agentschap Onroerend Erfgoed',url:OFFICIAL.flanders.heritage,kind:'heritage',note:'Official inventory; an inventory hit is not automatically the same as legal protection.'},
      {id:'planning',label:'Planning / environment',authority:'Departement Omgeving',url:OFFICIAL.flanders.planning,kind:'planning',note:'Official planning and environmental information.'}
    );
  } else if(r==='wallonia'){
    regional.push(
      {id:'walonmap',label:'WalOnMap',authority:'Service public de Wallonie',url:OFFICIAL.wallonia.geo,kind:'geo',note:'Official Walloon geoportal with cadastral and thematic layers.'},
      {id:'parcel-wallonia',label:'Walloon cadastral parcel service',authority:'SPW / FPS Finance data',url:OFFICIAL.wallonia.parcel,kind:'parcel',note:'SPW republishes the cadastral parcel plan as a public map service.'},
      {id:'flood',label:'Flood-risk layers',authority:'Service public de Wallonie',url:OFFICIAL.wallonia.flood,kind:'risk',note:'Open the official geoportal and select flood-hazard/risk layers.'},
      {id:'soil',label:'Soil / environmental layers',authority:'Service public de Wallonie',url:OFFICIAL.wallonia.soil,kind:'soil',note:'Use official Walloon thematic layers for the point.'},
      {id:'heritage',label:'Walloon heritage',authority:'AWaP',url:OFFICIAL.wallonia.heritage,kind:'heritage',note:'Official heritage information.'}
    );
  } else if(r==='brussels'){
    regional.push(
      {id:'brugis',label:'BruGIS',authority:'urban.brussels',url:OFFICIAL.brussels.geo,kind:'geo',note:'Official Brussels urban-planning GIS with parcel/planning context.'},
      {id:'environment',label:'Brussels environmental geo-data',authority:'Brussels Environment',url:OFFICIAL.brussels.environment,kind:'risk',note:'Official environment/noise/soil and related spatial datasets.'},
      {id:'heritage',label:'Brussels heritage inventory',authority:'urban.brussels',url:OFFICIAL.brussels.heritage,kind:'heritage',note:'Official built-heritage inventory.'},
      {id:'planning',label:'Urban planning',authority:'urban.brussels',url:OFFICIAL.brussels.planning,kind:'planning',note:'Official planning information and procedures.'}
    );
  }
  return {
    region:r,address:String(address||''),postcode:String(postcode||''),municipality:String(municipality||''),point,
    resources:[...common,...regional],
    disclaimer:'This explorer brings official portals together. A geocoded point is not an official cadastral parcel identification, soil certificate, flood certificate or planning certificate.',
  };
}
