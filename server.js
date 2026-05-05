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
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEFAULT_LOCAL_ADMIN_TOKEN = 'local-dev-admin';
const ADMIN_TOKEN = process.env.RECORD_ROOM_ADMIN_TOKEN || DEFAULT_LOCAL_ADMIN_TOKEN;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
let openAiClientPromise;

async function getOpenAiClient() {
  if (!openAiClientPromise) {
    openAiClientPromise = import('openai').then(({ default: OpenAI }) => (
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    ));
  }
  return openAiClientPromise;
}
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
  'official court source', 'appellate opinion', 'trial court order', 'trial court filing', 'transcript', 'public docket',
  'RECAP/PACER record', 'official disciplinary record', 'bar record', 'judicial commission record',
  'prosecutor office/government record', 'news/public source', 'commercial legal research platform',
  'Trellis Law research lead', 'Westlaw manual upload', 'Lexis manual upload', 'UniCourt research lead',
  'Docket Alarm research lead', 'user-submitted document', 'law firm website', 'personal website',
  'marketing profile', 'review', 'social media', 'anonymous', 'unknown source',
];
const reliabilityTags = [
  'verified official source', 'court-record supported', 'filed allegation, not adjudicated', 'appellate finding',
  'disciplinary finding', 'user-submitted', 'unverified allegation', 'self-promotional source',
  'adversarial source', 'anonymous source', 'conflicting information', 'needs admin review',
  'needs official verification', 'do not publish',
];
const professionalRoles = ['judge', 'guardian ad litem', 'attorney', 'prosecutor', 'evaluator', 'court staff', 'agency', 'other'];

const FRONTEND_ROUTES = [
  { path: '/', description: 'Public home and overview', adminAuth: false },
  { path: '/submit', description: 'Public submission page', adminAuth: false },
  { path: '/upload', description: 'Local upload/intake page', adminAuth: false },
  { path: '/search', description: 'Public search page', adminAuth: false },
  { path: '/public-search', description: 'Public search page alias', adminAuth: false },
  { path: '/profiles', description: 'Admin profile manager', adminAuth: false },
  { path: '/review', description: 'Admin review queue', adminAuth: false },
  { path: '/documents', description: 'Admin document list', adminAuth: false },
  { path: '/leads', description: 'Research leads / manual import', adminAuth: false },
  { path: '/scanner', description: 'Scanner jobs placeholders', adminAuth: false },
  { path: '/record-room-submit', description: 'Public submission page alias', adminAuth: false },
  { path: '/admin', description: 'Admin dashboard app shell', adminAuth: IS_PRODUCTION },
  { path: '/admin/scanner', description: 'Admin scanner workspace', adminAuth: IS_PRODUCTION },
  { path: '/admin/review', description: 'Admin review queue', adminAuth: IS_PRODUCTION },
  { path: '/admin/documents', description: 'Admin documents workspace', adminAuth: IS_PRODUCTION },
  { path: '/admin/profiles', description: 'Admin profiles workspace', adminAuth: IS_PRODUCTION },
  { path: '/admin/research-leads', description: 'Admin research leads workspace', adminAuth: IS_PRODUCTION },
  { path: '/admin/raw-results', description: 'Admin raw results workspace', adminAuth: IS_PRODUCTION },
  { path: '/admin/settings', description: 'Admin settings workspace', adminAuth: IS_PRODUCTION },
  { path: '/routes', description: 'Local development route inventory', adminAuth: false, localOnly: true },
];

