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

const aiPresets = [
  { id: 'timeline', label: 'Timeline of events', prompt: 'Create a timeline of events using only dated or clearly sequential facts in the uploaded case documents.' },
  { id: 'judge-conduct', label: 'Pattern of conduct by judge', prompt: 'Identify citation-backed patterns involving the judge. Do not infer intent, bias, misconduct, or legal conclusions unless the source text directly supports the limited issue to review.' },
  { id: 'gal-conduct', label: 'Pattern of conduct by GAL/guardian ad litem', prompt: 'Identify citation-backed patterns involving the GAL or guardian ad litem. Separate observed facts from possible legal issues for human review.' },
  { id: 'attorney-conduct', label: 'Pattern of conduct by attorney', prompt: 'Identify citation-backed patterns involving attorneys or counsel. Avoid unsupported conclusions and frame all issues as questions for human review.' },
  { id: 'due-process', label: 'Due process concerns', prompt: 'Identify facts that may raise due process concerns, including opportunity to be heard, record access, ability to present evidence, or procedural fairness.' },
  { id: 'notice-service', label: 'Notice/service issues', prompt: 'Identify facts that may indicate notice, service, mailing, delivery, hearing notice, or proof-of-service issues.' },
  { id: 'ex-parte', label: 'Ex parte communication indicators', prompt: 'Identify facts that may indicate ex parte communications, off-record contacts, in-chambers communications, or communications without all parties present.' },
  { id: 'contradictions', label: 'Contradictions between orders/transcripts', prompt: 'Compare orders, transcripts, motions, exhibits, and correspondence for citation-backed contradictions or tension between source passages.' },
  { id: 'unified-actor-profile', label: 'Unified Actor Profile Report', prompt: 'Create a Unified Actor Profile Report for judges, GALs, attorneys, prosecutors, clerks, DFCS/CPS workers, court staff, and other officials. Verify identity using more than last name when possible and label uncertain matches “Possible match — needs human review.”' },
  { id: 'prosecutor-conduct', label: 'Prosecutor Conduct & Activity Report', prompt: 'Identify citation-backed prosecutor, ADA, solicitor, district attorney, assistant district attorney, or state attorney activity. Track charges, motions, hearings, plea/sentencing/probation positions, charging decisions, communications, conditions, and outcomes only when documented.' },
  { id: 'motion-outcomes', label: 'Motion Outcome Chart', prompt: 'Build a Motion Outcome Chart tracking who filed, who opposed, who ruled, outcome, filed/ruling dates, time to ruling, hearing, notice/service, relief requested/granted, and prevailing party only if clearly determinable.' },
  { id: 'actor-interactions', label: 'Actor Interaction / Alignment Report', prompt: 'Identify document-supported interaction patterns between judges, attorneys, GALs, prosecutors, probation/treatment court, civil attorneys, DFCS/CPS, therapists, clerks, court staff, and parties using neutral phrases like “alignment observed,” “recurring sequence observed,” and “documented communication exists.”' },
];

const aiSourceLimits = {
  maxPages: 80,
  maxCharactersPerPage: 3200,
  maxSourceCharacters: 110000,
};

const issueTypes = [
  'due process',
  'notice/service',
  'ex parte',
  'retaliation',
  'custody restriction',
  'visitation/supervision',
  'GAL conduct',
  'prosecutorial conduct',
  'probation/treatment court',
  'sanctions/fees',
  'jurisdiction/UCCJEA',
  'sealing/protective orders',
  'discovery',
  'contempt',
  'emergency relief',
  'judicial recusal/disqualification',
  'other',
];

const actorTypes = ['Judge', 'GAL', 'Attorney', 'Prosecutor', 'Clerk', 'DFCS/CPS Worker', 'Court Staff', 'Court Official', 'Agency Official', 'Other Official'];
const confidenceLevels = ['Possible match — needs human review', 'Medium', 'High'];

const issueRules = [
  { type: 'due process', terms: ['due process', 'opportunity to be heard', 'hearing', 'notice', 'testimony', 'evidence'] },
  { type: 'notice/service', terms: ['lack of notice', 'not served', 'service', 'notice was not', 'without notice', 'proof of service'] },
  { type: 'ex parte', terms: ['ex parte', 'off the record', 'in chambers', 'without all parties', 'not recorded'] },
  { type: 'retaliation', terms: ['retaliation', 'retaliatory', 'protected activity', 'grievance', 'complaint'] },
  { type: 'custody restriction', terms: ['custody', 'parenting time restricted', 'supervised visitation', 'no contact with child'] },
  { type: 'visitation/supervision', terms: ['visitation', 'supervised visitation', 'supervision', 'parenting time'] },
  { type: 'GAL conduct', terms: ['guardian ad litem', 'gal report', 'gal recommendation', 'best interest'] },
  { type: 'prosecutorial conduct', terms: ['district attorney', 'assistant district attorney', 'prosecutor', 'solicitor', 'state attorney'] },
  { type: 'probation/treatment court', terms: ['probation', 'revocation', 'treatment court', 'drug court', 'mental health court'] },
  { type: 'sanctions/fees', terms: ['sanction', 'attorney fees', 'fees awarded', 'contempt', 'costs'] },
  { type: 'jurisdiction/UCCJEA', terms: ['jurisdiction', 'uccjea', 'home state', 'venue'] },
  { type: 'sealing/protective orders', terms: ['seal', 'sealed', 'protective order', 'no-contact', 'restraining order'] },
  { type: 'discovery', terms: ['discovery', 'interrogatories', 'request for production', 'deposition', 'subpoena'] },
  { type: 'contempt', terms: ['contempt', 'show cause', 'purge'] },
  { type: 'emergency relief', terms: ['emergency', 'exigent', 'temporary restraining', 'immediate relief'] },
  { type: 'judicial recusal/disqualification', terms: ['recusal', 'recuse', 'disqualification', 'disqualify'] },
];

const patternRules = [
  { name: 'Continuance or delay references', issueType: 'due process', terms: ['continued', 'continuance', 'adjourned', 'reset', 'delay'] },
  { name: 'Denied or limited requests', issueType: 'due process', terms: ['denied', 'overruled', 'refused', 'limited', 'excluded'] },
  { name: 'Ex parte or off-record references', issueType: 'ex parte', terms: ['ex parte', 'off the record', 'in chambers', 'sidebar', 'not recorded'] },
  { name: 'Notice and service issues', issueType: 'notice/service', terms: ['lack of notice', 'not served', 'service', 'notice was not', 'without notice'] },
  { name: 'Guardian ad litem activity', issueType: 'GAL conduct', terms: ['guardian ad litem', 'gal', 'best interest', 'home visit', 'recommendation'] },
  { name: 'Sanctions, contempt, or enforcement', issueType: 'sanctions/fees', terms: ['sanction', 'contempt', 'enforce', 'warrant', 'purge'] },
  { name: 'Evidence handling issues', issueType: 'due process', terms: ['exhibit', 'admitted', 'excluded', 'foundation', 'hearsay'] },
  { name: 'Repeated emergency filings', issueType: 'emergency relief', terms: ['emergency motion', 'emergency petition', 'immediate relief', 'exigent'] },
  { name: 'Repeated sealing or protective-order efforts', issueType: 'sealing/protective orders', terms: ['motion to seal', 'sealed', 'protective order', 'no-contact'] },
  { name: 'Jurisdiction or UCCJEA references', issueType: 'jurisdiction/UCCJEA', terms: ['jurisdiction', 'uccjea', 'home state'] },
];

const reportTemplates = [
  'Unified Actor Profile Report',
  'Judicial Pattern Report',
  'GAL Conduct Report',
  'Attorney Conduct & Activity Report',
  'Prosecutor Conduct & Activity Report',
  'Court Staff / Agency Conduct Report',
  'Course of Conduct Report',
  'Actor Interaction / Alignment Report',
  'Motion Outcome Chart',
  'Filing Frequency Report',
  'Hearing Participation Report',
  'Due Process Timeline',
  'Notice and Service Defect Report',
  'Ex Parte Indicator Report',
  'Contradiction Chart',
  'Missing Evidence Checklist',
  'Human Review Questions Report',
];

