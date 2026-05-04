const documents = [];
const submissions = [];
let activeCase = '';
let databasePromise;

const storageNotice = 'Private storage is simulated locally with this browser\'s IndexedDB. Files do not leave this device in the current static demo.';
const acceptedExtensions = ['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png'];
const textExtensions = ['txt'];
const imageExtensions = ['jpg', 'jpeg', 'png'];
const pdfExtension = 'pdf';
const docxExtension = 'docx';
const statusLabels = {
  uploaded: 'Uploaded',
  processing: 'Processing',
  processed: 'Processed',
  failed: 'Failed',
};

const patternRules = [
  { name: 'Continuance or delay references', terms: ['continued', 'continuance', 'adjourned', 'reset', 'delay'] },
  { name: 'Denied or limited requests', terms: ['denied', 'overruled', 'refused', 'limited', 'excluded'] },
  { name: 'Ex parte or off-record references', terms: ['ex parte', 'off the record', 'in chambers', 'sidebar', 'not recorded'] },
  { name: 'Notice and service issues', terms: ['lack of notice', 'not served', 'service', 'notice was not', 'without notice'] },
  { name: 'Guardian ad litem activity', terms: ['guardian ad litem', 'gal', 'best interest', 'home visit', 'recommendation'] },
  { name: 'Sanctions, contempt, or enforcement', terms: ['sanction', 'contempt', 'enforce', 'warrant', 'purge'] },
  { name: 'Evidence handling issues', terms: ['exhibit', 'admitted', 'excluded', 'foundation', 'hearsay'] },
];

