// Deterministic metadata interpretation. No network access and no AI inference.
const KNOWLEDGE = {
  'identity:author': ['Declared document author', 'May expose the person or account stored by the source application.'],
  'document:creator': ['Declared document author', 'May expose the person or account stored by the source application.'],
  'document:lastModifiedBy': ['Last recorded editor', 'Office stores the account or user name of the last editor here.'],
  'software:creator': ['Source application', 'Usually identifies the application that created the source document before PDF generation.'],
  'software:producer': ['PDF producer', 'Usually identifies the software that wrote or converted the PDF file.'],
  'software:software': ['Processing software', 'Identifies software that wrote or edited image metadata.'],
  'application:Application': ['Office application', 'Identifies the application or library that wrote the Office package.'],
  'application:AppVersion': ['Application version', 'Version metadata from the application that wrote the Office package.'],
  'application:Company': ['Office company property', 'May reveal an employer or organisation configured in Office.'],
  'application:Manager': ['Office manager property', 'May expose an internal person configured in Office.'],
  'application:TotalTime': ['Recorded editing time', 'Office-maintained edit duration. It can be reset or rewritten and is not a verified activity log.'],
  'dates:created': ['Embedded creation timestamp', 'A timestamp stored inside the file. It can be copied, rewritten or generated automatically.'],
  'document:created': ['Embedded creation timestamp', 'A timestamp stored inside the Office package. It can be copied, rewritten or generated automatically.'],
  'dates:modified': ['Embedded modification timestamp', 'The file reports this as its last metadata modification time; it is not independently verified.'],
  'document:modified': ['Embedded modification timestamp', 'The Office package reports this modification time; it is not independently verified.'],
  'device:make': ['Camera/device manufacturer', 'Can reveal the hardware family used to capture an image.'],
  'device:model': ['Camera/device model', 'Can reveal the exact phone or camera model used to capture an image.'],
  'location:gps': ['Capture location', 'Embedded GPS coordinates can reveal where a photo was taken.'],
  'document:pages': ['Page count', 'Structural document information, normally not privacy-sensitive.'],
  'document:title': ['Embedded title', 'May expose a template name, project, customer or internal naming convention.'],
  'document:keywords': ['Embedded keywords', 'May expose topics, project names or internal classification terms.'],
  'custom:*': ['Custom Office property', 'Organisation-specific metadata can contain project IDs, customer names, classifications or workflow values.'],
};

const norm = (s) => String(s ?? '').trim();
const lower = (s) => norm(s).toLowerCase();
const find = (fields, key, group) => fields.find((f) => lower(f.key) === lower(key) && (!group || lower(f.group) === lower(group)));
const values = (fields, key) => fields.filter((f) => lower(f.key) === lower(key)).map((f) => norm(f.value)).filter(Boolean);
const evidence = (...xs) => xs.filter(Boolean).map((x) => typeof x === 'string' ? x : `${x.label}: ${x.value}`);

function knowledgeFor(field) {
  const exact = KNOWLEDGE[`${field.group}:${field.key}`];
  const wildcard = KNOWLEDGE[`${field.group}:*`];
  const [meaning, interpretation] = exact || wildcard || ['Embedded metadata field', 'This value is stored in the file metadata and may reveal information about its origin or workflow.'];
  return { ...field, meaning, interpretation };
}

