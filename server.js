const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_ROOT = path.resolve(process.env.RECORD_ROOM_DATA_DIR || path.join(ROOT, 'record-room-data'));
const UPLOAD_DIR = process.env.RECORD_ROOM_UPLOAD_DIR || path.join(DATA_ROOT, 'uploads');
const TEXT_DIR = process.env.RECORD_ROOM_TEXT_DIR || path.join(DATA_ROOT, 'extracted-text');
const DB_PATH = process.env.RECORD_ROOM_DB_PATH || path.join(DATA_ROOT, 'database.sqlite');
const ADMIN_TOKEN = process.env.RECORD_ROOM_ADMIN_TOKEN || 'local-dev-admin';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const REQUIRED_TABLES = [
  'sources', 'scanner_jobs', 'raw_results', 'documents', 'extracted_text', 'profiles', 'profile_aliases',
  'claims', 'claim_sources', 'review_queue', 'research_leads', 'search_index',
];

let db;

const allowedExtensions = new Set(['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png']);
const allowedMimePrefixes = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/jpeg', 'image/png']);
const uploadFieldNames = ['file', 'documents', 'document'];
const rateBuckets = new Map();

const sourceLabels = [
  'official disciplinary record', 'court order', 'appellate opinion', 'trial court filing', 'transcript', 'public docket',
  'government record', 'bar record', 'judicial commission record', 'news article', 'user-submitted document', 'review',
  'law firm website', 'personal website', 'marketing profile', 'social media', 'unknown source',
];
const reliabilityTags = [
  'verified official source', 'court-record supported', 'user-submitted', 'unverified allegation', 'self-promotional source',
  'adversarial source', 'anonymous source', 'conflicting sources', 'needs admin review',
];
const professionalRoles = ['judge', 'guardian ad litem', 'attorney', 'prosecutor', 'evaluator', 'court staff', 'other legal professional', 'other'];

const storage = {
  async saveOriginal(upload) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${Date.now()}-${crypto.randomUUID()}${upload.extension}`;
    const storedPath = path.join(UPLOAD_DIR, storedName);
    await fs.writeFile(storedPath, upload.data);
    return { storedName, storedPath };
  },
  async saveExtractedText(documentId, text) {
    await fs.mkdir(TEXT_DIR, { recursive: true });
    const textPath = path.join(TEXT_DIR, `${documentId}.txt`);
    await fs.writeFile(textPath, text || '', 'utf8');
    return textPath;
  },
};

const server = http.createServer(async (request, response) => {
  try {
    await ensureReady();
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/health' && request.method === 'GET') return handleHealth(response);
    if (url.pathname === '/setup' && (request.method === 'GET' || request.method === 'POST')) return handleSetup(response);
    if (url.pathname.startsWith('/api/')) {
      await routeApi(request, response, url);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message || 'Unexpected server error.' });
  }
});

ensureReady()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Record Room AI running at http://localhost:${PORT}`);
      console.log('Admin dashboard placeholder token:', ADMIN_TOKEN);
    });
  })
  .catch((error) => {
    console.error('[startup] Failed to initialize Record Room AI.');
    console.error(error);
    process.exit(1);
  });

async function ensureReady() {
  if (ensureReady.done) return;
  console.log(`[startup] Project root path: ${ROOT}`);
  console.log(`[startup] Data root path: ${DATA_ROOT}`);
  console.log(`[startup] Database file path: ${DB_PATH}`);
  await initializeDatabase();
  ensureReady.done = true;
}