const roleRules = [
  { role: 'Judge', regex: /\b(?:judge|justice|hon\.?|honorable|magistrate)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'GAL', regex: /\b(?:guardian ad litem|GAL)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Attorney', regex: /\b(?:attorney|counsel|esq\.?|lawyer)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Prosecutor', regex: /\b(?:prosecutor|district attorney|assistant district attorney|ADA|solicitor|state attorney)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Clerk', regex: /\bclerk\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'DFCS/CPS Worker', regex: /\b(?:DFCS|CPS|child protective services|caseworker|social worker)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Court Staff', regex: /\b(?:court staff|court coordinator|judicial assistant|court reporter|case manager)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
  { role: 'Court Official', regex: /\b(?:court officer|bailiff|probation officer|treatment court coordinator)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/g },
];

const extractionPatterns = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g,
  barNumber: /\b(?:bar|state bar|attorney no\.?|bar no\.?|license no\.?|license #|bar #)\s*[:#]?\s*([A-Z0-9-]{4,})/gi,
  caseNumber: /\b(?:case|docket|civil action|criminal action)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,}(?:-?[A-Z0-9]+)*)/gi,
  court: /\b((?:Superior|State|Juvenile|Probate|Magistrate|District|Circuit|Family|Municipal|County|Federal) Court(?: of [A-Z][A-Za-z ]+)?)\b/g,
  county: /\b([A-Z][A-Za-z'.-]+) County\b/g,
  state: /\b(?:State of|STATE OF)\s+([A-Z][A-Za-z ]+)\b/g,
  address: /\b\d{2,6}\s+[A-Z][A-Za-z0-9'.-]+(?:\s+[A-Z][A-Za-z0-9'.-]+){1,6}\s+(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Drive|Dr\.|Boulevard|Blvd\.|Lane|Ln\.|Suite|Ste\.)\b[^.;\n]*/g,
};

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
  actorCount: document.querySelector('#actor-count'),
  motionCount: document.querySelector('#motion-count'),
  reportOutput: document.querySelector('#report-output'),
  actorNameFilter: document.querySelector('#actor-name-filter'),
  actorTypeFilter: document.querySelector('#actor-type-filter'),
  roleServedFilter: document.querySelector('#role-served-filter'),
  partyFilter: document.querySelector('#party-filter'),
  prosecutorOfficeFilter: document.querySelector('#prosecutor-office-filter'),
  courtFilter: document.querySelector('#court-filter'),
  countyFilter: document.querySelector('#county-filter'),
  stateFilter: document.querySelector('#state-filter'),
  caseNumberFilter: document.querySelector('#case-number-filter'),
  documentTypeFilter: document.querySelector('#document-type-filter'),
  startDateFilter: document.querySelector('#start-date-filter'),
  endDateFilter: document.querySelector('#end-date-filter'),
  issueTypeFilter: document.querySelector('#issue-type-filter'),
  confidenceFilter: document.querySelector('#confidence-filter'),
  exportReport: document.querySelector('#export-report'),
  aiPresetButtons: document.querySelector('#ai-preset-buttons'),
  aiQuestion: document.querySelector('#ai-question'),
  aiRunCustom: document.querySelector('#ai-run-custom'),
  aiStatus: document.querySelector('#ai-status'),
  aiReportOutput: document.querySelector('#ai-report-output'),
};