const roleRules = [
  { role: 'Judge', regex: /\b(?:judge|justice|hon\.?|magistrate)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'GAL', regex: /\b(?:guardian ad litem|GAL)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Attorney', regex: /\b(?:attorney|counsel|esq\.?)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Clerk', regex: /\bclerk\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Court Official', regex: /\b(?:court officer|court reporter|case manager)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
];

const dateRegex = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi;

const elements = {
  uploadForm: document.querySelector('#upload-form'),
  submitterName: document.querySelector('#submitter-name'),
  submitterEmail: document.querySelector('#submitter-email'),
  caseName: document.querySelector('#case-name'),
  caseSelect: document.querySelector('#case-select'),
  documentType: document.querySelector('#document-type'),
  notes: document.querySelector('#notes'),
  fileInput: document.querySelector('#file-input'),
  progress: document.querySelector('#upload-progress'),
  progressLabel: document.querySelector('#progress-label'),
  status: document.querySelector('#status'),
  adminList: document.querySelector('#admin-list'),
  clearLocal: document.querySelector('#clear-local'),
  documents: document.querySelector('#documents'),
  boundary: document.querySelector('#boundary'),
  documentCount: document.querySelector('#document-count'),
  timelineCount: document.querySelector('#timeline-count'),
  patternCount: document.querySelector('#pattern-count'),
  reportOutput: document.querySelector('#report-output'),
  exportReport: document.querySelector('#export-report'),
};

elements.uploadForm.addEventListener('submit', handleUpload);
elements.caseSelect.addEventListener('change', (event) => {
  activeCase = event.target.value;
  render();
});
elements.exportReport.addEventListener('click', () => downloadReport(buildReport(activeCase, activeDocuments())));
elements.clearLocal.addEventListener('click', clearLocalData);

bootstrap();

async function bootstrap() {
  await loadStoredSubmissions();
  render();
}

async function handleUpload(event) {
  event.preventDefault();
  clearStatus();

  const files = Array.from(elements.fileInput.files || []);
  const error = validateUpload(files);
  if (error) {
    showError(error);
    return;
  }

  const submission = buildSubmission(files);
  const uploadedDocuments = [];

  try {
    setProgress(3, 'Preparing local private storage...');
    for (const [index, file] of files.entries()) {
      const baseProgress = Math.round((index / files.length) * 80) + 5;
      setProgress(baseProgress, `Reading ${file.name}...`);
      const storedFile = await readFileWithProgress(file, (fileProgress) => {
        const weighted = baseProgress + Math.round((fileProgress / files.length) * 0.7);
        setProgress(Math.min(weighted, 88), `Storing ${file.name} locally...`);
      });
      setProgress(Math.min(baseProgress + 8, 90), `Extracting text from ${file.name}...`);
      const doc = await buildDocument(file, storedFile.blob, submission);
      uploadedDocuments.push(doc);
    }

    submission.documents = uploadedDocuments.map(toDocumentMetadata);
    setProgress(92, 'Saving upload metadata...');
    await saveSubmission(submission, uploadedDocuments);

    submissions.push(submission);
    documents.push(...uploadedDocuments);
    activeCase = submission.caseId;
    elements.uploadForm.reset();
    setProgress(100, `Success: saved ${uploadedDocuments.length} file(s) under ${submission.caseId}.`);
    elements.status.className = 'status success';
    elements.status.textContent = `${submission.caseId} created for ${submission.caseName}. ${storageNotice}`;
    render();
  } catch (error) {
    showError(error.message || 'The upload could not be saved. Please try again.');
  }
}

function buildSubmission(files) {
  return {
    id: crypto.randomUUID(),
    caseId: generateCaseId(),
    caseName: elements.caseName.value.trim(),
    submitterName: elements.submitterName.value.trim(),
    submitterEmail: elements.submitterEmail.value.trim(),
    documentType: elements.documentType.value,
    notes: elements.notes.value.trim(),
    fileCount: files.length,
    uploadedAt: new Date().toISOString(),
    storageMode: 'local-indexeddb-private-simulation',
    documents: [],
  };
}

async function buildDocument(file, blob, submission) {
  const extension = getExtension(file.name);
  const doc = {
    id: crypto.randomUUID(),
    submissionId: submission.id,
    caseId: submission.caseId,
    caseName: submission.caseName,
    submitterName: submission.submitterName,
    submitterEmail: submission.submitterEmail,
    name: file.name,
    type: submission.documentType,
    mimeType: file.type || 'application/octet-stream',
    extension,
    size: file.size,
    notes: submission.notes,
    uploadedAt: submission.uploadedAt,
    storageMode: submission.storageMode,
    privateBlob: blob,
    extractionStatus: 'uploaded',
    extractionStatusHistory: [{ status: 'uploaded', at: new Date().toISOString(), message: 'File uploaded to local private IndexedDB storage.' }],
    extractionMessage: 'File uploaded to local private IndexedDB storage.',
    extractionError: '',
    extractionEngine: 'local-browser-best-effort',
    sourceReference: buildSourceReference(file, submission),
    extractedText: '',
    extractionPreview: '',
    aiAnalysisStatus: 'Placeholder only: OpenAI AI pattern analysis is not connected yet. Connect it after extraction and send only cited upload text.',
    pages: [],
    actors: [],
  };

  setDocumentExtractionStatus(doc, 'processing', `Extracting text from ${extension.toUpperCase()} locally in the browser...`);

  try {
    const result = await extractText(file, blob);
    setDocumentExtractionStatus(doc, result.status, result.message);
    doc.extractionError = result.error || '';
    doc.extractionEngine = result.engine;
    doc.sourceReference = { ...doc.sourceReference, ...result.sourceReference };
    doc.extractedText = result.text;
    doc.pages = result.pages.length ? result.pages : splitTextIntoPages(result.text, doc.sourceReference);
    doc.extractionPreview = previewText(doc.extractedText);
  } catch (error) {
    setDocumentExtractionStatus(doc, 'failed', `Extraction failed for ${file.name}.`);
    doc.extractionError = error.message || 'Unknown local extraction error.';
    doc.extractedText = `[Extraction failed for ${file.name}: ${doc.extractionError}]`;
    doc.pages = splitTextIntoPages(doc.extractedText, doc.sourceReference);
    doc.extractionPreview = previewText(doc.extractedText);
  }

  doc.actors = extractActors(doc);
  return doc;
}


function setDocumentExtractionStatus(doc, status, message) {
  doc.extractionStatus = status;
  doc.extractionMessage = message;
  doc.extractionStatusHistory = [
    ...(doc.extractionStatusHistory || []),
    { status, at: new Date().toISOString(), message },
  ];
}

async function extractText(file, blob) {
  const extension = getExtension(file.name);

  if (textExtensions.includes(extension)) return extractTxt(file, blob);
  if (extension === docxExtension) return extractDocx(file, blob);
  if (extension === pdfExtension) return extractPdf(file, blob);
  if (imageExtensions.includes(extension)) return extractImageOcrPlaceholder(file);

  throw new Error(`${file.name} is not supported for extraction.`);
}

async function extractTxt(file, blob) {
  const rawText = await blob.text();
  const text = normalizeWhitespace(rawText) || '[TXT file contained no extractable text.]';
  return extractionResult({
    file,
    text,
    pages: splitTextIntoPages(rawText, { documentName: file.name, sourceType: 'txt' }),
    message: text.startsWith('[TXT file contained') ? 'TXT was processed, but no text was found.' : 'Text extracted locally from TXT file.',
    engine: 'browser-file-text',
  });
}

async function extractDocx(file, blob) {
  const entries = await unzipEntries(await blob.arrayBuffer());
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) throw new Error('DOCX extraction failed: word/document.xml was not found in the uploaded DOCX package.');

  const xml = new TextDecoder('utf-8').decode(documentXml);
  const text = docxXmlToText(xml);
  if (!normalizeWhitespace(text)) {
    return extractionResult({
      file,
      text: '[DOCX processed locally, but no extractable text was found.]',
      message: 'DOCX was processed locally, but no text was found.',
      engine: 'local-docx-zip-xml-parser',
    });
  }

  return extractionResult({
    file,
    text,
    pages: splitTextIntoPages(text, { documentName: file.name, sourceType: 'docx' }),
    message: 'DOCX text extracted locally from word/document.xml.',
    engine: 'local-docx-zip-xml-parser',
  });
}

