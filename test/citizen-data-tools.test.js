import test from 'node:test';
import assert from 'node:assert/strict';

import { compareBelgianLez } from '../src/be/lez.js';
import { regionFromPlace, authorityProfile, findPlacesByPostcode } from '../src/be/address-authorities.js';
import { propertyResources } from '../src/be/property-portals.js';

test('LEZ comparison reflects 2026 Brussels vs Flemish thresholds', () => {
  const diesel5=compareBelgianLez({fuel:'diesel',euro:5,countryCode:'BE',category:'M1'});
  assert.equal(diesel5.zones.find((z)=>z.id==='brussels').status,'daypass');
  assert.equal(diesel5.zones.find((z)=>z.id==='antwerp').status,'allowed');
  assert.equal(diesel5.zones.find((z)=>z.id==='ghent').status,'allowed');

  const petrol2=compareBelgianLez({fuel:'petrol',euro:2,countryCode:'BE',category:'M1'});
  assert.equal(petrol2.zones.find((z)=>z.id==='brussels').status,'daypass');
  assert.equal(petrol2.zones.find((z)=>z.id==='antwerp').status,'allowed');
});

test('Dutch registration exceptions are surfaced correctly', () => {
  const compliant=compareBelgianLez({fuel:'diesel',euro:6,countryCode:'NL'});
  assert.equal(compliant.zones.find((z)=>z.id==='antwerp').registrationRequired,false);
  assert.equal(compliant.zones.find((z)=>z.id==='ghent').registrationRequired,false);
  assert.equal(compliant.zones.find((z)=>z.id==='brussels').registrationRequired,false);

  const brusselsNonCompliant=compareBelgianLez({fuel:'diesel',euro:5,countryCode:'NL'});
  assert.equal(brusselsNonCompliant.zones.find((z)=>z.id==='brussels').registrationRequired,true);
});

test('authority resolver derives Belgian region from official place rows', () => {
  const zottegem={postcode:'9620',place:'Zottegem',municipality:'Zottegem',nis:'41081',province_nl:'Oost-Vlaanderen'};
  const brussels={postcode:'1000',place:'Brussel',municipality:'Brussel',nis:'21004',province_nl:'Brussel'};
  const liege={postcode:'4000',place:'Liège',municipality:'Liège',nis:'62063',province_nl:'Luik'};
  assert.equal(regionFromPlace(zottegem),'flanders');
  assert.equal(regionFromPlace(brussels),'brussels');
  assert.equal(regionFromPlace(liege),'wallonia');
  assert.equal(authorityProfile(zottegem).services.find((s)=>s.kind==='energy').value,'Fluvius');
  assert.equal(authorityProfile(brussels).services.find((s)=>s.kind==='energy').value,'Sibelga');
});

test('postcode search preserves multiple localities without inventing one', () => {
  const data={places:[['1300','Limal','Wavre','25112','Waals-Brabant','Brabant Wallon'],['1300','Wavre','Wavre','25112','Waals-Brabant','Brabant Wallon']]};
  const hit=findPlacesByPostcode(data,'1300');
  assert.equal(hit.length,2);
  assert.equal(hit[0].municipality,'Wavre');
});

test('property resource engine selects region-specific official portals', () => {
  const fl=propertyResources({region:'flanders',lat:50.87,lon:3.81,address:'Zottegem'});
  assert.ok(fl.resources.some((r)=>r.id==='cadgis'));
  assert.ok(fl.resources.some((r)=>r.id==='geopunt'));
  assert.ok(fl.resources.some((r)=>r.id==='flood'));
  assert.ok(fl.resources.some((r)=>r.id==='osm-position'));
  assert.match(fl.disclaimer,/not an official cadastral/i);

  const wa=propertyResources({region:'wallonia'});
  assert.ok(wa.resources.some((r)=>r.id==='walonmap'));
  assert.ok(wa.resources.some((r)=>r.id==='parcel-wallonia'));
});