elements.uploadForm.addEventListener('submit', handleUpload);
elements.caseSelect.addEventListener('change', (event) => {
  activeCase = event.target.value;
  render();
});
elements.exportReport.addEventListener('click', () => downloadReport(buildReport(activeCase, activeDocuments())));
elements.clearLocal.addEventListener('click', clearLocalData);
elements.aiRunCustom.addEventListener('click', () => runAiAnalysis({
  label: 'Custom question',
  prompt: elements.aiQuestion.value.trim(),
}));
[
  elements.actorNameFilter,
  elements.actorTypeFilter,
  elements.roleServedFilter,
  elements.partyFilter,
  elements.prosecutorOfficeFilter,
  elements.courtFilter,
  elements.countyFilter,
  elements.stateFilter,
  elements.caseNumberFilter,
  elements.documentTypeFilter,
  elements.startDateFilter,
  elements.endDateFilter,
  elements.issueTypeFilter,
  elements.confidenceFilter,
].filter(Boolean).forEach((input) => input.addEventListener('input', renderReport));

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
    aiAnalysisStatus: 'Ready for OpenAI pattern analysis after text extraction. Only extracted page text is sent; original file blobs stay local.',
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
  const actorProfiles = buildUnifiedActorProfiles(docs);
  const motionOutcomes = buildMotionOutcomeChart(docs, actorProfiles);
  const actorPatterns = buildActorPatterns(actorProfiles, repeatedPatterns);
  const interactionPatterns = buildInteractionPatterns(docs, actorProfiles);
  const reportCatalog = buildReportCatalog(actorProfiles, actorPatterns, interactionPatterns, motionOutcomes, timeline);
  const caseName = docs[0]?.caseName || caseId || 'No active case';
  return {
    caseId,
    caseName,
    generatedAt: new Date().toISOString(),
    documentCount: docs.length,
    timeline,
    repeatedPatterns,
    actorProfiles,
    motionOutcomes,
    actorPatterns,
    interactionPatterns,
    coursesOfConduct: buildCoursesOfConduct(docs),
    reportTemplates: reportCatalog,
    extractionPlaceholder: 'Local extraction runs for TXT, DOCX, and embedded PDF text. Scanned PDFs and images keep a clear local OCR placeholder until a Tesseract worker or private OCR backend is connected.',
    aiPatternLayer: 'OpenAI pattern analysis is available through the local Node proxy when OPENAI_API_KEY is set. The browser sends extracted page text, document names, and page references only.',
    guardrails: [
      'Every factual claim must be supported by a citation to uploaded material.',
      'Identity matches do not rely only on last name; uncertain matches remain separate and are labeled “Possible match — needs human review.”',
      'Outputs distinguish documented fact, reasonable inference, possible legal issue, and unsupported allegation.',
      'The app uses neutral language and does not assign motive, intent, final legal conclusions, or ethics violations.',
    ],
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
      issueType: rule.issueType,
      actorType: 'Document-level',
      confidenceLevel: occurrences.length > 3 ? 'High' : 'Medium',
      supportingExampleCount: occurrences.length,
      chronologicalExamples: occurrences,
      citations: occurrences,
      shortQuotedSourceText: occurrences.map((occurrence) => occurrence.quote),
      alternativeInnocentExplanations: ['The repeated language may reflect standard forms, routine scheduling, statutory terminology, or incomplete uploaded records.'],
      missingDocumentsNeeded: ['Complete docket', 'all related orders', 'hearing notices', 'certificates of service', 'transcripts, if available'],
      humanReviewQuestions: ['Does the complete record confirm each occurrence and context?', 'Were there procedural reasons documented elsewhere?'],
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

function buildUnifiedActorProfiles(docs) {
  const mentions = docs.flatMap((doc) => doc.actors.map((actor) => enrichActorMention(actor, doc)));
  const profiles = [];
  for (const mention of mentions) {
    const match = profiles.find((profile) => isSameVerifiedActor(profile, mention));
    if (match) mergeActorMention(match, mention);
    else profiles.push(createActorProfile(mention));
  }
  return profiles.map(finalizeActorProfile).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function enrichActorMention(actor, doc) {
  const text = actor.citation.quote || '';
  const fullPage = doc.pages.find((page) => page.page === actor.citation.page)?.text || text;
  const nearestDate = nearestMatch(fullPage, dateRegex, actor.citation.quote) || nearestMatch(text, dateRegex, actor.name);
  return {
    ...actor,
    actorType: actor.role,
    fullName: actor.name,
    titleRole: actor.role,
    organization: extractOrganization(fullPage),
    barNumberOrLicense: firstCapture(fullPage, extractionPatterns.barNumber),
    emailSignatureBlock: collectMatches(fullPage, extractionPatterns.email).join(', '),
    phone: collectMatches(fullPage, extractionPatterns.phone).join(', '),
    address: collectMatches(fullPage, extractionPatterns.address).slice(0, 2).join('; '),
    state: firstCapture(fullPage, extractionPatterns.state),
    county: firstCapture(fullPage, extractionPatterns.county),
    court: firstCapture(fullPage, extractionPatterns.court),
    caseNumber: firstCapture(fullPage, extractionPatterns.caseNumber) || doc.caseId,
    partyRepresentedOrRoleServed: extractPartyRepresented(fullPage, actor.role),
    appearanceDate: nearestDate,
    sourceDocument: doc.name,
    documentType: doc.type,
    issueTypes: detectIssueTypes(fullPage),
    contextText: fullPage,
  };
}

function createActorProfile(mention) {
  const profile = {
    id: crypto.randomUUID(),
    fullName: mention.fullName,
    actorType: mention.actorType,
    titleRole: mention.titleRole,
    organizationOfficeFirm: mention.organization || '',
    barNumberOrLicenseNumber: mention.barNumberOrLicense || '',
    emailSignatureBlockInfo: mention.emailSignatureBlock || '',
    phoneAddressFromPublicFilings: [mention.phone, mention.address].filter(Boolean).join(' · '),
    state: mention.state || '',
    county: mention.county || '',
    court: mention.court || '',
    caseNumbers: uniqueValues([mention.caseNumber]),
    partyRepresentedOrRoleServed: mention.partyRepresentedOrRoleServed || mention.titleRole,
    firstAppearingDate: mention.appearanceDate || '',
    lastAppearingDate: mention.appearanceDate || '',
    sourceDocumentsSupportingIdentification: uniqueValues([mention.sourceDocument]),
    identityConfidence: identityConfidenceFor(mention),
    identityVerificationBasis: identityBasisFor(mention),
    citations: [mention.citation],
    issueTypes: uniqueValues(mention.issueTypes),
    documents: [mention.sourceDocument],
    documentTypes: uniqueValues([mention.documentType]),
    mentions: [mention],
    judge: emptyJudgeFields(),
    gal: emptyGalFields(),
    attorney: emptyAttorneyFields(),
    prosecutor: emptyProsecutorFields(),
    official: emptyOfficialFields(),
  };
  applyRoleSpecificFields(profile, mention);
  return profile;
}

function mergeActorMention(profile, mention) {
  profile.organizationOfficeFirm ||= mention.organization || '';
  profile.barNumberOrLicenseNumber ||= mention.barNumberOrLicense || '';
  profile.emailSignatureBlockInfo ||= mention.emailSignatureBlock || '';
  profile.phoneAddressFromPublicFilings ||= [mention.phone, mention.address].filter(Boolean).join(' · ');
  profile.state ||= mention.state || '';
  profile.county ||= mention.county || '';
  profile.court ||= mention.court || '';
  profile.caseNumbers = uniqueValues([...profile.caseNumbers, mention.caseNumber]);
  profile.partyRepresentedOrRoleServed ||= mention.partyRepresentedOrRoleServed || mention.titleRole;
  profile.firstAppearingDate = earliestDate(profile.firstAppearingDate, mention.appearanceDate);
  profile.lastAppearingDate = latestDate(profile.lastAppearingDate, mention.appearanceDate);
  profile.sourceDocumentsSupportingIdentification = uniqueValues([...profile.sourceDocumentsSupportingIdentification, mention.sourceDocument]);
  profile.citations.push(mention.citation);
  profile.issueTypes = uniqueValues([...profile.issueTypes, ...mention.issueTypes]);
  profile.documents = uniqueValues([...profile.documents, mention.sourceDocument]);
  profile.documentTypes = uniqueValues([...profile.documentTypes, mention.documentType]);
  profile.mentions.push(mention);
  if (profile.identityConfidence !== 'High') profile.identityConfidence = identityConfidenceFor(mention);
  applyRoleSpecificFields(profile, mention);
}

function finalizeActorProfile(profile) {
  if (profile.mentions.length < 2 && profile.identityConfidence !== 'High') {
    profile.identityConfidence = 'Possible match — needs human review';
  }
  profile.courseOfConductSummary = buildActorCourseSummary(profile);
  return profile;
}

function isSameVerifiedActor(profile, mention) {
  if (profile.fullName.toLowerCase() !== mention.fullName.toLowerCase()) return false;
  if (profile.barNumberOrLicenseNumber && mention.barNumberOrLicense) return profile.barNumberOrLicenseNumber === mention.barNumberOrLicense;
  if (profile.emailSignatureBlockInfo && mention.emailSignatureBlock) return profile.emailSignatureBlockInfo.includes(mention.emailSignatureBlock) || mention.emailSignatureBlock.includes(profile.emailSignatureBlockInfo);
  const sharedContext = [profile.court && mention.court && profile.court === mention.court, profile.county && mention.county && profile.county === mention.county, profile.state && mention.state && profile.state === mention.state, profile.caseNumbers.includes(mention.caseNumber)].filter(Boolean).length;
  return sharedContext >= 1 || profile.actorType === mention.actorType;
}

function identityConfidenceFor(mention) {
  if (mention.barNumberOrLicense || mention.emailSignatureBlock) return 'High';
  if (mention.fullName.split(/\s+/).length >= 2 && (mention.court || mention.county || mention.caseNumber || mention.organization)) return 'Medium';
  return 'Possible match — needs human review';
}

function identityBasisFor(mention) {
  return [
    mention.fullName ? 'full name' : '',
    mention.titleRole ? 'title/role' : '',
    mention.organization ? 'organization/office' : '',
    mention.barNumberOrLicense ? 'bar/license number' : '',
    mention.emailSignatureBlock ? 'email/signature block' : '',
    mention.court ? 'court' : '',
    mention.county ? 'county' : '',
    mention.state ? 'state' : '',
    mention.caseNumber ? 'case number/document context' : '',
  ].filter(Boolean).join(', ') || 'limited document context only';
}

function applyRoleSpecificFields(profile, mention) {
  const lower = mention.contextText.toLowerCase();
  if (profile.actorType === 'Judge') {
    profile.judge.fullJudicialName = profile.fullName;
    profile.judge.initialsSignatureStyle = extractInitials(profile.fullName);
    profile.judge.courtDivision = mention.court || profile.court;
    profile.judge.countyState = [mention.county, mention.state].filter(Boolean).join(', ');
    profile.judge.caseNumbersHandled = uniqueValues([...profile.judge.caseNumbersHandled, mention.caseNumber]);
    if (mention.appearanceDate) profile.judge.orderDates = uniqueValues([...profile.judge.orderDates, mention.appearanceDate]);
    if (lower.includes('hearing')) profile.judge.hearingDates = uniqueValues([...profile.judge.hearingDates, mention.appearanceDate]);
    profile.judge.rulingsMade = uniqueValues([...profile.judge.rulingsMade, ...extractOutcomePhrases(mention.contextText)]);
    profile.judge.motionsGrantedDenied = uniqueValues([...profile.judge.motionsGrantedDenied, ...extractOutcomePhrases(mention.contextText).filter((item) => /granted|denied|reserved|dismissed/i.test(item))]);
    profile.judge.ordersSigned = uniqueValues([...profile.judge.ordersSigned, mention.sourceDocument].filter(Boolean));
    profile.judge.sameDayOrderIndicators ||= /same day|instanter|this date|entered.*hearing/i.test(mention.contextText);
    profile.judge.orderContentFlags = mergeFlags(profile.judge.orderContentFlags, flagTerms(mention.contextText, ['hearing', 'notice', 'evidence', 'testimony', 'jurisdiction', 'service', 'findings of fact', 'conclusions of law']));
    profile.judge.orderTypeFlags = mergeFlags(profile.judge.orderTypeFlags, flagTerms(mention.contextText, ['ex parte', 'emergency', 'temporary', 'final', 'consent', 'procedural']));
  } else if (profile.actorType === 'GAL') {
    profile.gal.fullName = profile.fullName;
    profile.gal.appointmentDateOrder ||= /appoint/i.test(lower) ? mention.appearanceDate || mention.sourceDocument : '';
    profile.gal.scopeOfAppointment ||= extractAfter(mention.contextText, /scope of appointment|appointed to|duties include/i);
    profile.gal.roleLimitations ||= extractAfter(mention.contextText, /limited to|role limitations?|shall not/i);
    if (/report/i.test(lower)) profile.gal.reportsFiled = uniqueValues([...profile.gal.reportsFiled, mention.sourceDocument]);
    profile.gal.recommendationsMade = uniqueValues([...profile.gal.recommendationsMade, ...extractAfterAll(mention.contextText, /recommend(?:ed|ation)?/ig)]);
    profile.gal.feesRequested = uniqueValues([...profile.gal.feesRequested, ...extractAfterAll(mention.contextText, /fees? requested|request(?:s|ed)? fees?/ig)]);
    profile.gal.feesAwarded = uniqueValues([...profile.gal.feesAwarded, ...extractAfterAll(mention.contextText, /fees? awarded|award(?:s|ed)? fees?/ig)]);
    if (/hearing|appeared|attended/i.test(lower)) profile.gal.hearingsAttended = uniqueValues([...profile.gal.hearingsAttended, mention.appearanceDate || mention.sourceDocument]);
    if (/testif/i.test(lower)) profile.gal.testimonyGiven = uniqueValues([...profile.gal.testimonyGiven, mention.sourceDocument]);
    if (/email|communicat|spoke|called|texted/i.test(lower)) profile.gal.communicationsReferenced = uniqueValues([...profile.gal.communicationsReferenced, mention.sourceDocument]);
    profile.gal.partiesInterviewed = uniqueValues([...profile.gal.partiesInterviewed, ...extractAfterAll(mention.contextText, /interview(?:ed)?/ig)]);
    profile.gal.recordsReviewed = uniqueValues([...profile.gal.recordsReviewed, ...extractAfterAll(mention.contextText, /review(?:ed)? records?|records reviewed/ig)]);
    profile.gal.recommendationsAdoptedByCourt ||= /adopt(?:s|ed).*recommendation|recommendation.*adopt(?:s|ed)/i.test(mention.contextText);
    profile.gal.humanReviewQuestions = uniqueValues([...profile.gal.humanReviewQuestions, ...humanReviewQuestionsFor(mention)]);
  } else if (profile.actorType === 'Attorney') {
    profile.attorney.fullName = profile.fullName;
    profile.attorney.firmOffice ||= mention.organization || '';
    profile.attorney.barNumber ||= mention.barNumberOrLicense || '';
    profile.attorney.clientRepresented ||= mention.partyRepresentedOrRoleServed || '';
    if (mention.appearanceDate) {
      profile.attorney.representationStartDate = earliestDate(profile.attorney.representationStartDate, mention.appearanceDate);
      profile.attorney.representationEndDate = latestDate(profile.attorney.representationEndDate, mention.appearanceDate);
    }
    if (/filed|motion|petition|response|brief/i.test(lower)) profile.attorney.filingsMade = uniqueValues([...profile.attorney.filingsMade, mention.sourceDocument]);
    if (/oppose|opposition|object/i.test(lower)) profile.attorney.filingsOpposed = uniqueValues([...profile.attorney.filingsOpposed, mention.sourceDocument]);
    profile.attorney.argumentsMade = uniqueValues([...profile.attorney.argumentsMade, ...extractAfterAll(mention.contextText, /argu(?:ed|ment)/ig)]);
    if (/hearing|appeared|attended/i.test(lower)) profile.attorney.hearingsAttended = uniqueValues([...profile.attorney.hearingsAttended, mention.appearanceDate || mention.sourceDocument]);
    if (/object(?:ed|ion)/i.test(lower)) profile.attorney.objectionsMade = uniqueValues([...profile.attorney.objectionsMade, mention.sourceDocument]);
    profile.attorney.specialMotions = uniqueValues([...profile.attorney.specialMotions, ...detectSpecialMotions(mention.contextText)]);
    profile.attorney.motionOutcomes = uniqueValues([...profile.attorney.motionOutcomes, ...extractOutcomePhrases(mention.contextText)]);
  } else if (profile.actorType === 'Prosecutor') {
    profile.prosecutor.fullName = profile.fullName;
    profile.prosecutor.officeAgency ||= mention.organization || '';
    profile.prosecutor.title = mention.titleRole;
    profile.prosecutor.stateCountyJurisdiction ||= [mention.state, mention.county, mention.court].filter(Boolean).join(' · ');
    profile.prosecutor.caseNumber ||= mention.caseNumber || '';
    profile.prosecutor.defendantRespondent ||= extractAfter(mention.contextText, /defendant|respondent/i);
    profile.prosecutor.chargesOrAllegations = uniqueValues([...profile.prosecutor.chargesOrAllegations, ...extractAfterAll(mention.contextText, /charge(?:s|d)?|accusation|indictment|allegation/ig)]);
    if (/hearing|appeared|attended/i.test(lower)) profile.prosecutor.hearingsAttended = uniqueValues([...profile.prosecutor.hearingsAttended, mention.appearanceDate || mention.sourceDocument]);
    if (/motion|filed/i.test(lower)) profile.prosecutor.motionsFiled = uniqueValues([...profile.prosecutor.motionsFiled, mention.sourceDocument]);
    profile.prosecutor.positionsRecommendations = uniqueValues([...profile.prosecutor.positionsRecommendations, ...extractAfterAll(mention.contextText, /bond|probation|treatment court|plea|sentencing|revocation/ig)]);
    profile.prosecutor.chargingDecisions = uniqueValues([...profile.prosecutor.chargingDecisions, ...extractAfterAll(mention.contextText, /dismissal|nolle prosequi|accusation|indictment|amendment|charging decision/ig)]);
    if (/probation|treatment court|law enforcement|opposing counsel|gal|court staff|communicat/i.test(lower)) profile.prosecutor.communicationsReferenced = uniqueValues([...profile.prosecutor.communicationsReferenced, mention.sourceDocument]);
    profile.prosecutor.victimWitnessNoContactReferences = uniqueValues([...profile.prosecutor.victimWitnessNoContactReferences, ...extractAfterAll(mention.contextText, /victim|witness|no-contact|protective order|third-party/ig)]);
    profile.prosecutor.outcomes = uniqueValues([...profile.prosecutor.outcomes, ...extractOutcomePhrases(mention.contextText)]);
  } else {
    profile.official.fullName = profile.fullName;
    profile.official.agencyOffice ||= mention.organization || '';
    profile.official.title = mention.titleRole;
    profile.official.roleInDocument ||= mention.partyRepresentedOrRoleServed || mention.titleRole;
    profile.official.actionsTaken = uniqueValues([...profile.official.actionsTaken, ...extractActionPhrases(mention.contextText)]);
    if (/report/i.test(lower)) profile.official.reportsSubmitted = uniqueValues([...profile.official.reportsSubmitted, mention.sourceDocument]);
    if (/email|communicat|spoke|called|texted/i.test(lower)) profile.official.communicationsReferenced = uniqueValues([...profile.official.communicationsReferenced, mention.sourceDocument]);
    profile.official.decisionsRecommendations = uniqueValues([...profile.official.decisionsRecommendations, ...extractAfterAll(mention.contextText, /recommend|decid|determin/ig)]);
    if (mention.appearanceDate) profile.official.datesOfInvolvement = uniqueValues([...profile.official.datesOfInvolvement, mention.appearanceDate]);
    profile.official.outcomeOrEffect = uniqueValues([...profile.official.outcomeOrEffect, ...extractOutcomePhrases(mention.contextText)]);
  }
}

function emptyJudgeFields() { return { fullJudicialName: '', initialsSignatureStyle: '', courtDivision: '', countyState: '', caseNumbersHandled: [], orderDates: [], hearingDates: [], rulingsMade: [], motionsGrantedDenied: [], ordersSigned: [], sameDayOrderIndicators: false, orderContentFlags: {}, orderTypeFlags: {} }; }
function emptyGalFields() { return { fullName: '', appointmentDateOrder: '', scopeOfAppointment: '', roleLimitations: '', reportsFiled: [], recommendationsMade: [], feesRequested: [], feesAwarded: [], hearingsAttended: [], testimonyGiven: [], communicationsReferenced: [], partiesInterviewed: [], recordsReviewed: [], recommendationsAdoptedByCourt: false, humanReviewQuestions: [] }; }
function emptyAttorneyFields() { return { fullName: '', firmOffice: '', barNumber: '', clientRepresented: '', representationStartDate: '', representationEndDate: '', filingsMade: [], filingsOpposed: [], argumentsMade: [], hearingsAttended: [], objectionsMade: [], specialMotions: [], motionOutcomes: [] }; }
function emptyProsecutorFields() { return { fullName: '', officeAgency: '', title: '', stateCountyJurisdiction: '', caseNumber: '', defendantRespondent: '', chargesOrAllegations: [], hearingsAttended: [], motionsFiled: [], positionsRecommendations: [], chargingDecisions: [], communicationsReferenced: [], victimWitnessNoContactReferences: [], outcomes: [] }; }
function emptyOfficialFields() { return { fullName: '', agencyOffice: '', title: '', roleInDocument: '', actionsTaken: [], reportsSubmitted: [], communicationsReferenced: [], decisionsRecommendations: [], datesOfInvolvement: [], outcomeOrEffect: [] }; }

function buildActorCourseSummary(profile) {
  const examples = profile.citations.slice(0, 6);
  if (examples.length < 2) return 'Single cited mention only; not labeled as a pattern unless the user requests single-incident analysis.';
  return `Recurring sequence observed: ${profile.fullName} has ${examples.length} cited mention(s) in the uploaded record. Human review should compare the cited passages before drawing conclusions.`;
}

function buildActorPatterns(actorProfiles, repeatedPatterns) {
  return actorProfiles.filter((profile) => profile.citations.length >= 2).map((profile) => ({
    patternName: `${profile.actorType} activity over time`,
    actorsInvolved: [profile.fullName],
    actorType: profile.actorType,
    confidenceLevel: profile.identityConfidence === 'High' ? 'High' : 'Medium',
    numberOfSupportingExamples: profile.citations.length,
    chronologicalExamples: profile.citations,
    citations: profile.citations,
    shortQuotedSourceText: profile.citations.slice(0, 5).map((citation) => citation.quote),
    alternativeInnocentExplanations: ['The uploaded set may over-represent this actor because of case assignment, counsel role, filing responsibility, or incomplete documents.'],
    missingDocumentsNeeded: ['Complete docket', 'full hearing transcripts', 'all orders and filings for the relevant date range'],
    humanReviewQuestions: ['Do the cited events involve the same verified person?', 'Does the full record explain the sequence neutrally?'],
    relatedDocumentPatterns: repeatedPatterns.filter((pattern) => profile.issueTypes.includes(pattern.issueType)).map((pattern) => pattern.pattern),
  }));
}

function buildInteractionPatterns(docs, actorProfiles) {
  const interactions = [];
  const pairs = [
    ['Judge', 'Attorney'], ['Judge', 'GAL'], ['Judge', 'Prosecutor'], ['Attorney', 'GAL'], ['Attorney', 'Prosecutor'], ['Prosecutor', 'Court Official'], ['Prosecutor', 'Attorney'], ['GAL', 'DFCS/CPS Worker'], ['GAL', 'Court Staff'], ['Clerk', 'Judge'], ['Court Staff', 'Attorney'],
  ];
  for (const doc of docs) {
    for (const page of doc.pages) {
      const pageActors = actorProfiles.filter((profile) => profile.mentions.some((mention) => mention.sourceDocument === doc.name && mention.citation.page === page.page));
      for (const [left, right] of pairs) {
        const leftActors = pageActors.filter((actor) => actor.actorType === left);
        const rightActors = pageActors.filter((actor) => actor.actorType === right);
        for (const leftActor of leftActors) {
          for (const rightActor of rightActors) {
            interactions.push({
              patternName: `${left} ↔ ${right} documented communication or alignment check`,
              actorsInvolved: [leftActor.fullName, rightActor.fullName],
              actorType: `${left} ↔ ${right}`,
              confidenceLevel: /communicat|email|spoke|recommend|grant|deny|adopt/i.test(page.text) ? 'Medium' : 'Possible match — needs human review',
              neutralPhrasing: /communicat|email|spoke/i.test(page.text) ? 'documented communication exists' : 'alignment observed',
              citation: makeCitation(doc, page, 0),
            });
          }
        }
      }
    }
  }
  const grouped = interactions.reduce((accumulator, item) => {
    const key = `${item.patternName}:${item.actorsInvolved.join('|')}`;
    accumulator[key] = [...(accumulator[key] || []), item];
    return accumulator;
  }, {});
  return Object.values(grouped).filter((group) => group.length >= 2).map((group) => ({
    patternName: group[0].patternName,
    actorsInvolved: group[0].actorsInvolved,
    actorType: group[0].actorType,
    confidenceLevel: group.some((item) => item.confidenceLevel === 'Medium') ? 'Medium' : 'Possible match — needs human review',
    numberOfSupportingExamples: group.length,
    chronologicalExamples: group.map((item) => item.citation),
    citations: group.map((item) => item.citation),
    shortQuotedSourceText: group.map((item) => item.citation.quote),
    neutralPhrasing: group[0].neutralPhrasing,
    alternativeInnocentExplanations: ['The same page may list routine appearances, service recipients, or standard order routing rather than substantive coordination.'],
    missingDocumentsNeeded: ['Underlying emails/notices if referenced', 'full transcript pages around the cited passages', 'complete certificate-of-service records'],
    humanReviewQuestions: ['Does the cited text show direct communication, mere co-appearance, or only document routing?', 'Are all parties included in the cited communication?'],
  }));
}

function buildMotionOutcomeChart(docs) {
  return docs.flatMap((doc) => doc.pages.flatMap((page) => {
    const lower = page.text.toLowerCase();
    if (!/motion|petition|application|request|order/.test(lower)) return [];
    const dateFiled = nearestMatch(page.text, dateRegex, 'filed') || nearestMatch(page.text, dateRegex, 'motion');
    const dateRuled = nearestMatch(page.text, dateRegex, 'granted') || nearestMatch(page.text, dateRegex, 'denied') || nearestMatch(page.text, dateRegex, 'ordered');
    const outcome = detectOutcome(page.text);
    return [{
      id: `${doc.id}-${page.page}-motion`,
      filingOrMotion: extractMotionTitle(page.text) || doc.name,
      filedBy: extractAfter(page.text, /filed by|movant|petitioner|plaintiff|state/i) || 'Not determinable from available documents.',
      opposedBy: extractAfter(page.text, /opposed by|respondent|defendant/i) || 'Not determinable from available documents.',
      ruledBy: extractAfter(page.text, /judge|honorable|ordered by/i) || 'Not determinable from available documents.',
      outcome,
      dateFiled: dateFiled || 'Not determinable from available documents.',
      dateRuled: dateRuled || 'Not determinable from available documents.',
      timeBetweenFilingAndRuling: dateFiled && dateRuled ? daysBetween(dateFiled, dateRuled) : 'Not determinable from available documents.',
      hearingOccurred: /hearing/.test(lower),
      noticeServiceDocumented: /notice|served|service|certificate of service/.test(lower),
      reliefRequested: extractAfter(page.text, /requests?|seeks?|prays?/i) || 'Not determinable from available documents.',
      reliefGranted: /granted|ordered/.test(lower) ? extractAfter(page.text, /granted|ordered/i) || 'See cited source text.' : 'Outcome not determinable from available documents.',
      prevailingParty: /granted|denied/.test(lower) ? 'Only if clearly determinable from cited source text; human review required.' : 'Outcome not determinable from available documents.',
      issueTypes: detectIssueTypes(page.text),
      citation: makeCitation(doc, page, lower.search(/motion|petition|request|order/)),
    }];
  }));
}

function buildReportCatalog(actorProfiles, actorPatterns, interactionPatterns, motionOutcomes, timeline) {
  return reportTemplates.map((name) => ({
    name,
    description: reportDescription(name),
    guardrail: 'Use uploaded materials only; cite every factual claim; label uncertain facts as needing human review.',
    availableItemCount: reportItemCount(name, actorProfiles, actorPatterns, interactionPatterns, motionOutcomes, timeline),
  }));
}

function reportDescription(name) {
  const descriptions = {
    'Unified Actor Profile Report': 'Verified or human-review actor identities with roles, offices, contact/signature details, dates, cases, and source documents.',
    'Motion Outcome Chart': 'Filing, opposition, ruling, notice/service, hearing, relief, outcome, and timing fields when determinable.',
    'Actor Interaction / Alignment Report': 'Neutral judge/attorney/GAL/prosecutor/staff interaction patterns using phrases such as “alignment observed.”',
    'Course of Conduct Report': 'Repeated document-supported actions over time; no pattern label unless at least two cited examples exist.',
  };
  return descriptions[name] || `${name} template with citation-backed facts, missing documents, alternative innocent explanations, and human-review questions.`;
}

function reportItemCount(name, actorProfiles, actorPatterns, interactionPatterns, motionOutcomes, timeline) {
  if (name.includes('Actor Profile')) return actorProfiles.length;
  if (name.includes('Motion Outcome')) return motionOutcomes.length;
  if (name.includes('Interaction')) return interactionPatterns.length;
  if (name.includes('Timeline')) return timeline.length;
  if (name.includes('Conduct') || name.includes('Pattern') || name.includes('Course')) return actorPatterns.length;
  return 0;
}

function extractActors(doc) {
  const mentions = [];
  for (const page of doc.pages) {
    for (const rule of roleRules) {
      rule.regex.lastIndex = 0;
      for (const match of page.text.matchAll(rule.regex)) {
        mentions.push({
          role: rule.role,
          name: sanitizeName(match[1]),
          citation: makeCitation(doc, page, match.index || 0),
        });
      }
    }
    for (const signature of extractSignatureBlockActors(page.text, doc, page)) mentions.push(signature);
  }
  return dedupeMentions(mentions.filter((mention) => mention.name && mention.name.length > 2));
}

function extractSignatureBlockActors(text, doc, page) {
  const mentions = [];
  const signatureRegex = /(?:Respectfully submitted|Submitted by|Attorney for|Counsel for|Signed:|\/s\/|By:)\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})/g;
  for (const match of text.matchAll(signatureRegex)) {
    mentions.push({
      role: inferRoleFromContext(summarizeAround(text, match.index || 0, 360)),
      name: sanitizeName(match[1]),
      citation: makeCitation(doc, page, match.index || 0),
    });
  }
  return mentions;
}