async function extractPdf(file, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const binary = bytesToBinaryString(bytes);
  const pageCount = countPdfPages(binary);
  const streamTexts = await extractPdfStreamText(binary);
  const wholeFileText = decodePdfTextOperators(binary);
  const text = normalizeWhitespace([...streamTexts, wholeFileText].join(' '));

  if (text) {
    return extractionResult({
      file,
      text,
      pages: splitTextIntoPdfPages(text, pageCount, file.name),
      message: `Embedded PDF text extracted locally${pageCount ? ` with ${pageCount} page reference(s)` : ''}. Scanned pages without embedded text still need OCR.`,
      engine: 'local-pdf-best-effort-parser',
      sourceReference: { pageCount: pageCount || undefined },
    });
  }

  const placeholder = [
    `[${file.name} appears to be a scanned PDF or image-only PDF with no embedded text found by the local browser parser.]`,
    '[OCR placeholder: add a local Tesseract worker or private backend OCR job here before OpenAI analysis.]',
  ].join(' ');
  return extractionResult({
    file,
    text: placeholder,
    pages: splitTextIntoPdfPages(placeholder, pageCount || 1, file.name),
    message: 'PDF stored privately, but no embedded text was found. OCR is a clear local placeholder for scanned PDF pages.',
    engine: 'local-pdf-best-effort-parser-ocr-placeholder',
    sourceReference: { pageCount: pageCount || undefined },
  });
}

function extractImageOcrPlaceholder(file) {
  const text = [
    `[${file.name} is an image upload stored in local private IndexedDB.]`,
    '[OCR placeholder: browser OCR is not bundled in this static build. Add a local Tesseract.js worker or private backend OCR service here to extract JPG/PNG text before OpenAI analysis.]',
  ].join(' ');
  return extractionResult({
    file,
    text,
    pages: [{ page: 1, text, sourceReference: { documentName: file.name, page: 1, sourceType: 'image', locator: `${file.name}#image-1` } }],
    message: 'Image stored privately. OCR is not bundled yet; this local placeholder marks where JPG/PNG OCR will run.',
    engine: 'local-image-ocr-placeholder',
  });
}

function extractionResult({ file, text, pages = [], message, engine, status = 'processed', error = '', sourceReference = {} }) {
  const normalizedText = normalizeWhitespace(text);
  return {
    status,
    message,
    error,
    engine,
    text: normalizedText || '[No extractable text found.]',
    pages,
    sourceReference: {
      documentName: file.name,
      sourceType: getExtension(file.name),
      ...sourceReference,
    },
  };
}