async function initializeDatabase() {
  try {
    await fs.mkdir(DATA_ROOT, { recursive: true });
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.mkdir(TEXT_DIR, { recursive: true });
    if (!fss.existsSync(DB_PATH)) fss.closeSync(fss.openSync(DB_PATH, 'a'));

    if (!db) {
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      console.log('[startup] Database connected successfully.');
    }

    runSql(SCHEMA_SQL);
    const tables = getTables();
    const missingTables = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    if (missingTables.length) throw new Error(`Schema initialized but required tables are missing: ${missingTables.join(', ')}`);
    console.log(`[startup] Schema initialized successfully. Tables: ${tables.join(', ')}`);
    return { tables };
  } catch (error) {
    console.error(`[sqlite] Exact SQL error: ${error.message}`);
    throw error;
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  name TEXT NOT NULL,
  source_type TEXT,
  source_label TEXT DEFAULT 'unknown source',
  url TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS scanner_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending',
  source_id INTEGER,
  query TEXT,
  message TEXT,
  FOREIGN KEY(source_id) REFERENCES sources(id)
);
CREATE TABLE IF NOT EXISTS raw_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scanner_job_id INTEGER,
  source_id INTEGER,
  title TEXT,
  url TEXT,
  raw_json TEXT,
  processed_status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY(scanner_job_id) REFERENCES scanner_jobs(id),
  FOREIGN KEY(source_id) REFERENCES sources(id)
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  intake_mode TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  visibility TEXT NOT NULL DEFAULT 'private',
  redaction_status TEXT NOT NULL DEFAULT 'not_requested',
  uploader_name TEXT,
  uploader_email TEXT,
  uploader_role TEXT,
  subject_name TEXT,
  subject_role TEXT,
  court TEXT,
  county TEXT,
  state TEXT,
  case_number TEXT,
  document_type TEXT,
  source_type TEXT,
  source_label TEXT DEFAULT 'unknown source',
  reliability_tags TEXT DEFAULT 'needs admin review',
  record_category TEXT,
  description TEXT,
  tags TEXT,
  notes TEXT,
  admin_notes TEXT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  extracted_text_path TEXT,
  extracted_text TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_message TEXT,
  malware_scan_status TEXT NOT NULL DEFAULT 'placeholder_pending',
  public_summary TEXT,
  source_id INTEGER,
  raw_result_id INTEGER,
  ai_summary_json TEXT DEFAULT '{"verifiedOfficialInformation":[],"courtRecordSupportedInformation":[],"userSubmittedAllegations":[],"unresolvedOrConflictingInformation":[],"selfPromotionalSources":[],"marketingOrReviewBasedSources":[]}',
  FOREIGN KEY(source_id) REFERENCES sources(id),
  FOREIGN KEY(raw_result_id) REFERENCES raw_results(id)
);
CREATE TABLE IF NOT EXISTS extracted_text (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  text_path TEXT,
  text_content TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_message TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  court_office_firm TEXT,
  county TEXT,
  state TEXT,
  bar_number TEXT,
  known_cases TEXT,
  allegations_categories TEXT,
  official_discipline TEXT,
  court_record_supported_issues TEXT,
  user_submitted_complaints TEXT,
  news_public_source_references TEXT,
  source_reliability_summary TEXT,
  admin_notes TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  source_bound_summary_json TEXT DEFAULT '{"verifiedOfficialInformation":[],"courtRecordSupportedInformation":[],"userSubmittedAllegations":[],"unresolvedOrConflictingInformation":[],"selfPromotionalSources":[],"marketingOrReviewBasedSources":[]}'
);
CREATE TABLE IF NOT EXISTS profile_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, alias),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS profile_documents (
  profile_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, document_id),
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER,
  document_id INTEGER NOT NULL,
  claim_text TEXT NOT NULL,
  summary_bucket TEXT NOT NULL,
  source_label TEXT NOT NULL,
  reliability_tags TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS claim_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  document_id INTEGER,
  source_id INTEGER,
  raw_result_id INTEGER,
  citation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE SET NULL,
  FOREIGN KEY(raw_result_id) REFERENCES raw_results(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS research_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  profile_id INTEGER,
  lead_text TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(subject_name, court, county, state, case_number, source_type, source_label, tags, extracted_text, content='documents', content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(item_type, item_id UNINDEXED, title, body, source_label, reliability_tags);
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, subject_name, court, county, state, case_number, source_type, source_label, tags, extracted_text)
  VALUES (new.id, new.subject_name, new.court, new.county, new.state, new.case_number, new.source_type, new.source_label, new.tags, new.extracted_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, subject_name, court, county, state, case_number, source_type, source_label, tags, extracted_text)
  VALUES('delete', old.id, old.subject_name, old.court, old.county, old.state, old.case_number, old.source_type, old.source_label, old.tags, old.extracted_text);
  INSERT INTO documents_fts(rowid, subject_name, court, county, state, case_number, source_type, source_label, tags, extracted_text)
  VALUES (new.id, new.subject_name, new.court, new.county, new.state, new.case_number, new.source_type, new.source_label, new.tags, new.extracted_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, subject_name, court, county, state, case_number, source_type, source_label, tags, extracted_text)
  VALUES('delete', old.id, old.subject_name, old.court, old.county, old.state, old.case_number, old.source_type, old.source_label, old.tags, old.extracted_text);
END;
`;

function handleHealth(response) {
  sendJson(response, 200, { server: 'running', database: db ? 'connected' : 'disconnected', dataRoot: DATA_ROOT, databasePath: DB_PATH, tables: getTables() });
}

async function handleSetup(response) {
  ensureReady.done = false;
  const result = await initializeDatabase();
  ensureReady.done = true;
  sendJson(response, 200, { message: 'Setup completed successfully.', dataRoot: DATA_ROOT, databasePath: DB_PATH, tables: result.tables });
}

async function routeApi(request, response, url) {
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: 'Rate limit placeholder: please wait before sending more requests.' });
  if (url.pathname === '/api/config') return sendJson(response, 200, { mode: process.env.RECORD_ROOM_MODE || 'local', maxFileBytes: MAX_FILE_BYTES, allowedExtensions: [...allowedExtensions], sourceLabels, reliabilityTags, professionalRoles });
  if (url.pathname === '/api/uploads/local' && request.method === 'POST') return handleUpload(request, response, 'local_admin');
  if (url.pathname === '/api/submissions/public' && request.method === 'POST') return handleUpload(request, response, 'public_submission');
  if (url.pathname === '/api/public/search' && request.method === 'GET') return handlePublicSearch(response, url);
  if (url.pathname === '/api/analyze' && request.method === 'POST') return handleAnalyze(request, response);

  if (url.pathname === '/api/admin/login' && request.method === 'POST') return sendJson(response, 200, { token: ADMIN_TOKEN, message: 'Admin login placeholder accepted for local development. Replace before production.' });
  requireAdmin(request);
  if (url.pathname === '/api/admin/uploads' && request.method === 'GET') return handleAdminUploads(response, url);
  if (url.pathname === '/api/admin/uploads/export.csv' && request.method === 'GET') return handleCsvExport(response);
  if (url.pathname === '/api/admin/profiles' && request.method === 'GET') return sendJson(response, 200, { profiles: querySql('SELECT * FROM profiles ORDER BY updated_at DESC') });
  if (url.pathname === '/api/admin/profiles' && request.method === 'POST') return handleCreateProfile(request, response);

  const downloadMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/download$/);
  if (downloadMatch && request.method === 'GET') return handleDownload(response, Number(downloadMatch[1]));
  const textMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/text$/);
  if (textMatch && request.method === 'GET') return handleExtractedText(response, Number(textMatch[1]));
  const uploadMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)$/);
  if (uploadMatch && request.method === 'PATCH') return handleUpdateUpload(request, response, Number(uploadMatch[1]));
  const profileFromMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/create-profile$/);
  if (profileFromMatch && request.method === 'POST') return handleCreateProfileFromUpload(response, Number(profileFromMatch[1]));
  const assignMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/assign-profile\/(\d+)$/);
  if (assignMatch && request.method === 'POST') return handleAssignProfile(response, Number(assignMatch[1]), Number(assignMatch[2]));

  sendJson(response, 404, { error: 'Not found.' });
}

async function handleUpload(request, response, intakeMode) {
  const parsed = await parseMultipart(request);
  const file = uploadFieldNames.map((name) => parsed.files[name]).find(Boolean);
  if (!file) return sendJson(response, 400, { error: 'A document file is required.' });
  const validation = validateUploadedFile(file);
  if (validation) return sendJson(response, 400, { error: validation });
  if (intakeMode === 'public_submission') {
    const missingWarning = ['warning_no_sealed', 'warning_no_guarantee', 'warning_review_redact', 'warning_good_faith', 'warning_labels'].find((field) => parsed.fields[field] !== 'on' && parsed.fields[field] !== 'true');
    if (missingWarning) return sendJson(response, 400, { error: 'All public submission warnings must be checked before submission.' });
  }

  const now = new Date().toISOString();
  const extension = path.extname(file.filename).toLowerCase();
  const saved = await storage.saveOriginal({ data: file.data, extension });
  const extraction = await extractText(file, extension);
  const initialStatus = intakeMode === 'local_admin' ? 'pending' : 'pending';
  const visibility = intakeMode === 'local_admin' ? 'private' : 'private';
  const sourceLabel = normalizeChoice(parsed.fields.source_label || parsed.fields.source_type, sourceLabels, 'unknown source');
  const reliability = normalizeTags(parsed.fields.reliability_tags || (intakeMode === 'public_submission' ? 'user-submitted,needs admin review,unverified allegation' : 'needs admin review'), reliabilityTags);

  const insert = querySql(`
    INSERT INTO documents (${[
      'created_at','updated_at','intake_mode','review_status','visibility','redaction_status','uploader_name','uploader_email','uploader_role','subject_name','subject_role','court','county','state','case_number','document_type','source_type','source_label','reliability_tags','record_category','description','tags','notes','admin_notes','original_filename','stored_filename','file_path','file_size','mime_type','extracted_text','extraction_status','extraction_message','malware_scan_status','public_summary'
    ].join(',')}) VALUES (${[
      q(now),q(now),q(intakeMode),q(initialStatus),q(visibility),q('not_requested'),q(parsed.fields.uploader_name),q(parsed.fields.uploader_email),q(parsed.fields.uploader_role),q(parsed.fields.subject_name || parsed.fields.case_name),q(parsed.fields.subject_role),q(parsed.fields.court),q(parsed.fields.county),q(parsed.fields.state),q(parsed.fields.case_number),q(parsed.fields.document_type),q(parsed.fields.source_type),q(sourceLabel),q(reliability),q(parsed.fields.record_category),q(parsed.fields.description),q(parsed.fields.tags),q(parsed.fields.notes),q(''),q(file.filename),q(saved.storedName),q(saved.storedPath),Number(file.data.length),q(file.contentType),q(extraction.text),q(extraction.status),q(extraction.message),q('malware scan placeholder - not yet connected'),q('')
    ].join(',')}) RETURNING *;
  `)[0];
  const textPath = await storage.saveExtractedText(insert.id, extraction.text);
  const updated = querySql(`UPDATE documents SET extracted_text_path=${q(textPath)} WHERE id=${Number(insert.id)} RETURNING *;`)[0];
  querySql(`INSERT INTO extracted_text (document_id, text_path, text_content, extraction_status, extraction_message) VALUES (${Number(insert.id)}, ${q(textPath)}, ${q(extraction.text)}, ${q(extraction.status)}, ${q(extraction.message)}) ON CONFLICT(document_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP, text_path=excluded.text_path, text_content=excluded.text_content, extraction_status=excluded.extraction_status, extraction_message=excluded.extraction_message;`);
  sendJson(response, 201, { message: intakeMode === 'local_admin' ? 'Document saved to your local Record Room database.' : 'Your submission has been received for review. Submission does not guarantee publication.', document: publicSafeDocument(updated, true) });
}

function validateUploadedFile(file) {
  const extension = path.extname(file.filename || '').toLowerCase();
  if (!allowedExtensions.has(extension)) return 'Unsupported file type. Accepted: PDF, DOCX, DOC, TXT, JPG, JPEG, PNG.';
  if (file.data.length > MAX_FILE_BYTES) return 'File is too large. Maximum size is 25 MB per file.';
  const mime = (file.contentType || '').split(';')[0].toLowerCase();
  if (mime && !allowedMimePrefixes.has(mime) && mime !== 'application/octet-stream') return 'File MIME type is not allowed.';
  return '';
}

async function extractText(file, extension) {
  try {
    if (extension === '.txt') return { text: file.data.toString('utf8'), status: 'processed', message: 'TXT text extracted on the server.' };
    if (extension === '.docx') {
      const tmp = path.join(os.tmpdir(), `record-room-${crypto.randomUUID()}.docx`);
      await fs.writeFile(tmp, file.data);
      const result = spawnSync('unzip', ['-p', tmp, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
      await fs.rm(tmp, { force: true });
      if (result.status === 0 && result.stdout) return { text: xmlToText(result.stdout), status: 'processed', message: 'DOCX text extracted with the local unzip parser.' };
      return { text: '', status: 'failed', message: 'DOCX text extraction failed; original file retained.' };
    }
    if (extension === '.pdf') {
      const text = extractPdfLikeText(file.data);
      if (text.trim().length > 40) return { text, status: 'processed', message: 'Best-effort embedded PDF text extracted; scanned PDFs may need OCR.' };
      return { text: '', status: 'pending', message: 'PDF OCR/text extraction placeholder: original retained for a private parser or OCR worker.' };
    }
    if (['.jpg', '.jpeg', '.png'].includes(extension)) return { text: '', status: 'pending', message: 'OCR placeholder for image upload; original retained for review.' };
    if (extension === '.doc') return { text: '', status: 'pending', message: 'Legacy DOC parser placeholder; original retained for review.' };
    return { text: '', status: 'pending', message: 'Extraction pending.' };
  } catch (error) {
    return { text: '', status: 'failed', message: `Extraction failed: ${error.message}` };
  }
}

function extractPdfLikeText(buffer) {
  return buffer.toString('latin1')
    .replace(/\r/g, '\n')
    .match(/[\x09\x0A\x0D\x20-\x7E]{8,}/g)?.join('\n')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 500_000) || '';
}

function xmlToText(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function handleAdminUploads(response, url) {
  const where = buildDocumentWhere(url, false);
  const rows = querySql(`SELECT * FROM documents ${where.sql} ORDER BY created_at DESC LIMIT 500;`);
  sendJson(response, 200, { documents: rows.map((row) => publicSafeDocument(row, true)) });
}

function handlePublicSearch(response, url) {
  const where = buildDocumentWhere(url, true);
  const rows = querySql(`SELECT id, created_at, subject_name, subject_role, court, county, state, case_number, document_type, source_type, source_label, reliability_tags, record_category, description, tags, public_summary, review_status, visibility FROM documents ${where.sql} ORDER BY updated_at DESC LIMIT 100;`);
  sendJson(response, 200, { results: rows });
}

function buildDocumentWhere(url, publicOnly) {
  const filters = [];
  if (publicOnly) filters.push("review_status='approved'", "visibility='public'");
  const exactMap = { status: 'review_status', visibility: 'visibility', role: 'subject_role', county: 'county', state: 'state', court: 'court', case_number: 'case_number', source_type: 'source_type', source_label: 'source_label' };
  for (const [param, column] of Object.entries(exactMap)) if (url.searchParams.get(param)) filters.push(`${column} LIKE ${q(`%${url.searchParams.get(param)}%`)}`);
  if (url.searchParams.get('q')) {
    const term = url.searchParams.get('q');
    filters.push(`(subject_name LIKE ${q(`%${term}%`)} OR tags LIKE ${q(`%${term}%`)} OR extracted_text LIKE ${q(`%${term}%`)} OR description LIKE ${q(`%${term}%`)})`);
  }
  if (url.searchParams.get('allegation_category')) filters.push(`tags LIKE ${q(`%${url.searchParams.get('allegation_category')}%`)}`);
  return { sql: filters.length ? `WHERE ${filters.join(' AND ')}` : '' };
}

async function handleUpdateUpload(request, response, id) {
  const body = await readJsonBody(request);
  const allowed = ['review_status','visibility','redaction_status','subject_name','subject_role','court','county','state','case_number','document_type','source_type','source_label','reliability_tags','record_category','description','tags','notes','admin_notes','public_summary','ai_summary_json'];
  const assignments = [];
  for (const key of allowed) if (Object.hasOwn(body, key)) assignments.push(`${key}=${q(body[key])}`);
  if (!assignments.length) return sendJson(response, 400, { error: 'No editable fields supplied.' });
  assignments.push(`updated_at=${q(new Date().toISOString())}`);
  const rows = querySql(`UPDATE documents SET ${assignments.join(',')} WHERE id=${Number(id)} RETURNING *;`);
  if (!rows.length) return sendJson(response, 404, { error: 'Upload not found.' });
  sendJson(response, 200, { document: publicSafeDocument(rows[0], true) });
}

function handleDownload(response, id) {
  const doc = querySql(`SELECT * FROM documents WHERE id=${Number(id)};`)[0];
  if (!doc) return sendJson(response, 404, { error: 'Upload not found.' });
  response.writeHead(200, { 'Content-Type': doc.mime_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${String(doc.original_filename).replace(/"/g, '')}"` });
  fss.createReadStream(doc.file_path).pipe(response);
}