function inferRoleFromContext(context) {
  if (/guardian ad litem|\bGAL\b/i.test(context)) return 'GAL';
  if (/district attorney|assistant district attorney|prosecutor|solicitor|state attorney/i.test(context)) return 'Prosecutor';
  if (/judge|honorable|magistrate|justice/i.test(context)) return 'Judge';
  if (/clerk/i.test(context)) return 'Clerk';
  if (/DFCS|CPS|caseworker|social worker|child protective/i.test(context)) return 'DFCS/CPS Worker';
  if (/court reporter|judicial assistant|court coordinator|court staff/i.test(context)) return 'Court Staff';
  return 'Attorney';
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

function collectMatches(text, regex) {
  regex.lastIndex = 0;
  return uniqueValues(Array.from(String(text).matchAll(regex)).map((match) => match[1] || match[0]).filter(Boolean));
}

function firstCapture(text, regex) {
  regex.lastIndex = 0;
  const match = regex.exec(String(text));
  return match ? normalizeWhitespace(match[1] || match[0]) : '';
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function extractOrganization(text) {
  const orgMatch = String(text).match(/\b(?:Office of|Law Office(?:s)? of|Department of|District Attorney(?:'s)? Office|Solicitor(?:'s)? Office|DFCS|CPS|Division of Family and Children Services|Public Defender(?:'s)? Office|Attorney General(?:'s)? Office)\s+[^.;\n]{0,90}/i);
  return orgMatch ? normalizeWhitespace(orgMatch[0]) : '';
}

function extractPartyRepresented(text, role) {
  const party = String(text).match(/(?:attorney|counsel|guardian ad litem|GAL)\s+(?:for|representing|on behalf of)\s+([^.;\n]{2,80})/i);
  if (party) return normalizeWhitespace(party[1]);
  if (role === 'Prosecutor') return 'state';
  if (role === 'Judge') return 'court/judicial officer';
  return role;
}

function detectIssueTypes(text) {
  const lower = String(text).toLowerCase();
  const found = issueRules.filter((rule) => rule.terms.some((term) => lower.includes(term.toLowerCase()))).map((rule) => rule.type);
  return found.length ? uniqueValues(found) : ['other'];
}

function nearestMatch(text, regex, anchor) {
  regex.lastIndex = 0;
  const matches = Array.from(String(text).matchAll(regex));
  if (!matches.length) return '';
  const anchorIndex = Math.max(0, String(text).toLowerCase().indexOf(String(anchor || '').toLowerCase()));
  return matches.sort((a, b) => Math.abs((a.index || 0) - anchorIndex) - Math.abs((b.index || 0) - anchorIndex))[0][0];
}

function earliestDate(current, candidate) {
  if (!current) return candidate || '';
  if (!candidate) return current;
  return safeDate(candidate) < safeDate(current) ? candidate : current;
}

function latestDate(current, candidate) {
  if (!current) return candidate || '';
  if (!candidate) return current;
  return safeDate(candidate) > safeDate(current) ? candidate : current;
}

function extractInitials(name) {
  return String(name).split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase()).join('');
}

function flagTerms(text, terms) {
  const lower = String(text).toLowerCase();
  return terms.reduce((flags, term) => ({ ...flags, [term]: lower.includes(term.toLowerCase()) }), {});
}

function mergeFlags(existing, next) {
  return Object.fromEntries(Object.entries({ ...existing, ...next }).map(([key]) => [key, Boolean(existing?.[key] || next?.[key])]));
}

function extractAfter(text, regex) {
  const match = String(text).match(regex);
  if (!match) return '';
  return normalizeWhitespace(String(text).slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 100).replace(/^[\s:,-]+/, '').split(/[.;\n]/)[0]);
}

