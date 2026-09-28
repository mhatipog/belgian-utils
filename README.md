# belgian-utils

Open source JavaScript utilities behind gratistools.be, focused on Belgian business formats and privacy-first local file processing.

This package contains the reusable local processing logic behind parts of [gratistools.be](https://gratistools.be/). The website itself, account features, analytics, deployment configuration and operational code are intentionally not part of this repository.

## Included

- Belgian enterprise and VAT number validation
- Belgian IBAN, bank code and BIC helpers
- OGM and RF payment reference helpers
- Belgian national number parsing
- Peppol participant ID parsing
- CODA parsing and anonymisation
- CAMT parsing
- UBL invoice reading and anonymisation
- Peppol BIS validation helpers
- Intervat parsing
- Belgian XBRL parsing and comparison
- Belgian file format detection
- Identifier scanning
- EPC payment QR payload generation
- Lambert 72 and Lambert 2008 conversion
- Shared safe XML and CSV helpers
- Local metadata inspection and privacy cleaning for JPEG, PNG, WebP, DOCX, XLSX and PPTX

## Privacy

The utilities in this repository are designed for local processing. They do not upload files or send data anywhere by themselves.

The hosted website at [gratistools.be](https://gratistools.be/) also offers a small number of explicitly marked online lookups. Those network features are separate from this package.

## Test

```bash
npm test
```

## Example

```js
import { parseEnterprise, parseIban, parseOgm } from './src/index.js';

console.log(parseEnterprise('BE 0753.124.628'));
console.log(parseIban('BE73 7350 1234 5660'));
console.log(parseOgm('+++202/6000/12320+++'));
```

## Scope

This is a Belgian utility library, not a complete application and not an official government package.

Formats and rules can change. Consumers should verify critical financial, tax or regulatory use against the relevant official source.

## Website

A browser-based interface for these and many other tools is available at [gratistools.be](https://gratistools.be/).

## License

MIT