function validateUpload(files) {
  if (!elements.submitterName.value.trim()) return 'Enter your name before submitting.';
  if (!elements.submitterEmail.validity.valid) return 'Enter a valid email address before submitting.';
  if (!elements.caseName.value.trim()) return 'Enter a case or project name before submitting.';
  if (!files.length) return 'Choose at least one document to upload.';

  const invalid = files.find((file) => !acceptedExtensions.includes(getExtension(file.name)));
  if (invalid) return `${invalid.name} is not supported. Upload PDF, DOCX, TXT, JPG, or PNG files only.`;
  return '';
}

function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve({ blob: new Blob([reader.result], { type: file.type || 'application/octet-stream' }) });
    reader.readAsArrayBuffer(file);
  });
}

function generateCaseId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const random = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `RR-${date}-${random}`;
}

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function buildSourceReference(file, submission) {
  return {
    documentName: file.name,
    caseId: submission.caseId,
    caseName: submission.caseName,
    sourceType: getExtension(file.name),
    uploadedAt: submission.uploadedAt,
    locator: `${submission.caseId}/${file.name}`,
  };
}

function splitTextIntoPages(text, baseReference = {}) {
  const explicitPages = String(text).split(/\f|\n\s*Page\s+\d+\s*\n/i).map(normalizeWhitespace).filter(Boolean);
  const chunks = explicitPages.length > 1 ? explicitPages : chunkWords(normalizeWhitespace(text), 350);
  return chunks.map((chunk, index) => ({
    page: index + 1,
    text: chunk,
    sourceReference: pageSourceReference(baseReference, index + 1),
  }));
}

function splitTextIntoPdfPages(text, pageCount, documentName) {
  const pages = splitTextIntoPages(text, { documentName, sourceType: 'pdf' });
  if (!pageCount || pageCount <= 1) return pages;

  if (pages.length >= pageCount) return pages.slice(0, pageCount);

  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  const wordsPerPage = Math.max(1, Math.ceil(words.length / pageCount));
  return Array.from({ length: pageCount }, (_, index) => {
    const pageText = words.slice(index * wordsPerPage, (index + 1) * wordsPerPage).join(' ') || '[No embedded text found on this page.]';
    return {
      page: index + 1,
      text: pageText,
      sourceReference: pageSourceReference({ documentName, sourceType: 'pdf' }, index + 1),
    };
  });
}

function pageSourceReference(baseReference, page) {
  const documentName = baseReference.documentName || 'Uploaded document';
  return {
    ...baseReference,
    page,
    locator: `${baseReference.locator || documentName}#page-${page}`,
  };
}

function previewText(text, maxLength = 260) {
  const preview = normalizeWhitespace(text);
  if (!preview) return '[No text preview available.]';
  return preview.length > maxLength ? `${preview.slice(0, maxLength).trim()}…` : preview;
}

function bytesToBinaryString(bytes) {
  const chunkSize = 0x8000;
  const chunks = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.slice(index, index + chunkSize)));
  }
  return chunks.join('');
}

function countPdfPages(binary) {
  const matches = binary.match(/\/Type\s*\/Page(?!s)\b/g);
  return matches ? matches.length : 0;
}

async function extractPdfStreamText(binary) {
  const streamRegex = /(<<[\s\S]*?>>)\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  const texts = [];
  for (const match of binary.matchAll(streamRegex)) {
    const dictionary = match[1];
    let stream = match[2];
    if (/\/FlateDecode\b/.test(dictionary)) {
      stream = await inflatePdfStream(stream);
    }
    const decoded = decodePdfTextOperators(stream);
    if (decoded) texts.push(decoded);
  }
  return texts;
}

async function inflatePdfStream(stream) {
  if (!('DecompressionStream' in window)) return '';

  const bytes = Uint8Array.from(stream, (character) => character.charCodeAt(0) & 0xff);
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const decompressed = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer();
      return bytesToBinaryString(new Uint8Array(decompressed));
    } catch {
      // Try the next browser-supported deflate flavor.
    }
  }
  return '';
}