function extractAfterAll(text, regex) {
  return uniqueValues(Array.from(String(text).matchAll(regex)).map((match) => extractAfter(String(text).slice(match.index || 0), regex)).filter(Boolean)).slice(0, 8);
}

function extractOutcomePhrases(text) {
  const outcomes = [];
  for (const term of ['granted', 'denied', 'partially granted', 'reserved', 'withdrawn', 'dismissed', 'not ruled on', 'awarded', 'ordered']) {
    const index = String(text).toLowerCase().indexOf(term);
    if (index >= 0) outcomes.push(summarizeAround(text, index, 180));
  }
  return uniqueValues(outcomes).slice(0, 8);
}

function detectSpecialMotions(text) {
  const terms = ['sanctions', 'contempt', 'emergency relief', 'protective order', 'sealing', 'reconsideration', 'recusal', 'disqualification', 'custody modification', 'visitation restriction', 'fees', 'discovery relief'];
  const lower = String(text).toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function extractActionPhrases(text) {
  const actionRegex = /\b(?:filed|submitted|served|mailed|notified|recommended|decided|ordered|reported|reviewed|interviewed)\b[^.;\n]{0,120}/gi;
  return uniqueValues(Array.from(String(text).matchAll(actionRegex)).map((match) => match[0])).slice(0, 8);
}

function humanReviewQuestionsFor(mention) {
  const questions = [];
  if (mention.issueTypes.includes('GAL conduct')) questions.push('Does the complete record show the GAL appointment scope, interviews, records reviewed, and recommendation basis?');
  if (mention.issueTypes.includes('notice/service')) questions.push('Do certificates of service and hearing notices support the described sequence?');
  if (mention.issueTypes.includes('ex parte')) questions.push('Does the full record show whether all parties received notice or were present?');
  return questions;
}

function extractMotionTitle(text) {
  const match = String(text).match(/\b(?:motion|petition|application|request)\s+(?:for|to)?\s*([^.;\n]{0,90})/i);
  return match ? normalizeWhitespace(`${match[0]}`) : '';
}

function detectOutcome(text) {
  const lower = String(text).toLowerCase();
  if (lower.includes('partially granted')) return 'partially granted';
  for (const outcome of ['granted', 'denied', 'reserved', 'withdrawn', 'dismissed']) {
    if (lower.includes(outcome)) return outcome;
  }
  return 'Outcome not determinable from available documents.';
}

function daysBetween(start, end) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return 'Not determinable from available documents.';
  const days = Math.round((endTime - startTime) / 86400000);
  return `${days} day(s)`;
}