async function handleExtractedText(response, id) {
  const doc = querySql(`SELECT extracted_text_path, extracted_text, extraction_status, extraction_message FROM documents WHERE id=${Number(id)};`)[0];
  if (!doc) return sendJson(response, 404, { error: 'Upload not found.' });
  let text = doc.extracted_text || '';
  if (!text && doc.extracted_text_path) text = await fs.readFile(doc.extracted_text_path, 'utf8').catch(() => '');
  sendJson(response, 200, { text, extractionStatus: doc.extraction_status, extractionMessage: doc.extraction_message });
}

async function handleCreateProfile(request, response) {
  const body = await readJsonBody(request);
  if (!body.name || !body.role) return sendJson(response, 400, { error: 'Profile name and role are required.' });
  const now = new Date().toISOString();
  const row = querySql(`INSERT INTO profiles (created_at,updated_at,name,role,court_office_firm,county,state,bar_number,known_cases,allegations_categories,official_discipline,court_record_supported_issues,user_submitted_complaints,news_public_source_references,source_reliability_summary,admin_notes,visibility) VALUES (${[q(now),q(now),q(body.name),q(body.role),q(body.court_office_firm),q(body.county),q(body.state),q(body.bar_number),q(body.known_cases),q(body.allegations_categories),q(body.official_discipline),q(body.court_record_supported_issues),q(body.user_submitted_complaints),q(body.news_public_source_references),q(body.source_reliability_summary),q(body.admin_notes),q(body.visibility || 'private')].join(',')}) RETURNING *;`)[0];
  sendJson(response, 201, { profile: row });
}