const API_ROUTES = [
  { method: 'GET', path: '/health', description: 'Public server/database health check', adminAuth: false },
  { method: 'GET', path: '/api/health', description: 'Public API health check', adminAuth: false },
  { method: 'GET', path: '/api/config', description: 'Public frontend configuration', adminAuth: false },
  { method: 'POST', path: '/api/uploads/local', description: 'Local/admin upload intake', adminAuth: false },
  { method: 'POST', path: '/api/submissions/public', description: 'Public submission upload intake', adminAuth: false },
  { method: 'GET', path: '/api/public/search', description: 'Approved public record search', adminAuth: false },
  { method: 'POST', path: '/api/analyze', description: 'OpenAI source-bound analysis helper', adminAuth: false },
  { method: 'POST', path: '/api/admin/login', description: 'Admin token login helper', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/stats', description: 'Admin dashboard counts', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/uploads', description: 'Admin upload review queue', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/documents/flow', description: 'Documents flow list for upload/indexing', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/documents/ask', description: 'Ask AI using only indexed documents', adminAuth: IS_PRODUCTION },
  { method: 'DELETE', path: '/api/admin/documents/:id', description: 'Delete uploaded test document', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/uploads/export.csv', description: 'Admin CSV export', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/profiles', description: 'Admin profile list', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/profiles', description: 'Admin profile creation', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/research-leads', description: 'Research lead list', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/research-leads', description: 'Research lead creation', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/scanner-jobs', description: 'Scanner jobs list', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/scanner-jobs', description: 'Scanner placeholder job creation', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/uploads/:id/download', description: 'Admin original-file download', adminAuth: IS_PRODUCTION },
  { method: 'GET', path: '/api/admin/uploads/:id/text', description: 'Admin extracted text', adminAuth: IS_PRODUCTION },
  { method: 'PATCH', path: '/api/admin/uploads/:id', description: 'Admin upload metadata/status update', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/uploads/:id/create-profile', description: 'Admin profile creation from upload', adminAuth: IS_PRODUCTION },
  { method: 'POST', path: '/api/admin/uploads/:id/assign-profile/:profileId', description: 'Admin upload/profile assignment', adminAuth: IS_PRODUCTION },
];

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
    if (url.pathname === '/routes' && request.method === 'GET') return handleRoutesPage(response);
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
      if (IS_PRODUCTION) {
        console.log('Admin API protection enabled for production. Set RECORD_ROOM_ADMIN_TOKEN to a strong value.');
      } else {
        console.log(`Local development admin token: ${ADMIN_TOKEN}`);
        console.log(`Open the local admin dashboard without headers: http://localhost:${PORT}/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`);
      }
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
    applySafeMigrations();
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
  state TEXT,
  county TEXT,
  court TEXT,
  source_connector TEXT,
  keyword_group TEXT,
  custom_keywords TEXT,
  person_name TEXT,
  role TEXT,
  case_type TEXT,
  date_from TEXT,
  date_to TEXT,
  max_results INTEGER,
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
  source_platform TEXT,
  source_url TEXT,
  acquisition_method TEXT,
  case_name TEXT,
  case_number TEXT,
  state TEXT,
  county TEXT,
  court TEXT,
  judge TEXT,
  guardian_ad_litem TEXT,
  attorneys TEXT,
  prosecutor TEXT,
  evaluator TEXT,
  document_title TEXT,
  docket_entry_text TEXT,
  filing_date TEXT,
  tags TEXT,
  verification_source TEXT,
  attachment_path TEXT,
  attachment_filename TEXT,
  status TEXT NOT NULL DEFAULT 'new lead',
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

function applySafeMigrations() {
  const addColumns = {
    documents: { document_title: 'TEXT', source_name: 'TEXT', document_hash: 'TEXT', text_hash: 'TEXT', confidence_score: 'REAL DEFAULT 0' },
    profiles: { normalized_name: 'TEXT', aliases: 'TEXT', associated_documents: 'TEXT', associated_claims: 'TEXT', source_summary: 'TEXT', public_notes: 'TEXT', profile_status: "TEXT DEFAULT 'new profile'", visibility: "TEXT DEFAULT 'private'" },
    research_leads: { source_platform: 'TEXT', acquisition_method: 'TEXT', case_name: 'TEXT', case_number: 'TEXT', state: 'TEXT', county: 'TEXT', court: 'TEXT', judge: 'TEXT', guardian_ad_litem: 'TEXT', attorneys: 'TEXT', prosecutor: 'TEXT', evaluator: 'TEXT', document_title: 'TEXT', docket_entry_text: 'TEXT', filing_date: 'TEXT', tags: 'TEXT', verification_source: 'TEXT', attachment_path: 'TEXT', attachment_filename: 'TEXT' },
    scanner_jobs: { state: 'TEXT', county: 'TEXT', court: 'TEXT', source_connector: 'TEXT', keyword_group: 'TEXT', custom_keywords: 'TEXT', person_name: 'TEXT', role: 'TEXT', case_type: 'TEXT', date_from: 'TEXT', date_to: 'TEXT', max_results: 'INTEGER' },
  };
  for (const [table, columns] of Object.entries(addColumns)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const [column, type] of Object.entries(columns)) {
      if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    }
  }
}

