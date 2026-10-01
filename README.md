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
- Local PDF page composition: reorder/delete pages, insert pages from another PDF, rotate pages, and add JPG/PNG images as PDF pages\n- Belgian notice-period, indexation, rent, company-car VAA and mobility-budget calculators\n- Belgian VAT-grid reference and enterprise-number batch cleaning\n- 2025 municipality-merger/NIS mappings and 2026–27 school holiday calendars\n- Belgian statutory/commercial interest history and working-day calculations\n- Local XLSX reader + one-to-many NACE-BEL 2008→2025 migration mapping
- Weighted decision matrices with cost/benefit normalization, dominance detection and weight sensitivity analysis
- Reproducible simple, systematic and stratified sampling, including finite-population sample-size planning
- Consensus ranking with Schulze strongest paths, Borda, Copeland, Condorcet checks and pairwise matrices
- Availability interval merging and duration-aware maximum-attendance meeting-window optimization
- ISO 20022 `pain.001.001.09` SEPA payment batch generation and local validation
- Explainable UBL invoice ↔ CODA/CAMT transaction reconciliation
- Peppol/UBL invoice batch auditing for validation counts, duplicates, VAT totals and overdue invoices

## PDF page editing

The reusable engine behind the PDF page editor is exported as `composePdfPages`. It works entirely on bytes and has no network access:

```js
import { composePdfPages, inspectPdfPages } from './src/index.js';

const info = await inspectPdfPages(mainPdf);
const edited = await composePdfPages({
  sources: {
    main: { type: 'pdf', bytes: mainPdf },
    extra: { type: 'pdf', bytes: extraPdf },
    photo: { type: 'jpeg', bytes: jpegBytes },
  },
  pages: [
    { source: 'main', page: 2 },
    { source: 'photo', pageSize: 'a4', margin: 24 },
    { source: 'extra', page: 1 },
    { source: 'main', page: 1, rotate: 90 },
  ],
});
```

The order of `pages` is the output order. Omitting an original page deletes it. Repeating a page duplicates it. JPG and PNG images can become natural-size pages or be fitted onto A4/custom page sizes. The hosted gratistools.be UI adds previews, drag-and-drop and broader image-format conversion around this core.

## Analysis and planning engines

The analysis engines are UI-independent and operate on ordinary JavaScript arrays and objects. Seeded sampling is deterministic for audit/reproduction; unseeded sampling uses browser cryptographic randomness where available. Availability functions work on timestamps, while the text parser can interpret local browser time (including daylight-saving rules) or a fixed offset.

```js
import {
  analyzeDecisionMatrix,
  stratifiedSample,
  parseBallots,
  consensusRank,
  bestMeetingWindows,
} from './src/index.js';
```

The decision matrix exposes normalized scores, dominated alternatives and winner stability bands instead of only a final score. Consensus ranking returns the complete pairwise matrix so cycles and method differences stay inspectable.

## Finance workflow engines

The finance engines are ordinary JavaScript functions with no network access:

```js
import {
  buildPain001,
  reconcileInvoices,
  auditInvoices,
} from './src/index.js';
```

`buildPain001()` creates ISO 20022 `pain.001.001.09` XML and validates the most important batch inputs such as IBANs, amounts, references and duplicate end-to-end IDs. Bank-specific upload profiles can add stricter rules, so production payment files should still be tested with the target bank.

`reconcileInvoices()` scores sales invoices against incoming bank transactions using explainable signals: payment reference, exact amount, invoice number, customer name and date proximity. It returns matched, probable/review, unmatched and duplicate-looking records instead of hiding the matching rationale.

`auditInvoices()` operates on normalized UBL invoice models and their validation issues. It reports duplicate invoice identities/fingerprints, validation counts, VAT totals, overdue items and supplier/customer aggregates.

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