function softwareKind(value) {
  const v = lower(value);
  if (!v) return null;
  const rules = [
    [/openpyxl/, ['Python/openpyxl', 'Programmatic spreadsheet generation or rewriting with the Python openpyxl library.']],
    [/xlsxwriter/, ['Python/XlsxWriter', 'Programmatic spreadsheet generation with the Python XlsxWriter library.']],
    [/pandas/, ['Python/pandas', 'Programmatic data export, commonly via Python pandas.']],
    [/apache poi/, ['Java/Apache POI', 'Programmatic Office document processing with the Java Apache POI library.']],
    [/epplus/, ['.NET/EPPlus', 'Programmatic Excel processing with the .NET EPPlus library.']],
    [/aspose\.words/, ['Aspose.Words', 'Automated Word/PDF processing using Aspose.Words, commonly in .NET or Java backends.']],
    [/aspose\.cells/, ['Aspose.Cells', 'Automated spreadsheet processing using Aspose.Cells.']],
    [/reportlab/, ['ReportLab', 'Programmatic PDF generation, commonly from Python.']],
    [/itext/, ['iText', 'Programmatic PDF generation or manipulation using iText.']],
    [/pdfbox/, ['Apache PDFBox', 'Programmatic PDF generation or manipulation using Apache PDFBox.']],
    [/wkhtmltopdf/, ['wkhtmltopdf', 'HTML-to-PDF generation using wkhtmltopdf.']],
    [/chrom(e|ium)/, ['Chromium', 'Browser-based or HTML-to-PDF generation using a Chromium engine.']],
    [/libreoffice/, ['LibreOffice', 'Document creation, editing or headless conversion through LibreOffice.']],
    [/microsoft.*word|word for microsoft 365/, ['Microsoft Word', 'Word-based document creation or PDF export.']],
    [/microsoft.*excel|excel/, ['Microsoft Excel', 'Excel-based workbook creation or editing.']],
    [/photoshop/, ['Adobe Photoshop', 'Image editing or export through Adobe Photoshop.']],
    [/lightroom/, ['Adobe Lightroom', 'Photo management or post-processing through Adobe Lightroom.']],
    [/adobe.*pdf|acrobat|distiller/, ['Adobe PDF tools', 'PDF creation or processing through Adobe software.']],
  ];
  for (const [re, hit] of rules) if (re.test(v)) return hit;
  return null;
}

function daysBetween(a, b) {
  const x = Date.parse(a), y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round((y - x) / 86400000);
}