function handleRoutesPage(response) {
  if (IS_PRODUCTION) return serveStatic('/index.html', response);
  const routeRows = (routes, includeMethod = false) => routes.map((route) => `
    <tr>
      ${includeMethod ? `<td><code>${escapeHtml(route.method)}</code></td>` : ''}
      <td><code>${escapeHtml(route.path)}</code></td>
      <td>${escapeHtml(route.description)}</td>
      <td><span class="pill ${route.adminAuth ? 'warn' : 'ok'}">${route.adminAuth ? 'Admin token required in production' : 'Public / no token in local dev'}</span></td>
      <td>${route.localOnly ? 'Local development only' : 'Available'}</td>
    </tr>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Record Room AI routes</title>
  <link rel="stylesheet" href="/src/styles.css" />
</head>
<body>
  <main class="routesPage page-shell">
    <section class="card panel">
      <p class="eyebrow">Local development</p>
      <h1 class="pageTitle">Record Room AI routes</h1>
      <p>This page is visible only when <code>NODE_ENV</code> is not <code>production</code>. Local admin API requests may use the default token <code>${escapeHtml(ADMIN_TOKEN)}</code>, but normal browser page visits do not require custom headers.</p>
      <p><a class="buttonLink" href="/admin?token=${encodeURIComponent(ADMIN_TOKEN)}">Open admin dashboard</a> <a class="buttonLink" href="/api/health">View API health JSON</a></p>
    </section>
    <section class="card panel">
      <h2>Frontend routes</h2>
      <div class="table-wrap tableWrap"><table><thead><tr><th>Route</th><th>Description</th><th>Admin auth</th><th>Status</th></tr></thead><tbody>${routeRows(FRONTEND_ROUTES)}</tbody></table></div>
    </section>
    <section class="card panel">
      <h2>API routes</h2>
      <div class="table-wrap tableWrap"><table><thead><tr><th>Method</th><th>Route</th><th>Description</th><th>Admin auth</th><th>Status</th></tr></thead><tbody>${routeRows(API_ROUTES, true)}</tbody></table></div>
    </section>
  </main>
</body>
</html>`;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

async function handleSetup(response) {
  ensureReady.done = false;
  const result = await initializeDatabase();
  ensureReady.done = true;
  sendJson(response, 200, { message: 'Setup completed successfully.', dataRoot: DATA_ROOT, databasePath: DB_PATH, tables: result.tables });
}

async function routeApi(request, response, url) {
  if (!checkRateLimit(request)) return sendJson(response, 429, { error: 'Rate limit placeholder: please wait before sending more requests.' });
  if (url.pathname === '/api/health' && request.method === 'GET') return handleHealth(response);
  if (url.pathname === '/api/config') return sendJson(response, 200, { mode: process.env.RECORD_ROOM_MODE || 'local', nodeEnv: process.env.NODE_ENV || 'development', isProduction: IS_PRODUCTION, localDevAdminToken: IS_PRODUCTION ? null : ADMIN_TOKEN, maxFileBytes: MAX_FILE_BYTES, allowedExtensions: [...allowedExtensions], sourceLabels, reliabilityTags, professionalRoles });
  if (url.pathname === '/api/uploads/local' && request.method === 'POST') return handleUpload(request, response, 'local_admin');
  if (url.pathname === '/api/submissions/public' && request.method === 'POST') return handleUpload(request, response, 'public_submission');
  if (url.pathname === '/api/public/search' && request.method === 'GET') return handlePublicSearch(response, url);
  if (url.pathname === '/api/analyze' && request.method === 'POST') return handleAnalyze(request, response);

  if (url.pathname === '/api/admin/login' && request.method === 'POST') return handleAdminLogin(request, response);

  if (!url.pathname.startsWith('/api/admin/')) return sendJson(response, 404, { error: 'Not found.' });
  requireAdmin(request);
  if (url.pathname === '/api/admin/stats' && request.method === 'GET') return handleAdminStats(response);
  if (url.pathname === '/api/admin/uploads' && request.method === 'GET') return handleAdminUploads(response, url);
  if (url.pathname === '/api/admin/uploads/export.csv' && request.method === 'GET') return handleCsvExport(response);
  if (url.pathname === '/api/admin/documents/flow' && request.method === 'GET') return handleDocumentsFlow(response);
  if (url.pathname === '/api/admin/documents/ask' && request.method === 'POST') return handleAskIndexedDocuments(request, response);

  if (url.pathname === '/api/admin/profiles' && request.method === 'GET') return sendJson(response, 200, { profiles: querySql('SELECT * FROM profiles ORDER BY updated_at DESC') });
  if (url.pathname === '/api/admin/profiles' && request.method === 'POST') return handleCreateProfile(request, response);
  if (url.pathname === '/api/admin/research-leads' && request.method === 'GET') return sendJson(response, 200, { leads: querySql('SELECT * FROM research_leads ORDER BY updated_at DESC LIMIT 500') });
  if (url.pathname === '/api/admin/research-leads' && request.method === 'POST') return handleCreateResearchLead(request, response);
  if (url.pathname === '/api/admin/scanner-jobs' && request.method === 'GET') return sendJson(response, 200, { jobs: querySql('SELECT * FROM scanner_jobs ORDER BY updated_at DESC LIMIT 500') });
  if (url.pathname === '/api/admin/scanner-jobs' && request.method === 'POST') return handleCreateScannerJob(request, response);

  const downloadMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/download$/);
  if (downloadMatch && request.method === 'GET') return handleDownload(response, Number(downloadMatch[1]));
  const textMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)\/text$/);
  if (textMatch && request.method === 'GET') return handleExtractedText(response, Number(textMatch[1]));
  const uploadMatch = url.pathname.match(/^\/api\/admin\/uploads\/(\d+)$/);
  if (uploadMatch && request.method === 'PATCH') return handleUpdateUpload(request, response, Number(uploadMatch[1]));
  const documentDeleteMatch = url.pathname.match(/^\/api\/admin\/documents\/(\d+)$/);
  if (documentDeleteMatch && request.method === 'DELETE') return handleDeleteDocument(response, Number(documentDeleteMatch[1]));
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
  const documentHash = crypto.createHash('sha256').update(file.data).digest('hex');
  const textHash = extraction.text ? crypto.createHash('sha256').update(extraction.text).digest('hex') : null;
  const initialStatus = intakeMode === 'local_admin' ? 'private intake' : 'pending';
  const visibility = intakeMode === 'local_admin' ? 'private' : 'private';
  const sourceLabel = normalizeChoice(parsed.fields.source_label || parsed.fields.source_type, sourceLabels, intakeMode === 'public_submission' ? 'user-submitted document' : 'unknown source');
  const reliability = normalizeTags(parsed.fields.reliability_tags || (intakeMode === 'public_submission' ? 'user-submitted,needs admin review,unverified allegation' : 'needs admin review'), reliabilityTags);

  const insert = querySql(`
    INSERT INTO documents (${[
      'created_at','updated_at','intake_mode','review_status','visibility','redaction_status','uploader_name','uploader_email','uploader_role','subject_name','subject_role','court','county','state','case_number','document_type','source_type','source_label','reliability_tags','record_category','description','tags','notes','admin_notes','original_filename','stored_filename','file_path','file_size','mime_type','extracted_text','extraction_status','extraction_message','malware_scan_status','public_summary'
    ].join(',')}) VALUES (${[
      q(now),q(now),q(intakeMode),q(initialStatus),q(visibility),q('not_requested'),q(parsed.fields.uploader_name),q(parsed.fields.uploader_email),q(parsed.fields.uploader_role),q(parsed.fields.subject_name || parsed.fields.case_name),q(parsed.fields.subject_role),q(parsed.fields.court),q(parsed.fields.county),q(parsed.fields.state),q(parsed.fields.case_number),q(parsed.fields.document_type),q(parsed.fields.source_type),q(sourceLabel),q(reliability),q(parsed.fields.record_category),q(parsed.fields.description),q(parsed.fields.tags),q(parsed.fields.notes),q(''),q(file.filename),q(saved.storedName),q(saved.storedPath),Number(file.data.length),q(file.contentType),q(extraction.text),q(extraction.status),q(extraction.message),q('malware scan placeholder - not yet connected'),q('')
    ].join(',')}) RETURNING *;
  `)[0];
  const textPath = await storage.saveExtractedText(insert.id, extraction.text);
  const updated = querySql(`UPDATE documents SET extracted_text_path=${q(textPath)}, document_hash=${q(documentHash)}, text_hash=${q(textHash)}, document_title=${q(parsed.fields.document_title || parsed.fields.document_type || file.filename)}, source_name=${q(parsed.fields.source_name || parsed.fields.source_type)} WHERE id=${Number(insert.id)} RETURNING *;`)[0];
  querySql(`INSERT INTO extracted_text (document_id, text_path, text_content, extraction_status, extraction_message) VALUES (${Number(insert.id)}, ${q(textPath)}, ${q(extraction.text)}, ${q(extraction.status)}, ${q(extraction.message)}) ON CONFLICT(document_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP, text_path=excluded.text_path, text_content=excluded.text_content, extraction_status=excluded.extraction_status, extraction_message=excluded.extraction_message;`);
  querySql(`INSERT INTO review_queue (item_type,item_id,status,notes) VALUES ('document', ${Number(insert.id)}, ${q(intakeMode === 'public_submission' ? 'pending' : 'private intake')}, ${q(intakeMode === 'public_submission' ? 'Public submission pending/private by default.' : 'Local private/admin-only intake.')});`);
  querySql(`INSERT INTO search_index (item_type,item_id,title,body,source_label,reliability_tags) VALUES ('document', ${Number(insert.id)}, ${q(updated.document_title || updated.original_filename)}, ${q([updated.description, extraction.text].filter(Boolean).join('\n'))}, ${q(updated.source_label)}, ${q(updated.reliability_tags)});`);
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
  if (publicOnly) filters.push("review_status IN ('approved','approved public')", "visibility='public'", "redaction_status NOT IN ('needs redaction','sealed/do not publish')");
  const exactMap = { status: 'review_status', visibility: 'visibility', role: 'subject_role', county: 'county', state: 'state', court: 'court', case_number: 'case_number', source_type: 'source_type', source_label: 'source_label', name: 'subject_name' };
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