function decodePdfTextOperators(pdfText) {
  const texts = [];
  for (const match of pdfText.matchAll(/\(((?:\\.|[^\\)])*)\)\s*T[jJ]/g)) {
    texts.push(decodePdfLiteralString(match[1]));
  }
  for (const match of pdfText.matchAll(/<([0-9A-Fa-f\s]+)>\s*T[jJ]/g)) {
    texts.push(decodePdfHexString(match[1]));
  }
  for (const arrayMatch of pdfText.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g)) {
    for (const literal of arrayMatch[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
      texts.push(decodePdfLiteralString(literal[1]));
    }
    for (const hex of arrayMatch[1].matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      texts.push(decodePdfHexString(hex[1]));
    }
  }
  return normalizeWhitespace(texts.join(' '));
}

function decodePdfLiteralString(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[escaped] || escaped))
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHexString(value) {
  const clean = value.replace(/\s+/g, '');
  const bytes = [];
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(parseInt(clean.slice(index, index + 2).padEnd(2, '0'), 16));
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).replace(/\0/g, '');
}

async function unzipEntries(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries = new Map();
  let offset = 0;

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const filenameStart = offset + 30;
    const filename = new TextDecoder().decode(bytes.slice(filenameStart, filenameStart + filenameLength));
    const dataStart = filenameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = bytes.slice(dataStart, dataEnd);

    if (!filename.endsWith('/')) {
      if (compression === 0) entries.set(filename, compressed);
      else if (compression === 8) entries.set(filename, await inflateZipEntry(compressed, filename));
      else throw new Error(`DOCX extraction failed: unsupported ZIP compression method ${compression} for ${filename}.`);
    }

    offset = dataEnd;
  }

  return entries;
}

async function inflateZipEntry(compressed, filename) {
  if (!('DecompressionStream' in window)) {
    throw new Error(`DOCX extraction failed: this browser does not support local ZIP decompression for ${filename}. Use current Microsoft Edge or Google Chrome, or add a private backend parser.`);
  }

  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw new Error(`DOCX extraction failed while decompressing ${filename}: ${error.message || 'unknown decompression error'}.`);
  }
}

function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function chunkWords(text, wordsPerPage) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += wordsPerPage) {
    chunks.push(words.slice(index, index + wordsPerPage).join(' '));
  }
  return chunks.length ? chunks : ['[No extractable text found.]'];
}

function activeDocuments() {
  return documents.filter((doc) => doc.caseId === activeCase);
}

function buildReport(caseId, docs) {
  const timeline = buildTimeline(docs);
  const repeatedPatterns = buildPatterns(docs);
  const caseName = docs[0]?.caseName || caseId || 'No active case';
  return {
    caseId,
    caseName,
    generatedAt: new Date().toISOString(),
    documentCount: docs.length,
    timeline,
    repeatedPatterns,
    coursesOfConduct: buildCoursesOfConduct(docs),
    extractionPlaceholder: 'Local extraction runs for TXT, DOCX, and embedded PDF text. Scanned PDFs and images keep a clear local OCR placeholder until a Tesseract worker or private OCR backend is connected.',
    aiPatternPlaceholder: 'OpenAI AI pattern analysis is intentionally left as a future integration placeholder and must stay limited to extracted upload text.',
    sourceBoundary: `This report is limited to ${docs.length} uploaded document(s) for ${caseName}${caseId ? ` (${caseId})` : ''}. It identifies quoted fact patterns, not legal findings.`,
  };
}

function buildTimeline(docs) {
  return docs.flatMap((doc) => doc.pages.flatMap((page) => {
    const matches = Array.from(page.text.matchAll(dateRegex));
    return matches.slice(0, 6).map((match, index) => ({
      id: `${doc.id}-${page.page}-${index}`,
      date: match[0],
      label: summarizeAround(page.text, match.index || 0, 160),
      citation: makeCitation(doc, page, match.index || 0),
    }));
  })).sort((a, b) => safeDate(a.date) - safeDate(b.date));
}

function buildPatterns(docs) {
  return patternRules.flatMap((rule) => {
    const occurrences = docs.flatMap((doc) => doc.pages.flatMap((page) => {
      const lower = page.text.toLowerCase();
      const term = rule.terms.find((candidate) => lower.includes(candidate));
      return term ? [makeCitation(doc, page, lower.indexOf(term))] : [];
    }));
    if (occurrences.length < 2) return [];
    return [{
      id: rule.name,
      pattern: rule.name,
      neutralDescription: `Detected ${occurrences.length} quoted occurrence(s). This is a procedural pattern for review, not a conclusion that misconduct occurred.`,
      occurrences,
    }];
  });
}