function handleCreateProfileFromUpload(response, id) {
  const doc = querySql(`SELECT * FROM documents WHERE id=${Number(id)};`)[0];
  if (!doc) return sendJson(response, 404, { error: 'Upload not found.' });
  const now = new Date().toISOString();
  const row = querySql(`INSERT INTO profiles (created_at,updated_at,name,role,court_office_firm,county,state,known_cases,allegations_categories,source_reliability_summary,admin_notes,visibility) VALUES (${[q(now),q(now),q(doc.subject_name || 'Unnamed subject'),q(doc.subject_role || 'other legal professional'),q(doc.court),q(doc.county),q(doc.state),q(doc.case_number),q(doc.tags),q([doc.source_label, doc.reliability_tags].filter(Boolean).join(' · ')),q(`Created from upload ${id}.`),q('private')].join(',')}) RETURNING *;`)[0];
  handleAssignProfile(response, id, row.id, row);
}

function handleAssignProfile(response, documentId, profileId, profile) {
  querySql(`INSERT OR IGNORE INTO profile_documents (profile_id, document_id, created_at) VALUES (${Number(profileId)}, ${Number(documentId)}, ${q(new Date().toISOString())});`);
  sendJson(response, 200, { message: 'Upload assigned to profile.', profile: profile || querySql(`SELECT * FROM profiles WHERE id=${Number(profileId)};`)[0] });
}