function handleAdminStats(response) {
  const health = { server: 'running', database: db ? 'connected' : 'disconnected', dataRoot: DATA_ROOT, databasePath: DB_PATH, tables: getTables() };
  const scalar = (sql) => Number(querySql(sql)[0]?.count || 0);
  const stats = {
    totalDocuments: scalar('SELECT COUNT(*) AS count FROM documents;'),
    pendingReviewCount: scalar("SELECT COUNT(*) AS count FROM documents WHERE review_status IN ('pending','needs redaction','needs official source verification','private intake');") + scalar("SELECT COUNT(*) AS count FROM review_queue WHERE status='pending';"),
    publicApprovedCount: scalar("SELECT COUNT(*) AS count FROM documents WHERE review_status IN ('approved','approved public') AND visibility='public' AND redaction_status NOT IN ('needs redaction','sealed/do not publish');"),
    privateAdminOnlyCount: scalar("SELECT COUNT(*) AS count FROM documents WHERE visibility IN ('private','admin-only');"),
    profilesCount: scalar('SELECT COUNT(*) AS count FROM profiles;'),
    researchLeadsCount: scalar('SELECT COUNT(*) AS count FROM research_leads;'),
    scannerJobsCount: scalar('SELECT COUNT(*) AS count FROM scanner_jobs;'),
  };
  sendJson(response, 200, { health, stats });
}