function buildCoursesOfConduct(docs) {
  const mentions = docs.flatMap((doc) => doc.actors.map((actor) => ({ ...actor, key: `${actor.role}:${actor.name.toLowerCase()}` })));
  const grouped = mentions.reduce((accumulator, mention) => {
    accumulator[mention.key] = [...(accumulator[mention.key] || []), mention];
    return accumulator;
  }, {});
  return Object.entries(grouped).filter(([, group]) => group.length >= 2).map(([key, group]) => {
    const [role, fallbackName] = key.split(':');
    return {
      id: key,
      actor: group[0].name || fallbackName,
      role,
      factPattern: `${group[0].name} appears in ${group.length} cited passage(s) across the uploaded record. Review these passages together to assess whether they describe a consistent course of conduct.`,
      supportingCitations: group.map((item) => item.citation),
      caution: 'The app does not infer intent, bias, ethical violations, or legal liability without attorney review of the cited record and applicable law.',
    };
  });
}

function extractActors(doc) {
  const mentions = [];
  for (const page of doc.pages) {
    for (const rule of roleRules) {
      for (const match of page.text.matchAll(rule.regex)) {
        mentions.push({
          role: rule.role,
          name: sanitizeName(match[1]),
          citation: makeCitation(doc, page, match.index || 0),
        });
      }
    }
  }
  return dedupeMentions(mentions);
}

function dedupeMentions(mentions) {
  const seen = new Set();
  return mentions.filter((mention) => {
    const key = `${mention.role}-${mention.name}-${mention.citation.docId}-${mention.citation.page}-${mention.citation.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeCitation(doc, page, index) {
  return {
    docId: doc.id,
    documentName: doc.name,
    page: page.page,
    sourceReference: page.sourceReference || pageSourceReference(doc.sourceReference || { documentName: doc.name }, page.page),
    quote: summarizeAround(page.text, Math.max(index, 0), 260),
  };
}

function summarizeAround(text, index, radius) {
  const start = Math.max(0, Math.floor(index - radius / 2));
  const end = Math.min(text.length, Math.ceil(index + radius));
  return normalizeWhitespace(`${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`);
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function sanitizeName(name) {
  return normalizeWhitespace(name).replace(/\b(?:on|for|stated|said|ordered|entered|filed)\b.*$/i, '').trim();
}

function safeDate(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function render() {
  if (!activeCase && documents.length) activeCase = documents[0].caseId;
  const cases = Array.from(new Set(documents.map((doc) => doc.caseId))).sort();
  elements.caseSelect.innerHTML = cases.length
    ? cases.map((caseId) => `<option value="${escapeHtml(caseId)}" ${caseId === activeCase ? 'selected' : ''}>${escapeHtml(caseId)} · ${escapeHtml(caseNameFor(caseId))}</option>`).join('')
    : '<option>No uploads yet</option>';

  renderAdminList();
  renderActiveDocuments();
  renderReport();
}

function renderAdminList() {
  if (!submissions.length) {
    elements.adminList.innerHTML = `<p class="empty">No uploaded documents yet. This admin preview is intentionally open until authentication is added.</p>`;
    return;
  }

  const byCase = submissions.reduce((accumulator, submission) => {
    accumulator[submission.caseId] = [...(accumulator[submission.caseId] || []), submission];
    return accumulator;
  }, {});

  elements.adminList.innerHTML = Object.entries(byCase).map(([caseId, groupedSubmissions]) => {
    const caseName = groupedSubmissions[0].caseName;
    const docs = groupedSubmissions.flatMap((submission) => submission.documents.map((doc) => ({ ...doc, submitterName: submission.submitterName, submitterEmail: submission.submitterEmail })));
    return `<article class="caseGroup">
      <div class="caseGroupHeader">
        <div><strong>${escapeHtml(caseName)}</strong><span>${escapeHtml(caseId)} · ${docs.length} document(s)</span></div>
        <button type="button" class="secondary" data-case-id="${escapeHtml(caseId)}">Review case</button>
      </div>
      <div class="tableWrap">
        <table>
          <thead><tr><th>Document</th><th>Type</th><th>Submitter</th><th>Status</th><th>Extracted text preview</th><th>Source</th><th>Uploaded</th></tr></thead>
          <tbody>${docs.map((doc) => `<tr>
            <td><strong>${escapeHtml(doc.name)}</strong><small>${formatBytes(doc.size)} · ${escapeHtml(doc.mimeType)}</small></td>
            <td>${escapeHtml(doc.type)}</td>
            <td>${escapeHtml(doc.submitterName)}<small>${escapeHtml(doc.submitterEmail)}</small></td>
            <td>${statusPill(doc.extractionStatus)}<small>${escapeHtml(doc.extractionMessage || '')}${doc.extractionError ? `<br>Error: ${escapeHtml(doc.extractionError)}` : ''}</small></td>
            <td class="previewCell">${escapeHtml(doc.extractionPreview || '[No preview available.]')}</td>
            <td><span class="pill">Local private simulation</span><small>${escapeHtml(doc.sourceReference?.locator || doc.name)}${doc.sourceReference?.pageCount ? ` · ${doc.sourceReference.pageCount} page(s)` : ''}</small></td>
            <td>${formatDate(doc.uploadedAt)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </article>`;
  }).join('');

  elements.adminList.querySelectorAll('[data-case-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCase = button.dataset.caseId;
      render();
    });
  });
}