export function interpretMetadata(report) {
  const fields = (report.fields || []).map(knowledgeFor);
  const insights = [];
  const add = (title, detail, confidence = 'likely', privacy = 'info', ev = []) =>
    insights.push({ title, detail, confidence, privacy, evidence: ev });

  const author = find(fields, 'author') || find(fields, 'creator', 'document');
  const lastEditor = find(fields, 'lastModifiedBy');
  const title = find(fields, 'title');
  const creator = find(fields, 'creator', 'software');
  const producer = find(fields, 'producer', 'software');
  const app = find(fields, 'Application');
  const created = find(fields, 'created');
  const modified = find(fields, 'modified');
  const gps = find(fields, 'gps');

  const authorV = lower(author?.value), appV = lower(app?.value), creatorV = lower(creator?.value), producerV = lower(producer?.value);

  if ((authorV === 'openpyxl' || appV.includes('openpyxl')) && (authorV === 'openpyxl' || appV.includes('openpyxl'))) {
    add('Likely generated programmatically', 'The workbook identifies openpyxl in its author/application metadata. This is strong evidence that Python/openpyxl created or rewrote the workbook.', 'high', 'personal', evidence(author, app));
  }

  if (creatorV.includes('word') && /aspose\.words/i.test(producer?.value || '')) {
    add('Automated Word-to-PDF pipeline likely', 'The source application is Microsoft Word while the PDF producer is Aspose.Words. This is consistent with a Word-originated document being processed by an automated Aspose conversion workflow.', 'high', 'personal', evidence(creator, producer));
  }

  if (creatorV.includes('word') && producerV.includes('word') && /template/i.test(title?.value || '')) {
    add('Reusable Word template likely', 'The embedded title refers to a template and Microsoft Word both created and produced the PDF. This is consistent with a reusable Word template being populated and exported.', 'high', 'info', evidence(title, creator, producer));
  } else if (/template/i.test(title?.value || '') && (creatorV.includes('word') || appV.includes('word'))) {
    add('Template-based workflow likely', 'The embedded title names a template and the document identifies Word as its application.', 'likely', 'info', evidence(title, creator || app));
  }

  if (author && !/^(openpyxl|unknown|anonymous)$/i.test(author.value)) {
    add('Named author exposed', `The file embeds "${author.value}" as its author. Recipients can inspect this even when the name is not visible in the document content.`, 'high', 'high', evidence(author));
  }

  if (lastEditor && author && lower(lastEditor.value) !== lower(author.value)) {
    add('Different author and last editor', 'The recorded author and last editor differ, suggesting the file passed through at least two recorded user identities. This does not prove who changed the content.', 'high', 'high', evidence(author, lastEditor));
  }

  if (gps) add('Precise location exposed', 'The file contains GPS coordinates that can reveal where the image was captured.', 'high', 'high', evidence(gps));

  const sw = [app, creator, producer, find(fields, 'software')].filter(Boolean);
  const seen = new Set();
  for (const s of sw) {
    const hit = softwareKind(s.value);
    if (hit && !seen.has(hit[0])) {
      seen.add(hit[0]);
      add(`Software fingerprint: ${hit[0]}`, hit[1], 'high', 'personal', evidence(s));
    }
  }

  const gap = created && modified ? daysBetween(created.value, modified.value) : null;
  if (gap !== null && gap >= 0) {
    add('Embedded document timeline', gap === 0 ? 'Creation and modification timestamps are the same day.' : `The embedded modification timestamp is about ${gap} day${gap === 1 ? '' : 's'} after the creation timestamp. These are file metadata timestamps, not a verified activity log.`, 'high', 'personal', evidence(created, modified));
  } else if (gap !== null && gap < 0) {
    add('Timestamp inconsistency', 'The embedded modification timestamp is earlier than the creation timestamp. This can happen after copying, conversion, metadata rewriting or clock/timezone differences.', 'high', 'personal', evidence(created, modified));
  }

  const signals = report.signals || {};
  if (signals.incrementalUpdates > 1) add('Multiple PDF revisions detected', `The PDF contains ${signals.incrementalUpdates} end-of-file revision markers, consistent with incremental saves. Earlier objects may still exist inside the file even when newer metadata replaces them.`, 'likely', 'personal');
  if (signals.embeddedFiles) add('Embedded files detected', 'The PDF references embedded files or attachments. Those attachments can contain their own metadata and private content.', 'high', 'high');
  if (signals.javascript) add('PDF JavaScript detected', 'The PDF contains JavaScript-related structures. This is a document capability signal, not proof of malicious behaviour.', 'high', 'info');
  if (signals.annotations) add('PDF annotations detected', 'The PDF contains annotation structures such as comments, links, markup or form widgets. Annotation content can contain names or private notes beyond document metadata.', 'likely', 'personal');
  if (signals.forms) add('Interactive form detected', 'The PDF contains an AcroForm structure. Form field values and names can carry sensitive information beyond top-level metadata.', 'high', 'personal');
  if (signals.layers) add('Optional content/layers detected', 'The PDF contains optional-content structures. Hidden or toggled layers can hold content not immediately visible on the page.', 'high', 'personal');
  if (signals.objectMetadata > 1) add('Object-level metadata detected', `The PDF contains multiple metadata references (${signals.objectMetadata}). Metadata may exist beyond the top-level document properties.`, 'likely', 'personal');

  if (signals.officeComments) add('Office comments detected', `The Office package contains comment-related parts${signals.officeComments > 1 ? ` (${signals.officeComments})` : ''}. Comments are document content, not ordinary metadata, and may include names or private discussion.`, 'high', 'high');
  if (signals.trackedChanges) add('Tracked changes detected', 'The Word package contains revision markup. Deleted or inserted text and editor information may remain in the document even after metadata cleaning.', 'high', 'high');
  if (signals.hiddenSheets) add('Hidden spreadsheet sheets detected', `The workbook contains ${signals.hiddenSheets} hidden or very-hidden sheet${signals.hiddenSheets === 1 ? '' : 's'}. Hidden cells remain part of the document and are not removed by metadata cleaning.`, 'high', 'high');
  if (signals.externalLinks) add('External links detected', 'The Office package contains external-link relationships. These can reveal source systems, file paths or linked workbooks.', 'likely', 'personal');
  if (signals.embeddedObjects) add('Embedded objects detected', 'The Office package contains embedded objects or files. Those objects can carry their own content and metadata.', 'high', 'high');
  if (signals.thumbnail) add('Embedded thumbnail detected', 'The Office package contains a preview thumbnail. In some workflows, previews can reveal an earlier document appearance.', 'likely', 'personal');

  const custom = fields.filter((f) => f.group === 'custom');
  if (custom.length) add('Custom Office properties present', `${custom.length} custom propert${custom.length === 1 ? 'y is' : 'ies are'} embedded. These are organisation-defined fields and can expose internal IDs, customer names or workflow data.`, 'high', 'high', custom.slice(0, 3).map((x) => `${x.label}: ${x.value}`));

  return { ...report, fields, insights };
}