async function handleCreateResearchLead(request, response) {
  const parsed = await parseMultipart(request);
  const fields = parsed.fields;
  let attachment = { storedPath: null, storedName: null };
  const file = uploadFieldNames.map((name) => parsed.files[name]).find(Boolean);
  if (file) {
    const validation = validateUploadedFile(file);
    if (validation) return sendJson(response, 400, { error: validation });
    attachment = await storage.saveOriginal({ data: file.data, extension: path.extname(file.filename).toLowerCase() });
    attachment.originalName = file.filename;
  }
  const now = new Date().toISOString();
  const leadText = fields.docket_entry_text || fields.document_title || fields.case_name || 'Manual research lead';
  const columns = ['created_at','updated_at','lead_text','source_platform','source_url','acquisition_method','case_name','case_number','state','county','court','judge','guardian_ad_litem','attorneys','prosecutor','evaluator','document_title','docket_entry_text','filing_date','notes','tags','verification_source','status','attachment_path','attachment_filename'];
  const values = [now, now, leadText, fields.source_platform, fields.source_url, fields.acquisition_method, fields.case_name, fields.case_number, fields.state, fields.county, fields.court, fields.judge, fields.guardian_ad_litem, fields.attorneys, fields.prosecutor, fields.evaluator, fields.document_title, fields.docket_entry_text, fields.filing_date, fields.notes, fields.tags, fields.verification_source, fields.status || 'new lead', attachment.storedPath, attachment.originalName || attachment.storedName];
  const row = querySql(`INSERT INTO research_leads (${columns.join(',')}) VALUES (${values.map(q).join(',')}) RETURNING *;`)[0];
  querySql(`INSERT INTO review_queue (item_type,item_id,status,notes) VALUES ('research_lead', ${Number(row.id)}, ${q(row.status)}, 'Manual/import lead requires review and official-source verification when possible.');`);
  sendJson(response, 201, { lead: row });
}