function handleCsvExport(response) {
  const rows = querySql('SELECT id,created_at,intake_mode,review_status,visibility,redaction_status,subject_name,subject_role,court,county,state,case_number,document_type,source_type,source_label,reliability_tags,tags,original_filename,extraction_status FROM documents ORDER BY created_at DESC;');
  const headers = Object.keys(rows[0] || { id: '', created_at: '', intake_mode: '', review_status: '', visibility: '' });
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
  response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="record-room-uploads.csv"' });
  response.end(csv);
}

async function handleAnalyze(request, response) {
  if (!OPENAI_API_KEY) return sendJson(response, 503, { error: 'OPENAI_API_KEY is not set on the Node server.' });
  const payload = await readJsonBody(request);
  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, instructions: 'Create a source-bound Record Room summary. Separate verified official information, court-record-supported information, user-submitted allegations, unresolved/conflicting information, self-promotional sources, and marketing/review-based sources. Every claim must cite a supplied document id/source record.', input: JSON.stringify(payload), max_output_tokens: 1800 }),
  });
  const result = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) return sendJson(response, openAiResponse.status, { error: result.error?.message || 'The OpenAI API request failed.' });
  sendJson(response, 200, { analysis: result.output_text || extractResponseText(result), model: result.model || OPENAI_MODEL, responseId: result.id });
}