function currentFilters() {
  return {
    actorName: elements.actorNameFilter?.value.trim().toLowerCase() || '',
    actorType: elements.actorTypeFilter?.value || '',
    roleServed: elements.roleServedFilter?.value.trim().toLowerCase() || '',
    party: elements.partyFilter?.value.trim().toLowerCase() || '',
    prosecutorOffice: elements.prosecutorOfficeFilter?.value.trim().toLowerCase() || '',
    court: elements.courtFilter?.value.trim().toLowerCase() || '',
    county: elements.countyFilter?.value.trim().toLowerCase() || '',
    state: elements.stateFilter?.value.trim().toLowerCase() || '',
    caseNumber: elements.caseNumberFilter?.value.trim().toLowerCase() || '',
    documentType: elements.documentTypeFilter?.value || '',
    startDate: elements.startDateFilter?.value || '',
    endDate: elements.endDateFilter?.value || '',
    issueType: elements.issueTypeFilter?.value || '',
    confidence: elements.confidenceFilter?.value || '',
  };
}

function confidenceRank(level) {
  return { 'Possible match — needs human review': 1, Medium: 2, High: 3 }[level] || 0;
}

function profileMatchesFilters(profile, filters) {
  const haystack = [profile.fullName, profile.actorType, profile.partyRepresentedOrRoleServed, profile.organizationOfficeFirm, profile.court, profile.county, profile.state, profile.caseNumbers.join(' '), profile.documentTypes.join(' '), profile.issueTypes.join(' '), profile.identityConfidence].join(' ').toLowerCase();
  if (filters.actorName && !profile.fullName.toLowerCase().includes(filters.actorName)) return false;
  if (filters.actorType && profile.actorType !== filters.actorType) return false;
  if (filters.roleServed && !profile.partyRepresentedOrRoleServed.toLowerCase().includes(filters.roleServed)) return false;
  if (filters.party && !profile.partyRepresentedOrRoleServed.toLowerCase().includes(filters.party)) return false;
  if (filters.prosecutorOffice && !profile.organizationOfficeFirm.toLowerCase().includes(filters.prosecutorOffice)) return false;
  if (filters.court && !profile.court.toLowerCase().includes(filters.court)) return false;
  if (filters.county && !profile.county.toLowerCase().includes(filters.county)) return false;
  if (filters.state && !profile.state.toLowerCase().includes(filters.state)) return false;
  if (filters.caseNumber && !profile.caseNumbers.join(' ').toLowerCase().includes(filters.caseNumber)) return false;
  if (filters.documentType && !profile.documentTypes.includes(filters.documentType)) return false;
  if (filters.issueType && !profile.issueTypes.includes(filters.issueType)) return false;
  if (filters.confidence && confidenceRank(profile.identityConfidence) < confidenceRank(filters.confidence)) return false;
  if (filters.startDate && profile.lastAppearingDate && safeDate(profile.lastAppearingDate) < safeDate(filters.startDate)) return false;
  if (filters.endDate && profile.firstAppearingDate && safeDate(profile.firstAppearingDate) > safeDate(filters.endDate)) return false;
  return Boolean(haystack);
}