async function handleCreateScannerJob(request, response) {
  const body = await readJsonBody(request);
  const now = new Date().toISOString();
  const columns = ['created_at','updated_at','status','query','message','state','county','court','source_connector','keyword_group','custom_keywords','person_name','role','case_type','date_from','date_to','max_results'];
  const query = [body.keyword_group, body.custom_keywords, body.person_name].filter(Boolean).join(' | ');
  const values = [now, now, body.status || 'new result', query, 'Connector placeholder only; no uncontrolled scraping. Results must go to review first.', body.state, body.county, body.court, body.source_connector, body.keyword_group, body.custom_keywords, body.person_name, body.role, body.case_type, body.date_from, body.date_to, body.max_results || 25];
  const row = querySql(`INSERT INTO scanner_jobs (${columns.join(',')}) VALUES (${values.map(q).join(',')}) RETURNING *;`)[0];
  querySql(`INSERT INTO review_queue (item_type,item_id,status,notes) VALUES ('scanner_job', ${Number(row.id)}, 'pending', 'Scanner job placeholder created; no records become public automatically.');`);
  sendJson(response, 201, { job: row });
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
  try {
    const client = await getOpenAiClient();
    const result = await client.responses.create({
      model: OPENAI_MODEL,
      instructions: 'Create a source-bound Record Room summary. Separate verified official information, court-record-supported information, user-submitted allegations, unresolved/conflicting information, self-promotional sources, and marketing/review-based sources. Every claim must cite a supplied document id/source record.',
      input: JSON.stringify(payload),
      max_output_tokens: 1800,
    });
    sendJson(response, 200, { analysis: result.output_text || extractResponseText(result), model: result.model || OPENAI_MODEL, responseId: result.id });
  } catch (error) {
    console.error('[analyze] OpenAI API error:', error);
    return sendJson(response, error.status || 500, { error: error.message || 'The OpenAI API request failed.' });
  }
}

function extractResponseText(result) {
  return (result.output || []).flatMap((item) => item.content || []).map((content) => content.text || '').filter(Boolean).join('\n').trim();
}


