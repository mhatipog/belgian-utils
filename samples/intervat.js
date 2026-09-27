// Fictional Intervat samples (made-up companies; numbers only pass the checksum).
export const vatReturn = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:VATConsignment xmlns="http://www.minfin.fgov.be/InputCommon" xmlns:ns2="http://www.minfin.fgov.be/VATConsignment" VATDeclarationsNbr="1">
  <ns2:Representative>
    <RepresentativeID identificationType="NVAT" issuedBy="BE">0654321022</RepresentativeID>
    <Name>Voorbeeld Boekhouding BV</Name>
    <EmailAddress>info@example.be</EmailAddress>
  </ns2:Representative>
  <ns2:VATDeclaration SequenceNumber="1" DeclarantReference="VS-2026-08">
    <ns2:Declarant>
      <VATNumber>0753124628</VATNumber>
      <Name>Voorbeeld Software BV</Name>
      <Street>Voorbeeldstraat 1</Street>
      <PostCode>9000</PostCode>
      <City>Gent</City>
      <CountryCode>BE</CountryCode>
      <EmailAddress>boekhouding@example.be</EmailAddress>
      <Phone>090000000</Phone>
    </ns2:Declarant>
    <ns2:Period>
      <ns2:Month>8</ns2:Month>
      <ns2:Year>2026</ns2:Year>
    </ns2:Period>
    <ns2:Data>
      <ns2:Amount GridNumber="01">500.00</ns2:Amount>
      <ns2:Amount GridNumber="03">10000.00</ns2:Amount>
      <ns2:Amount GridNumber="44">2400.00</ns2:Amount>
      <ns2:Amount GridNumber="54">2130.00</ns2:Amount>
      <ns2:Amount GridNumber="55">210.00</ns2:Amount>
      <ns2:Amount GridNumber="59">1155.00</ns2:Amount>
      <ns2:Amount GridNumber="71">1185.00</ns2:Amount>
      <ns2:Amount GridNumber="81">3000.00</ns2:Amount>
      <ns2:Amount GridNumber="82">1500.00</ns2:Amount>
      <ns2:Amount GridNumber="88">1000.00</ns2:Amount>
    </ns2:Data>
    <ns2:ClientListingNihil>NO</ns2:ClientListingNihil>
    <ns2:Ask Restitution="NO" Payment="NO"/>
  </ns2:VATDeclaration>
</ns2:VATConsignment>
`;

export const clientListing = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:ClientListingConsignment xmlns="http://www.minfin.fgov.be/InputCommon" xmlns:ns2="http://www.minfin.fgov.be/ClientListingConsignment" ClientListingsNbr="1">
  <ns2:ClientListing SequenceNumber="1" ClientsNbr="3" DeclarantReference="LIST-2025" TurnOverSum="48250.00" VATAmountSum="10132.50">
    <ns2:Declarant>
      <VATNumber>0753124628</VATNumber>
      <Name>Voorbeeld Software BV</Name>
      <Street>Voorbeeldstraat 1</Street>
      <PostCode>9000</PostCode>
      <City>Gent</City>
      <CountryCode>BE</CountryCode>
    </ns2:Declarant>
    <ns2:Period>2025</ns2:Period>
    <ns2:Client SequenceNumber="1">
      <ns2:CompanyVATNumber issuedBy="BE">0864213778</ns2:CompanyVATNumber>
      <ns2:TurnOver>30000.00</ns2:TurnOver>
      <ns2:VATAmount>6300.00</ns2:VATAmount>
    </ns2:Client>
    <ns2:Client SequenceNumber="2">
      <ns2:CompanyVATNumber issuedBy="BE">0451234595</ns2:CompanyVATNumber>
      <ns2:TurnOver>18000.00</ns2:TurnOver>
      <ns2:VATAmount>3780.00</ns2:VATAmount>
    </ns2:Client>
    <ns2:Client SequenceNumber="3">
      <ns2:CompanyVATNumber issuedBy="BE">0812345603</ns2:CompanyVATNumber>
      <ns2:TurnOver>250.00</ns2:TurnOver>
      <ns2:VATAmount>52.50</ns2:VATAmount>
    </ns2:Client>
  </ns2:ClientListing>
</ns2:ClientListingConsignment>
`;

export const intraListing = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:IntraConsignment xmlns="http://www.minfin.fgov.be/InputCommon" xmlns:ns2="http://www.minfin.fgov.be/IntraConsignment" IntraListingsNbr="1">
  <ns2:IntraListing SequenceNumber="1" ClientsNbr="2" DeclarantReference="IC-2026-Q3" AmountSum="5400.00">
    <ns2:Declarant>
      <VATNumber>0753124628</VATNumber>
      <Name>Voorbeeld Software BV</Name>
      <CountryCode>BE</CountryCode>
    </ns2:Declarant>
    <ns2:Period>
      <ns2:Quarter>3</ns2:Quarter>
      <ns2:Year>2026</ns2:Year>
    </ns2:Period>
    <ns2:IntraClient SequenceNumber="1">
      <ns2:CompanyVATNumber issuedBy="NL">999999999B01</ns2:CompanyVATNumber>
      <ns2:Code>S</ns2:Code>
      <ns2:Amount>2400.00</ns2:Amount>
    </ns2:IntraClient>
    <ns2:IntraClient SequenceNumber="2">
      <ns2:CompanyVATNumber issuedBy="DE">999999999</ns2:CompanyVATNumber>
      <ns2:Code>L</ns2:Code>
      <ns2:Amount>3000.00</ns2:Amount>
    </ns2:IntraClient>
  </ns2:IntraListing>
</ns2:IntraConsignment>
`;
