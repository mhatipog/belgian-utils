// Fictional XBRL instances shaped like NBB annual-account filings. The company
// is made up and concept names are illustrative, not from the real taxonomy.

function instance({ year, equity, capital, reserves, result, debts, assets, turnover, staff, fte }) {
  const y = year;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Fictional sample for gratistools.be - illustrative concepts, not the real NBB taxonomy -->
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
  xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:pfs="http://www.nbb.be/be/fr/pfs/ci/2025-04-01"
  xmlns:pfs-dim="http://www.nbb.be/be/fr/pfs/ci/dim/2025-04-01" xmlns:pfs-gcd="http://www.nbb.be/be/fr/pfs/ci/gcd/2025-04-01">
  <link:schemaRef xlink:type="simple" xlink:href="http://www.nbb.be/be/fr/pfs/ci/2025-04-01/be-gaap-ci-m04-f.xsd"/>
  <xbrli:context id="CurrentDuration">
    <xbrli:entity><xbrli:identifier scheme="http://www.fgov.be">0753124628</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period>
  </xbrli:context>
  <xbrli:context id="CurrentInstant">
    <xbrli:entity><xbrli:identifier scheme="http://www.fgov.be">0753124628</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:instant>${y}-12-31</xbrli:instant></xbrli:period>
  </xbrli:context>
  <xbrli:context id="CurrentDuration_FTE">
    <xbrli:entity><xbrli:identifier scheme="http://www.fgov.be">0753124628</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>${y}-01-01</xbrli:startDate><xbrli:endDate>${y}-12-31</xbrli:endDate></xbrli:period>
    <xbrli:scenario><xbrldi:explicitMember dimension="pfs-dim:WorkingTimeDimension">pfs-dim:FullTimeEquivalentMember</xbrldi:explicitMember></xbrli:scenario>
  </xbrli:context>
  <xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>
  <xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>
  <pfs-gcd:EntityCurrentLegalName contextRef="CurrentDuration">Voorbeeld Software BV</pfs-gcd:EntityCurrentLegalName>
  <pfs-gcd:EntityForm contextRef="CurrentDuration">BV</pfs-gcd:EntityForm>
  <pfs:Equity contextRef="CurrentInstant" unitRef="EUR" decimals="2">${equity}</pfs:Equity>
  <pfs:Capital contextRef="CurrentInstant" unitRef="EUR" decimals="2">${capital}</pfs:Capital>
  <pfs:Reserves contextRef="CurrentInstant" unitRef="EUR" decimals="2">${reserves}</pfs:Reserves>
  <pfs:AccumulatedProfitsLosses contextRef="CurrentInstant" unitRef="EUR" decimals="2">${(equity - capital - reserves).toFixed(2)}</pfs:AccumulatedProfitsLosses>
  <pfs:AmountsPayable contextRef="CurrentInstant" unitRef="EUR" decimals="2">${debts}</pfs:AmountsPayable>
  <pfs:Assets contextRef="CurrentInstant" unitRef="EUR" decimals="2">${assets}</pfs:Assets>
  <pfs:Turnover contextRef="CurrentDuration" unitRef="EUR" decimals="2">${turnover}</pfs:Turnover>
  <pfs:GainLossPeriod contextRef="CurrentDuration" unitRef="EUR" decimals="2">${result}</pfs:GainLossPeriod>
  <pfs:AverageNumberEmployees contextRef="CurrentDuration" unitRef="pure" decimals="1">${staff}</pfs:AverageNumberEmployees>
  <pfs:AverageNumberEmployees contextRef="CurrentDuration_FTE" unitRef="pure" decimals="1">${fte}</pfs:AverageNumberEmployees>
</xbrli:xbrl>
`;
}

export const xbrlCurrent = instance({ year: 2025, equity: 184250, capital: 18600, reserves: 1860, result: 42310.55, debts: 96120.4, assets: 280370.4, turnover: 612400, staff: 4.2, fte: 3.8 });
export const xbrlPrevious = instance({ year: 2024, equity: 141939.45, capital: 18600, reserves: 1860, result: 35120.1, debts: 88010, assets: 229949.45, turnover: 540150, staff: 3.6, fte: 3.2 });