function mapDocumentFlowStatus(row) {
  const uploadStatusLabel = row.review_status === 'rejected' ? 'Failed' : 'Uploaded';
  let aiIndexingStatusLabel = 'Processing';
  if (row.extraction_status === 'failed') aiIndexingStatusLabel = 'Failed';
  else if (row.extraction_status === 'processed') aiIndexingStatusLabel = 'Indexed for AI';
  return { ...publicSafeDocument(row, true), uploadStatusLabel, aiIndexingStatusLabel };
}

function handleDocumentsFlow(response) {
  const rows = querySql(`SELECT id, created_at, original_filename, file_size, review_status, extraction_status FROM documents ORDER BY created_at DESC LIMIT 500;`);
  sendJson(response, 200, { uploadDirectory: UPLOAD_DIR, documents: rows.map(mapDocumentFlowStatus) });
}

function handleDeleteDocument(response, id) {
  const doc = querySql(`SELECT id, file_path, extracted_text_path FROM documents WHERE id=${Number(id)};`)[0];
  if (!doc) return sendJson(response, 404, { error: 'Document not found.' });
  querySql(`DELETE FROM documents WHERE id=${Number(id)};`);
  if (doc.file_path) fss.rmSync(doc.file_path, { force: true });
  if (doc.extracted_text_path) fss.rmSync(doc.extracted_text_path, { force: true });
  sendJson(response, 200, { message: 'Document deleted.' });
}

async function handleAskIndexedDocuments(request, response) {
  const body = await readJsonBody(request);
  const question = String(body.question || '').trim();
  console.log('[documents/ask] question received:', question);
  if (!question) return sendJson(response, 400, { error: 'Question is required.' });
  const docs = querySql(`SELECT id, original_filename, extracted_text, extracted_text_path FROM documents WHERE extraction_status='processed' ORDER BY updated_at DESC LIMIT 8;`);
  console.log(`[documents/ask] documents found: ${docs.length}`);
  if (!docs.length) return sendJson(response, 400, { error: 'No indexed documents yet. Upload files and wait for "Indexed for AI" status.' });

  const allChunks = [];
  for (const doc of docs) {
    let text = String(doc.extracted_text || '').trim();
    if (!text && doc.extracted_text_path) {
      text = await fs.readFile(doc.extracted_text_path, 'utf8').catch(() => '');
    }
    if (!text) continue;
    const chunkSize = 1800;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunkText = text.slice(i, i + chunkSize).trim();
      if (!chunkText) continue;
      allChunks.push({
        documentId: doc.id,
        filename: doc.original_filename,
        chunkIndex: Math.floor(i / chunkSize) + 1,
        text: chunkText,
      });
    }
  }
  const chunks = selectChunksForQuestion(question, allChunks);
  console.log(`[documents/ask] chunks retrieved: ${chunks.length}`);
  console.log(`[documents/ask] documents used: ${Array.from(new Set(chunks.map((chunk) => `${chunk.documentId}:${chunk.filename}`))).join(', ')}`);
  for (const chunk of chunks) {
    console.log(`[documents/ask] chunk d${chunk.documentId}#${chunk.chunkIndex} preview: ${chunk.text.slice(0, 200).replace(/\s+/g, ' ')}`);
  }
  if (!chunks.length) {
    return sendJson(response, 200, {
      answer: 'No indexed text chunks were found for the selected documents. Re-process extraction or upload a text-readable document.',
      indexedDocumentCount: docs.length,
      chunkCount: 0,
      noChunks: true,
    });
  }
  if (!OPENAI_API_KEY) return sendJson(response, 200, { answer: `Indexed documents found (${docs.length}) and ${chunks.length} chunk(s) retrieved, but OPENAI_API_KEY is not set.`, indexedDocumentCount: docs.length, chunkCount: chunks.length });
  const context = chunks.map((chunk) => `Document #${chunk.documentId} (${chunk.filename}) chunk ${chunk.chunkIndex}:\n${chunk.text}`).join('\n\n');
  try {
    const client = await getOpenAiClient();
    const result = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: `You are a legal document analysis system.\n\nYou MUST answer using ONLY the provided context.\n\nDO NOT say 'I could not find the information' unless the information is clearly not present.\n\nFor transcripts:\n- Names of judges, defendants, and parties are usually near the beginning\n- If names appear, extract them exactly as written\n\nIf asked:\n- 'who is the judge' → return the judge’s name\n- 'who is the defendant' → return the defendant’s name\n- 'what was happening in court' → summarize the hearing\n\nIf partially found:\n- Return what you DO see in the text\n\nBe direct, do not hedge, do not over-refuse.` },
        { role: 'user', content: `Question: ${question}\n\nIndexed document excerpts:\n${context}` },
      ],
      max_output_tokens: 800,
    });
    const answer = result.output_text || extractResponseText(result);
    console.log('[documents/ask] AI response:', answer);
    sendJson(response, 200, { answer, indexedDocumentCount: docs.length, chunkCount: chunks.length });
  } catch (error) {
    console.error('[documents/ask] OpenAI API error:', error);
    return sendJson(response, error.status || 500, { error: error.message || 'The OpenAI API request failed.' });
  }
}