function renderActiveDocuments() {
  const docs = activeDocuments();
  elements.documents.innerHTML = docs.length
    ? docs.map((doc) => `<article class="docCard">
        <strong>${escapeHtml(doc.name)}</strong>
        <span>${escapeHtml(doc.caseName)} · ${escapeHtml(doc.type)} · ${doc.pages.length} page(s) · ${doc.actors.length} actor mention(s)</span>
        <small>${escapeHtml(statusLabels[doc.extractionStatus] || doc.extractionStatus)} · ${escapeHtml(doc.extractionMessage || '')}</small>
        <small>Preview: ${escapeHtml(doc.extractionPreview || '[No preview available.]')}</small>
        <small>${escapeHtml(doc.aiAnalysisStatus)}</small>
      </article>`).join('')
    : '<p class="empty">No documents uploaded for this case yet.</p>';
}

function renderReport() {
  const docs = activeDocuments();
  const report = buildReport(activeCase, docs);
  elements.boundary.textContent = report.sourceBoundary;
  elements.documentCount.textContent = String(report.documentCount);
  elements.timelineCount.textContent = String(report.timeline.length);
  elements.patternCount.textContent = String(report.repeatedPatterns.length);
  elements.reportOutput.innerHTML = [
    renderSection('Timeline', 'No dated facts found yet.', report.timeline.map((event) => evidenceItem(`${event.date}: ${event.label}`, '', [event.citation]))),
    renderSection('Repeated procedural patterns', 'No repeated patterns detected across uploaded documents yet.', report.repeatedPatterns.map((finding) => evidenceItem(finding.pattern, finding.neutralDescription, finding.occurrences))),
    renderSection('Potential courses of conduct (fact patterns only)', 'No multi-citation actor patterns detected yet.', report.coursesOfConduct.map((course) => evidenceItem(`${course.role}: ${course.actor}`, `${course.factPattern} ${course.caution}`, course.supportingCitations))),
  ].join('');
}

function renderSection(title, empty, items) {
  return `<section class="reportSection"><h3>${escapeHtml(title)}</h3>${items.length ? items.join('') : `<p class="empty">${escapeHtml(empty)}</p>`}</section>`;
}

function evidenceItem(title, body, citations) {
  return `<article class="evidence"><h4>${escapeHtml(title)}</h4>${body ? `<p>${escapeHtml(body)}</p>` : ''}${citations.slice(0, 5).map((citation) => `<blockquote>“${escapeHtml(citation.quote)}”<cite>${escapeHtml(citation.documentName)}, p. ${citation.page}${citation.sourceReference?.locator ? ` · ${escapeHtml(citation.sourceReference.locator)}` : ''}</cite></blockquote>`).join('')}</article>`;
}