function render() {
  if (!activeCase && documents.length) activeCase = documents[0].caseId;
  const cases = Array.from(new Set(documents.map((doc) => doc.caseId))).sort();
  elements.caseSelect.innerHTML = cases.length
    ? cases.map((caseId) => `<option value="${escapeHtml(caseId)}" ${caseId === activeCase ? 'selected' : ''}>${escapeHtml(caseId)} · ${escapeHtml(caseNameFor(caseId))}</option>`).join('')
    : '<option>No uploads yet</option>';

  renderAdminList();
  renderActiveDocuments();
  renderAiControls();
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

function renderAiControls() {
  const hasDocs = activeDocuments().length > 0;
  elements.aiPresetButtons.innerHTML = aiPresets.map((preset) => `
    <button type="button" class="secondary presetButton" data-preset-id="${escapeHtml(preset.id)}" ${hasDocs ? '' : 'disabled'}>${escapeHtml(preset.label)}</button>
  `).join('');
  elements.aiRunCustom.disabled = !hasDocs;
  elements.aiQuestion.disabled = !hasDocs;
  elements.aiPresetButtons.querySelectorAll('[data-preset-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = aiPresets.find((candidate) => candidate.id === button.dataset.presetId);
      if (preset) runAiAnalysis(preset);
    });
  });
}

async function runAiAnalysis(request) {
  const docs = activeDocuments();
  const question = normalizeWhitespace(request.prompt || '');
  if (!docs.length) {
    setAiStatus('Upload and select a case before running OpenAI analysis.', 'error');
    return;
  }
  if (!question) {
    setAiStatus('Enter a question or choose a preset analysis button.', 'error');
    return;
  }

  const sourceMaterial = buildAiSourceMaterial(docs);
  if (!sourceMaterial.pages.length) {
    setAiStatus('No extracted document text is available for AI analysis yet.', 'error');
    return;
  }

  setAiBusy(true);
  setAiStatus(`Running OpenAI analysis for “${request.label}”…`, '');
  elements.aiReportOutput.innerHTML = '<p class="empty">OpenAI is reviewing extracted page text and building citation-backed findings...</p>';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: activeCase,
        caseName: docs[0]?.caseName || activeCase,
        analysisType: request.label,
        question,
        sourceMaterial,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'OpenAI analysis failed.');
    setAiStatus(`OpenAI analysis complete for “${request.label}”.`, 'success');
    renderAiReport(payload.analysis || '[No analysis text returned.]', payload.model);
  } catch (error) {
    setAiStatus(error.message || 'OpenAI analysis failed.', 'error');
    elements.aiReportOutput.innerHTML = `<p class="empty">${escapeHtml(error.message || 'OpenAI analysis failed.')}</p>`;
  } finally {
    setAiBusy(false);
  }
}

function buildAiSourceMaterial(docs) {
  let totalCharacters = 0;
  const pages = [];
  for (const doc of docs) {
    for (const page of doc.pages || []) {
      if (pages.length >= aiSourceLimits.maxPages || totalCharacters >= aiSourceLimits.maxSourceCharacters) break;
      const text = normalizeWhitespace(page.text || '');
      if (!text || text.startsWith('[No extractable text found')) continue;
      const clipped = text.slice(0, aiSourceLimits.maxCharactersPerPage);
      totalCharacters += clipped.length;
      pages.push({
        documentName: doc.name,
        documentType: doc.type,
        page: page.page || null,
        sourceLocator: page.sourceReference?.locator || doc.sourceReference?.locator || doc.name,
        text: clipped,
      });
    }
    if (pages.length >= aiSourceLimits.maxPages || totalCharacters >= aiSourceLimits.maxSourceCharacters) break;
  }
  return {
    sourceBoundary: `Extracted text only from ${docs.length} uploaded document(s). Original file blobs are not sent to OpenAI by the browser.`,
    truncated: pages.length >= aiSourceLimits.maxPages || totalCharacters >= aiSourceLimits.maxSourceCharacters,
    pages,
  };
}

function renderAiReport(analysis, model) {
  elements.aiReportOutput.innerHTML = `
    <article class="aiReport">
      <div class="aiReportMeta"><span class="pill">OpenAI${model ? ` · ${escapeHtml(model)}` : ''}</span><span>Requires document name, page when available, and quoted source text for every finding.</span></div>
      ${markdownToHtml(analysis)}
    </article>
  `;
}

function markdownToHtml(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  let inList = false;
  const html = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) { html.push('</ul>'); inList = false; }
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      if (inList) { html.push('</ul>'); inList = false; }
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('');
}