function selectChunksForQuestion(question, chunks) {
  if (!chunks.length) return [];
  const normalizedQuestion = String(question || '').toLowerCase();
  const semanticTerms = new Set(normalizedQuestion.match(/[a-z0-9]+/g) || []);
  const keywordTerms = ['judge', 'court', 'defendant', 'petitioner', 'respondent', 'case', 'hearing', 'transcript', 'state', 'vs', 'docket'];
  const requiredFirstChunksByDoc = new Map();
  const scored = [];

  for (const chunk of chunks) {
    if (chunk.chunkIndex <= 5) {
      if (!requiredFirstChunksByDoc.has(chunk.documentId)) requiredFirstChunksByDoc.set(chunk.documentId, []);
      const list = requiredFirstChunksByDoc.get(chunk.documentId);
      if (list.length < 5) list.push(chunk);
    }

    const text = chunk.text.toLowerCase();
    let semanticScore = 0;
    for (const term of semanticTerms) {
      if (term.length > 2 && text.includes(term)) semanticScore += 2;
    }
    let keywordScore = 0;
    for (const keyword of keywordTerms) {
      if (text.includes(keyword)) keywordScore += 3;
    }
    scored.push({ chunk, score: semanticScore + keywordScore + (chunk.chunkIndex <= 5 ? 4 : 0) });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = [];
  const seen = new Set();

  for (const [, firstChunks] of requiredFirstChunksByDoc) {
    for (const chunk of firstChunks.slice(0, 5)) {
      const key = `${chunk.documentId}:${chunk.chunkIndex}`;
      if (!seen.has(key)) {
        selected.push(chunk);
        seen.add(key);
      }
    }
  }

  for (const item of scored) {
    if (selected.length >= 20) break;
    const key = `${item.chunk.documentId}:${item.chunk.chunkIndex}`;
    if (!seen.has(key)) {
      selected.push(item.chunk);
      seen.add(key);
    }
  }

  if (selected.length < 10) {
    for (const item of scored) {
      const key = `${item.chunk.documentId}:${item.chunk.chunkIndex}`;
      if (!seen.has(key)) {
        selected.push(item.chunk);
        seen.add(key);
      }
      if (selected.length >= 10) break;
    }
  }

  return selected.slice(0, 20);
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

async function handleAdminLogin(request, response) {
  const body = request.method === 'POST' ? await readJsonBody(request).catch(() => ({})) : {};
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const token = body.token || request.headers['x-admin-token'] || requestUrl.searchParams.get('token');
  if (!IS_PRODUCTION || token === ADMIN_TOKEN) {
    return sendJson(response, 200, {
      token: ADMIN_TOKEN,
      message: IS_PRODUCTION
        ? 'Admin token accepted.'
        : 'Local development admin login accepted. Replace with real authentication before production.',
    });
  }
  sendJson(response, 401, { error: 'Admin token is required for this API route.' });
}

function requireAdmin(request) {
  if (!IS_PRODUCTION) return;
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const token = request.headers['x-admin-token'] || requestUrl.searchParams.get('token');
  if (token !== ADMIN_TOKEN) throw Object.assign(new Error('Admin token is required for this API route.'), { status: 401 });
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