function extractResponseText(result) {
  return (result.output || []).flatMap((item) => item.content || []).map((content) => content.text || '').filter(Boolean).join('\n').trim();
}

async function parseMultipart(request) {
  const contentType = request.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw Object.assign(new Error('Expected multipart/form-data upload.'), { status: 400 });
  const body = await readBody(request, MAX_BODY_BYTES);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  for (const part of splitBuffer(body, delimiter)) {
    const trimmed = trimPart(part);
    if (!trimmed.length || trimmed.equals(Buffer.from('--'))) continue;
    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const rawHeaders = trimmed.subarray(0, headerEnd).toString('utf8');
    let data = trimmed.subarray(headerEnd + 4);
    if (data.subarray(data.length - 2).toString() === '\r\n') data = data.subarray(0, data.length - 2);
    const disposition = rawHeaders.match(/content-disposition: form-data;([^\r\n]+)/i)?.[1] || '';
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentTypeHeader = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || '';
    if (!name) continue;
    if (filename) files[name] = { filename: path.basename(filename), contentType: contentTypeHeader, data };
    else fields[name] = data.toString('utf8');
  }
  return { fields, files };
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index;
  while ((index = buffer.indexOf(delimiter, start)) !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function trimPart(buffer) {
  let out = buffer;
  if (out.subarray(0, 2).toString() === '\r\n') out = out.subarray(2);
  if (out.subarray(out.length - 2).toString() === '\r\n') out = out.subarray(0, out.length - 2);
  return out;
}

function readBody(request, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJsonBody(request) {
  const raw = await readBody(request);
  return raw.length ? JSON.parse(raw.toString('utf8')) : {};
}

function checkRateLimit(request) {
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + RATE_LIMIT_WINDOW_MS; }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

function requireAdmin(request) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const token = request.headers['x-admin-token'] || requestUrl.searchParams.get('token');
  if (token !== ADMIN_TOKEN) throw Object.assign(new Error('Admin dashboard placeholder requires X-Admin-Token. Set RECORD_ROOM_ADMIN_TOKEN before production.'), { status: 401 });
}

function runSql(sql) {
  if (!db) throw new Error('SQLite database is not connected.');
  try {
    db.exec(sql);
    return [];
  } catch (error) {
    console.error(`[sqlite] Exact SQL error: ${error.message}`);
    console.error(`[sqlite] SQL: ${sql}`);
    throw new Error(error.message);
  }
}

function querySql(sql) {
  if (!db) throw new Error('SQLite database is not connected.');
  try {
    const statement = db.prepare(sql);
    if (statement.reader) return statement.all();
    const info = statement.run();
    return [{ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }];
  } catch (error) {
    console.error(`[sqlite] Exact SQL error: ${error.message}`);
    console.error(`[sqlite] SQL: ${sql}`);
    throw new Error(error.message);
  }
}

function getTables() {
  if (!db) return [];
  const internalFtsSuffixes = ['_data', '_idx', '_content', '_docsize', '_config'];
  return db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    .all()
    .map((row) => row.name)
    .filter((name) => !internalFtsSuffixes.some((suffix) => name.endsWith(suffix)));
}

function q(value) { if (value === undefined || value === null) return 'NULL'; return `'${String(value).replace(/'/g, "''")}'`; }
function normalizeChoice(value, choices, fallback) { const found = choices.find((choice) => choice.toLowerCase() === String(value || '').toLowerCase()); return found || fallback; }
function normalizeTags(value, choices) { const input = String(value || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean); const tags = choices.filter((choice) => input.includes(choice.toLowerCase())); return tags.length ? tags.join(', ') : 'needs admin review'; }
function publicSafeDocument(row, includeAdminFields = false) { const copy = { ...row }; if (!includeAdminFields) delete copy.extracted_text; copy.extraction_preview = String(row.extracted_text || '').slice(0, 500); return copy; }
function csvCell(value) { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

async function serveStatic(pathname, response) {
  const safePath = pathname === '/' || pathname === '/admin' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) return sendJson(response, 403, { error: 'Forbidden.' });
  try {
    const data = await fs.readFile(filePath);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime });
    response.end(data);
  } catch {
    const index = await fs.readFile(path.join(ROOT, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(index);
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