function formatInlineMarkdown(value) {
  return escapeHtml(value).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function setAiBusy(isBusy) {
  elements.aiRunCustom.disabled = isBusy || !activeDocuments().length;
  elements.aiQuestion.disabled = isBusy || !activeDocuments().length;
  elements.aiPresetButtons.querySelectorAll('button').forEach((button) => {
    button.disabled = isBusy || !activeDocuments().length;
  });
}

function setAiStatus(message, type) {
  elements.aiStatus.className = `status${type ? ` ${type}` : ''}`;
  elements.aiStatus.textContent = message;
}

function renderReport() {
  const docs = activeDocuments();
  const report = buildReport(activeCase, docs);
  const filters = currentFilters();
  const filteredProfiles = report.actorProfiles.filter((profile) => profileMatchesFilters(profile, filters));
  const filteredPatterns = report.repeatedPatterns.filter((pattern) => !filters.issueType || pattern.issueType === filters.issueType);
  const filteredMotions = report.motionOutcomes.filter((motion) => {
    if (filters.issueType && !motion.issueTypes.includes(filters.issueType)) return false;
    if (filters.documentType && !docs.find((doc) => doc.name === motion.citation.documentName && doc.type === filters.documentType)) return false;
    return true;
  });
  elements.boundary.textContent = report.sourceBoundary;
  elements.documentCount.textContent = String(report.documentCount);
  elements.timelineCount.textContent = String(report.timeline.length);
  elements.patternCount.textContent = String(filteredPatterns.length);
  if (elements.actorCount) elements.actorCount.textContent = String(filteredProfiles.length);
  if (elements.motionCount) elements.motionCount.textContent = String(filteredMotions.length);
  elements.reportOutput.innerHTML = [
    renderSection('Unified Actor Profile Report', 'No actor profiles match the current filters yet.', filteredProfiles.map(actorProfileItem)),
    renderSection('Motion Outcome Chart', 'No motion/order outcomes match the current filters yet.', filteredMotions.map(motionOutcomeItem)),
    renderSection('Timeline', 'No dated facts found yet.', report.timeline.map((event) => evidenceItem(`${event.date}: ${event.label}`, '', [event.citation]))),
    renderSection('Repeated procedural patterns', 'No repeated patterns detected across uploaded documents yet. At least two cited examples are required before the app calls something a pattern.', filteredPatterns.map((finding) => patternItem(finding))),
    renderSection('Potential courses of conduct (fact patterns only)', 'No multi-citation actor patterns detected yet.', report.coursesOfConduct.map((course) => evidenceItem(`${course.role}: ${course.actor}`, `${course.factPattern} ${course.caution}`, course.supportingCitations))),
    renderSection('Actor Interaction / Alignment Report', 'No two-example actor interaction patterns detected yet.', report.interactionPatterns.map((pattern) => patternItem(pattern))),
    renderSection('Report templates available', 'No report templates configured.', report.reportTemplates.map((template) => `<article class="evidence"><h4>${escapeHtml(template.name)}</h4><p>${escapeHtml(template.description)}</p><p><strong>Available items:</strong> ${template.availableItemCount}. ${escapeHtml(template.guardrail)}</p></article>`)),
    renderSection('Human Review Questions Report', 'No human-review questions generated yet.', buildHumanReviewQuestionItems(filteredProfiles, report.actorPatterns, report.interactionPatterns)),
  ].join('');
}

function actorProfileItem(profile) {
  const roleSpecific = roleSpecificSummary(profile);
  return `<article class="evidence actorProfile">
    <h4>${escapeHtml(profile.fullName)} <span class="pill">${escapeHtml(profile.actorType)}</span></h4>
    <p><strong>Identity:</strong> ${escapeHtml(profile.identityConfidence)} · verified using ${escapeHtml(profile.identityVerificationBasis)}.</p>
    <p><strong>Role/office:</strong> ${escapeHtml(profile.titleRole || 'Not stated')} · ${escapeHtml(profile.organizationOfficeFirm || 'Organization not determinable from available documents.')}</p>
    <p><strong>Case/court:</strong> ${escapeHtml(profile.caseNumbers.join(', ') || 'Not determinable')} · ${escapeHtml(profile.court || 'Court not determinable')} · ${escapeHtml([profile.county, profile.state].filter(Boolean).join(', ') || 'County/state not determinable')}</p>
    <p><strong>Representation/served role:</strong> ${escapeHtml(profile.partyRepresentedOrRoleServed || 'Not determinable from available documents.')}</p>
    <p><strong>Dates:</strong> first ${escapeHtml(profile.firstAppearingDate || 'not determinable')} · last ${escapeHtml(profile.lastAppearingDate || 'not determinable')}</p>
    <p><strong>Contact/signature details:</strong> ${escapeHtml([profile.barNumberOrLicenseNumber && `Bar/license ${profile.barNumberOrLicenseNumber}`, profile.emailSignatureBlockInfo, profile.phoneAddressFromPublicFilings].filter(Boolean).join(' · ') || 'Not found in extracted public filing text.')}</p>
    <p><strong>Role-specific extracted fields:</strong> ${escapeHtml(roleSpecific)}</p>
    <p><strong>Source documents:</strong> ${escapeHtml(profile.sourceDocumentsSupportingIdentification.join(', '))}</p>
    ${profile.citations.slice(0, 4).map(renderCitation).join('')}
  </article>`;
}

function roleSpecificSummary(profile) {
  if (profile.actorType === 'Judge') return `orders signed: ${profile.judge.ordersSigned.length}; rulings: ${profile.judge.rulingsMade.length}; content flags: ${Object.entries(profile.judge.orderContentFlags).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none detected'}`;
  if (profile.actorType === 'GAL') return `reports: ${profile.gal.reportsFiled.length}; recommendations: ${profile.gal.recommendationsMade.length}; fees requested/awarded: ${profile.gal.feesRequested.length}/${profile.gal.feesAwarded.length}; adopted indicator: ${profile.gal.recommendationsAdoptedByCourt ? 'yes' : 'not detected'}`;
  if (profile.actorType === 'Attorney') return `client: ${profile.attorney.clientRepresented || 'not determinable'}; filings made: ${profile.attorney.filingsMade.length}; objections: ${profile.attorney.objectionsMade.length}; special motions: ${profile.attorney.specialMotions.join(', ') || 'none detected'}`;
  if (profile.actorType === 'Prosecutor') return `office: ${profile.prosecutor.officeAgency || 'not determinable'}; motions filed: ${profile.prosecutor.motionsFiled.length}; charging decisions: ${profile.prosecutor.chargingDecisions.length}; outcomes: ${profile.prosecutor.outcomes.length}`;
  return `actions: ${profile.official.actionsTaken.length}; reports: ${profile.official.reportsSubmitted.length}; communications: ${profile.official.communicationsReferenced.length}; dates: ${profile.official.datesOfInvolvement.join(', ') || 'not determinable'}`;
}

function motionOutcomeItem(motion) {
  return `<article class="evidence">
    <h4>${escapeHtml(motion.filingOrMotion)}</h4>
    <p><strong>Filed by:</strong> ${escapeHtml(motion.filedBy)} · <strong>Opposed by:</strong> ${escapeHtml(motion.opposedBy)} · <strong>Ruled by:</strong> ${escapeHtml(motion.ruledBy)}</p>
    <p><strong>Outcome:</strong> ${escapeHtml(motion.outcome)} · <strong>Filed:</strong> ${escapeHtml(motion.dateFiled)} · <strong>Ruled:</strong> ${escapeHtml(motion.dateRuled)} · <strong>Time:</strong> ${escapeHtml(motion.timeBetweenFilingAndRuling)}</p>
    <p><strong>Hearing:</strong> ${motion.hearingOccurred ? 'documented indicator exists' : 'not documented in extracted text'} · <strong>Notice/service:</strong> ${motion.noticeServiceDocumented ? 'documented indicator exists' : 'not documented in extracted text'}</p>
    <p><strong>Relief requested:</strong> ${escapeHtml(motion.reliefRequested)} · <strong>Relief granted:</strong> ${escapeHtml(motion.reliefGranted)}</p>
    ${renderCitation(motion.citation)}
  </article>`;
}

function patternItem(pattern) {
  const citations = pattern.citations || pattern.occurrences || [];
  return `<article class="evidence"><h4>${escapeHtml(pattern.patternName || pattern.pattern)}</h4>
    <p>${escapeHtml(pattern.neutralDescription || pattern.neutralPhrasing || 'possible issue requiring human review')}</p>
    <p><strong>Confidence:</strong> ${escapeHtml(pattern.confidenceLevel || 'Medium')} · <strong>Supporting examples:</strong> ${escapeHtml(pattern.numberOfSupportingExamples || pattern.supportingExampleCount || citations.length)}</p>
    <p><strong>Alternative innocent explanations:</strong> ${escapeHtml((pattern.alternativeInnocentExplanations || []).join(' '))}</p>
    <p><strong>Missing documents needed:</strong> ${escapeHtml((pattern.missingDocumentsNeeded || []).join(', '))}</p>
    <p><strong>Human-review questions:</strong> ${escapeHtml((pattern.humanReviewQuestions || []).join(' '))}</p>
    ${citations.slice(0, 5).map(renderCitation).join('')}
  </article>`;
}

function buildHumanReviewQuestionItems(profiles, actorPatterns, interactionPatterns) {
  const profileQuestions = profiles.flatMap((profile) => [
    `${profile.fullName}: Is identity sufficiently verified beyond last name using ${profile.identityVerificationBasis}?`,
    ...(profile.gal?.humanReviewQuestions || []),
  ]);
  const patternQuestions = [...actorPatterns, ...interactionPatterns].flatMap((pattern) => pattern.humanReviewQuestions || []);
  return uniqueValues([...profileQuestions, ...patternQuestions]).map((question) => `<article class="evidence"><h4>Human-review question</h4><p>${escapeHtml(question)}</p></article>`);
}

function renderSection(title, empty, items) {
  return `<section class="reportSection"><h3>${escapeHtml(title)}</h3>${items.length ? items.join('') : `<p class="empty">${escapeHtml(empty)}</p>`}</section>`;
}

function evidenceItem(title, body, citations) {
  return `<article class="evidence"><h4>${escapeHtml(title)}</h4>${body ? `<p>${escapeHtml(body)}</p>` : ''}${citations.slice(0, 5).map(renderCitation).join('')}</article>`;
}

function renderCitation(citation) {
  return `<blockquote>“${escapeHtml(citation.quote)}”<cite>${escapeHtml(citation.documentName)}, p. ${citation.page}${citation.sourceReference?.locator ? ` · ${escapeHtml(citation.sourceReference.locator)}` : ''}</cite></blockquote>`;
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