function statusPill(status) {
  const label = statusLabels[status] || status;
  return `<span class="pill status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.caseId || 'case'}-record-room-report.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function caseNameFor(caseId) {
  return documents.find((doc) => doc.caseId === caseId)?.caseName || caseId;
}

function setProgress(value, label) {
  elements.progress.value = value;
  elements.progressLabel.textContent = label;
}

function clearStatus() {
  elements.status.className = 'status';
  elements.status.textContent = 'Starting upload...';
}

function showError(message) {
  elements.status.className = 'status error';
  elements.status.textContent = message;
  setProgress(0, 'Upload stopped. Resolve the error and try again.');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function toDocumentMetadata(doc) {
  const { pages, actors, privateBlob, ...metadata } = doc;
  return {
    ...metadata,
    extractedPages: pages.map((page) => ({ page: page.page, text: page.text, sourceReference: page.sourceReference })),
    pageCount: pages.length,
    actorCount: actors.length,
  };
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('record-room-ai-local-storage', 1);
    request.onerror = () => reject(new Error('Local private storage is unavailable in this browser.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('submissions', { keyPath: 'id' });
      database.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

async function saveSubmission(submission, uploadedDocuments) {
  const database = await openDatabase();
  await runTransaction(database, ['submissions', 'files'], 'readwrite', (transaction) => {
    transaction.objectStore('submissions').put(submission);
    uploadedDocuments.forEach((doc) => {
      transaction.objectStore('files').put({
        id: doc.id,
        submissionId: submission.id,
        caseId: submission.caseId,
        name: doc.name,
        blob: doc.privateBlob,
        mimeType: doc.mimeType,
        size: doc.size,
        storedAt: new Date().toISOString(),
        extractedText: doc.extractedText,
        extractionStatus: doc.extractionStatus,
        extractionMessage: doc.extractionMessage,
        extractionError: doc.extractionError,
        sourceReference: doc.sourceReference,
        note: 'Original uploaded file blob stored in browser IndexedDB for local-only private storage simulation. Wire this to backend private object storage next; keep files private and send only extracted cited text to AI analysis.',
      });
    });
  });
}

async function loadStoredSubmissions() {
  try {
    const database = await openDatabase();
    const storedSubmissions = await getAll(database, 'submissions');
    submissions.push(...storedSubmissions);
    documents.push(...storedSubmissions.flatMap(hydrateDocuments));
    activeCase = documents[0]?.caseId || '';
  } catch (error) {
    showError(error.message);
  }
}

function hydrateDocuments(submission) {
  return submission.documents.map((metadata) => {
    const text = metadata.extractedText || [
      `[${metadata.name} metadata loaded from local private-storage simulation.]`,
      metadata.extractionMessage || metadata.extractionStatus,
      metadata.aiAnalysisStatus,
    ].join(' ');
    const doc = {
      ...metadata,
      extractionStatus: metadata.extractionStatus || 'processed',
      extractionMessage: metadata.extractionMessage || 'Loaded stored extraction metadata.',
      extractionPreview: metadata.extractionPreview || previewText(text),
      sourceReference: metadata.sourceReference || { documentName: metadata.name, sourceType: metadata.extension },
      pages: metadata.extractedPages?.length ? metadata.extractedPages : splitTextIntoPages(text, metadata.sourceReference || { documentName: metadata.name, sourceType: metadata.extension }),
      actors: [],
    };
    doc.actors = extractActors(doc);
    return doc;
  });
}

async function clearLocalData() {
  const database = await openDatabase();
  await runTransaction(database, ['submissions', 'files'], 'readwrite', (transaction) => {
    transaction.objectStore('submissions').clear();
    transaction.objectStore('files').clear();
  });
  submissions.splice(0, submissions.length);
  documents.splice(0, documents.length);
  activeCase = '';
  setProgress(0, 'Local demo data cleared.');
  elements.status.className = 'status';
  elements.status.textContent = 'Local IndexedDB demo storage has been cleared.';
  render();
}

function getAll(database, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onerror = () => reject(new Error(`Could not read ${storeName} from local storage.`));
    request.onsuccess = () => resolve(request.result || []);
  });
}

function runTransaction(database, stores, mode, callback) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Local storage transaction failed.'));
    callback(transaction);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
