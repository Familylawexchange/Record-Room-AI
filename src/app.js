const API_BASE = "https://record-room-ai-backend.onrender.com";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const allowedExtensions = ['pdf', 'docx', 'doc', 'txt'];
const roles = ['judge', 'guardian ad litem', 'attorney', 'prosecutor', 'evaluator', 'court staff', 'agency', 'other'];
const profileRoles = ['judges', 'attorneys/lawyers', 'guardians ad litem', 'prosecutors', 'custody evaluators', 'parenting coordinators', 'court staff', 'experts/witnesses', 'agencies/offices', 'other legal professionals'];
const sourcePlatforms = ['Trellis Law', 'Westlaw', 'Lexis', 'UniCourt', 'Docket Alarm', 'vLex/Fastcase', 'PACER', 'CourtListener', 'official court site', 'official appellate court', 'official discipline source', 'news/public source', 'other'];
const leadStatuses = ['new lead', 'needs official source verification', 'verified by official court source', 'document uploaded', 'attached to profile', 'private only', 'approved public', 'rejected', 'duplicate'];
const scannerStatuses = ['new result', 'likely relevant', 'not relevant', 'duplicate', 'needs manual verification', 'needs official source verification', 'needs redaction', 'confidential/blocked', 'sealed/do not publish', 'approved private', 'approved public', 'rejected'];
const reviewStatuses = ['pending', 'approved public', 'approved private', 'rejected', 'needs redaction', 'needs official source verification', 'duplicate', 'sealed/do not publish'];
const states = ['Georgia', 'Florida', 'California', 'Ohio', 'South Carolina', 'Texas'];
const connectors = ['CourtListener / RECAP connector placeholder', 'Georgia appellate opinions placeholder', 'Florida appellate opinions placeholder', 'California appellate opinions placeholder', 'Ohio appellate opinions placeholder', 'South Carolina appellate opinions placeholder', 'Texas appellate opinions placeholder', 'Georgia re:SearchGA placeholder', 'Florida county clerk portal placeholder', 'California county superior court portal placeholder', 'Ohio county clerk/common pleas/domestic relations placeholder', 'South Carolina Public Index placeholder', 'South Carolina C-Track appellate placeholder', 'Texas re:SearchTX placeholder', 'Official bar/judicial discipline placeholder', 'Trellis Law manual/import connector', 'Westlaw/Lexis/UniCourt/Docket Alarm manual/import connector'];
const keywordGroups = {
  'Judicial Recusal / Disqualification': ['motion to recuse', 'motion for recusal', 'motion to disqualify judge', 'judicial disqualification', 'verified statement of disqualification', 'affidavit of bias', 'appearance of impropriety', 'ex parte', 'impartiality', 'bias', 'prejudice'],
  'Guardian ad Litem / GAL': ['guardian ad litem', 'GAL', 'G.A.L.', 'motion to remove guardian ad litem', 'motion to disqualify guardian ad litem', 'motion to strike GAL report', 'guardian ad litem report', 'GAL fees', 'GAL misconduct', 'guardian ad litem bias', 'guardian ad litem ex parte'],
  'Attorney / Prosecutor Misconduct': ['attorney misconduct', 'prosecutorial misconduct', 'conflict of interest', 'sanctions', 'disciplinary order', 'bar complaint', 'ethics complaint', 'motion for sanctions', 'motion to disqualify counsel', 'Brady', 'ex parte communication'],
  'Sealing / Protective Orders / Confidentiality': ['motion to seal', 'protective order', 'confidentiality order', 'sealed record', 'redaction', 'privacy', 'minor child', 'domestic violence', 'protective filing'],
  'Appeals / Reversals': ['reversed', 'vacated', 'remanded', 'abuse of discretion', 'due process', 'fundamental fairness', 'recusal denied', 'GAL report', 'custody', 'divorce', 'family court', 'domestic relations'],
};
let config = { sourceLabels: [], reliabilityTags: [], professionalRoles: roles, localDevAdminToken: null, isProduction: false };
let app;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

async function bootstrap() {
  app = document.querySelector('#app');
  if (!app) return;
  hydrateDirectVisitFromQuery();
  wireNavigation();
  try {
    config = await api('/api/config');
  } catch (error) {
    console.warn('[bootstrap] Failed to load /api/config, using fallback config.', error);
  }
  if (!config.professionalRoles?.length) config.professionalRoles = roles;
  if (!config.sourceLabels?.length) config.sourceLabels = ['official court source', 'user-submitted document', 'Trellis Law research lead', 'unknown source'];
  renderRoute();
  applyLayoutClasses();
}

function applyLayoutClasses() {
  document.querySelectorAll('form label').forEach((label) => label.classList.add('form-field'));
  document.querySelectorAll('button').forEach((button) => {
    if (!button.classList.contains('secondary')) button.classList.add('primary-button');
  });
}

function renderRoute() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  applyTitle(path);
  renderHeader(path);
  if (path === '/admin') renderAdmin();
  else if (path === '/upload') renderUpload();
  else if (path === '/submit' || path === '/record-room-submit') renderSubmit();
  else if (path === '/review') renderReview();
  else if (path === '/documents') renderDocuments();
  else if (path === '/profiles') renderProfiles();
  else if (path === '/leads') renderLeads();
  else if (path === '/scanner') renderScanner();
  else if (path === '/search' || path === '/public-search') renderSearch();
  else if (path === '/health') renderHealth();
  else renderHome();
  wireRoute();
}

function renderHeader(path) {
  const header = document.querySelector('.siteHeader');
  const nav = document.querySelector('.topNav');
  const brand = document.querySelector('.brand');
  if (!header || !nav || !brand) return;
  const internalPaths = new Set(['/admin', '/upload', '/review', '/profiles', '/leads', '/scanner', '/health']);
  const publicLinks = [
    { href: '/', label: 'The Record Room AI' },
    { href: '/submit', label: 'Submit Records' },
    { href: '/documents', label: 'Documents' },
    { href: '/search', label: 'Public Search' },
    { href: '/#about', label: 'About' },
  ];
  const internalLinks = [
    { href: '/admin', label: 'Admin Dashboard' },
    { href: '/upload', label: 'Local Upload' },
    { href: '/review', label: 'Review Queue' },
    { href: '/profiles', label: 'Profiles' },
    { href: '/leads', label: 'Research Leads' },
    { href: '/scanner', label: 'Scanner' },
    { href: '/health', label: 'Health' },
  ];
  const onInternalPage = internalPaths.has(path);
  header.classList.toggle('publicHeader', !onInternalPage);
  brand.innerHTML = `${fleLogoInline()}<span>The Record Room AI</span>`;
  nav.innerHTML = (onInternalPage ? internalLinks : publicLinks).map((link) => {
    const isCurrent = link.href === path
      || (link.href === '/search' && path === '/public-search')
      || (link.href === '/' && path === '/');
    return `<a href="${link.href}" ${isCurrent ? 'aria-current="page"' : ''}>${link.label}</a>`;
  }).join('');
}

function renderHome() {
  app.innerHTML = `<section class="hero card panel"><div><p class="badge">Document-Driven Family Court Accountability</p><h1>Record Room AI</h1><p class="lede">The Record Room AI is a document-driven accountability project built to collect transcripts, court orders, reports, filings, evidence, and other official records from family court and related proceedings. Our goal is to help identify patterns in conduct, decision-making, rule compliance, conflicts, outcomes, and recurring concerns involving guardians ad litem, judges, prosecutors, attorneys, evaluators, agencies, and other court-connected professionals.</p><div class="guardrails"><span>Uploaded records are reviewed before anything is made public.</span><span>The goal is organized, source-based accountability — not rumor, speculation, or automatic publication.</span></div></div></section>${flowPanel()}`;
}


function renderHealth() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Status</p><h2 class="pageTitle">Health</h2><p class="formIntro">Frontend routing is healthy.</p><p><strong>Path:</strong> ${escapeHtml(location.pathname)}</p></section>`;
}
async function renderAdmin() {
  app.innerHTML = `<section class="card panel adminDashboard"><p class="eyebrow">Local/private admin mode</p><h2 class="pageTitle">Admin Dashboard</h2><p class="formIntro">Login/auth placeholder: local development sends the default admin token. Replace with real authentication before production.</p><div class="adminLogin"><label>Admin token<input id="admin-token" value="${escapeHtml(adminToken())}" /></label><button id="refresh-admin" type="button">Refresh dashboard</button></div><div id="admin-stats" class="stats"><p class="empty">Loading database status...</p></div><section id="admin-system-paths" class="systemPaths"><h3>System Paths</h3><p class="empty">Loading system paths...</p></section><h3>Quick links</h3><div class="quickLinks">${['/upload','/submit','/review','/documents','/profiles','/leads','/scanner','/search','/health'].map((href) => `<a class="buttonLink" href="${href}">${href}</a>`).join('')}</div></section>${flowPanel()}`;
  await loadAdminStats();
}

function renderUpload() {
  app.innerHTML = `<section class="card panel uploader"><p class="eyebrow">Local/private admin upload</p><h2 class="pageTitle">Local Upload</h2>${missionReminderBlock()}<p class="formIntro">For documents from your computer. Uploads are private/admin-only by default and saved under <code>./record-room-data/uploads</code>.</p>${sealedWarning()}<form id="local-intake">${uploaderFields('admin')}<input type="hidden" name="visibility" value="private" /><input type="hidden" name="review_status" value="private intake" /><label>Document file${fileInput()}</label><p class="formIntro">Accepted: PDF, DOCX, DOC, TXT. Maximum size: 25 MB. Malware scan placeholder is recorded.</p><button type="submit">Save private/admin-only document</button><p class="status status-message" id="local-status"></p></form></section>`;
}

function renderSubmit() {
  app.innerHTML = `<section class="card panel uploader"><p class="eyebrow">Public submission portal</p><h2 class="pageTitle">Submit Records</h2><div class="publicMission"><div><p class="formIntro missionText">The Record Room AI collects transcripts, court orders, reports, evidence, and official records to help identify patterns, conduct, rule compliance, and decision-making by the guardians, judges, prosecutors, attorneys, and court officials shaping families’ futures.</p></div></div><p class="formIntro">Share the basic details and upload the record. Submissions are reviewed before anything is made public.</p><form id="public-submit">${uploaderFields('public')}<label>Document file${fileInput()}</label><p class="noticeText cleanNotice">Please upload only records you are legally allowed to share. Do not upload sealed, restricted, or confidential records unless you have authority to do so.</p><button type="submit">Submit for review</button><p class="status status-message" id="public-status"></p></form></section>`;
}

function renderReview() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Admin review workflow</p><h2 class="pageTitle">Review Queue</h2><p class="formIntro">Shows pending public submissions, raw scanner results, research leads, and documents needing review. Scanner/manual-import material must be reviewed before any public display.</p><form class="form-grid filterGrid" id="admin-filters"><label>Status${selectHtml('status', [''].concat(reviewStatuses), '')}</label><label>Keyword<input name="q" placeholder="name, court, case, text" /></label><button type="submit">Filter review queue</button></form><div class="actionsList">${['approve public','approve private','reject','mark duplicate','mark needs redaction','mark needs official verification','attach to profile','create profile','create claim','edit metadata'].map(pill).join('')}</div><div id="admin-list" class="adminList"></div></section>`;
}

function renderDocuments() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Document upload + AI indexing flow</p><h2 class="pageTitle">Documents</h2>${missionReminderBlock()}<p class="formIntro">Uploaded files are stored locally during development. They are not part of the AI search until they are processed and indexed.</p><p class="formIntro"><strong>Development-only storage:</strong> files are saved to <code id="dev-upload-path">./record-room-data/uploads</code></p><form id="documents-upload"><label>Upload document${fileInput()}</label><p class="formIntro">Accepted: PDF, DOCX, and TXT. Maximum size: 25 MB.</p><button type="submit">Upload document</button><p class="status status-message" id="documents-upload-status"></p></form><div class="table-wrap tableWrap"><table><thead><tr><th>File name</th><th>Upload date</th><th>File size</th><th>Upload status</th><th>AI indexing status</th><th>Actions</th></tr></thead><tbody id="documents-list"><tr><td colspan="6" class="empty">Loading documents...</td></tr></tbody></table></div><section class="card panel"><h3>Ask the AI about your uploaded documents.</h3><form id="documents-ask"><label>Question<input name="question" placeholder="Ask the AI about your uploaded documents." required /></label><button type="submit">Ask AI</button><p class="status status-message" id="documents-ask-status"></p><pre id="documents-ask-response" class="extractedText"></pre></form></section></section>`;
}


function renderProfiles() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Profile manager</p><h2 class="pageTitle">Profiles</h2><p class="formIntro">Manage profiles for ${profileRoles.join(', ')}. Public profiles should show only approved public information with completeness labels.</p><form class="form-grid grid two" id="profile-form"><label>Name<input name="name" required /></label><label>Normalized name<input name="normalized_name" /></label><label>Role${selectHtml('role', config.professionalRoles, 'judge')}</label><label>Court/office/firm<input name="court_office_firm" /></label><label>County<input name="county" /></label><label>State<input name="state" /></label><label>Bar number<input name="bar_number" /></label><label>Known cases<textarea name="known_cases"></textarea></label><label>Aliases<textarea name="aliases"></textarea></label><label>Source summary<textarea name="source_reliability_summary"></textarea></label><label>Admin notes<textarea name="admin_notes"></textarea></label><label>Public notes<textarea name="public_notes"></textarea></label><label>Profile status${selectHtml('profile_status', ['new profile','limited records','moderate records','substantial records','official-source verified'], 'new profile')}</label><label>Visibility${selectHtml('visibility', ['private','public'], 'private')}</label><button type="submit">Create profile</button><p id="profile-status" class="status status-message"></p></form><div id="profiles-list" class="adminList"></div></section>`;
}

function renderLeads() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Research Leads / Manual Import</p><h2 class="pageTitle">Research Leads / Trellis Manual Import</h2><p class="warningBanner">Commercial research-platform results are leads, not final verification. When possible, verify against the official court source before public display.</p><p class="formIntro">Trellis Law, Westlaw, Lexis, UniCourt, and Docket Alarm are manual/import sources unless API/license-compatible access is configured.</p><form class="form-grid grid two" id="lead-form"><label>Source platform${selectHtml('source_platform', sourcePlatforms, 'Trellis Law')}</label><label>Source URL<input name="source_url" /></label><label>Acquisition method${selectHtml('acquisition_method', ['manual entry','manual upload','licensed export','API if later configured'], 'manual entry')}</label><label>Case name<input name="case_name" /></label><label>Case number<input name="case_number" /></label><label>State<input name="state" /></label><label>County<input name="county" /></label><label>Court<input name="court" /></label><label>Judge<input name="judge" /></label><label>Guardian ad litem<input name="guardian_ad_litem" /></label><label>Attorneys<input name="attorneys" /></label><label>Prosecutor<input name="prosecutor" /></label><label>Evaluator<input name="evaluator" /></label><label>Document title<input name="document_title" /></label><label>Docket entry text<textarea name="docket_entry_text"></textarea></label><label>Filing date<input name="filing_date" type="date" /></label><label>Notes<textarea name="notes"></textarea></label><label>Tags<input name="tags" /></label><label>Verification source<input name="verification_source" /></label><label>Status${selectHtml('status', leadStatuses, 'new lead')}</label><label>Upload PDF/screenshot/CSV${fileInput(false)}</label><button type="submit">Save research lead</button><p id="lead-status" class="status status-message"></p></form><h3>Lead actions</h3><div class="actionsList">${['convert to raw result','convert to document','create profile','attach to profile','create claim','approve private','approve public','reject','mark duplicate','mark needs official verification'].map(pill).join('')}</div><div id="leads-list" class="adminList"></div></section>`;
}

function renderScanner() {
  app.innerHTML = `<section class="card panel"><p class="eyebrow">Connector-based scanner placeholders</p><h2 class="pageTitle">Scanner Jobs</h2><p class="warningBanner">Do not bypass logins, paywalls, CAPTCHA, robots.txt, sealed records, confidential records, or anti-bot protections. If a source requires account/payment/CAPTCHA, mark manual import required. Results go to review first.</p><form class="form-grid grid two" id="scanner-form"><label>State${selectHtml('state', states, 'Georgia')}</label><label>County<input name="county" /></label><label>Court<input name="court" /></label><label>Source connector${selectHtml('source_connector', connectors, connectors[0])}</label><label>Keyword group${selectHtml('keyword_group', Object.keys(keywordGroups), Object.keys(keywordGroups)[0])}</label><label>Custom keywords<input name="custom_keywords" /></label><label>Person/entity name<input name="person_name" /></label><label>Role${selectHtml('role', config.professionalRoles, 'judge')}</label><label>Case type<input name="case_type" /></label><label>Date from<input name="date_from" type="date" /></label><label>Date to<input name="date_to" type="date" /></label><label>Max results<input name="max_results" type="number" value="25" min="1" max="500" /></label><label>Status${selectHtml('status', scannerStatuses, 'new result')}</label><button type="submit">Create scanner placeholder job</button><p id="scanner-status" class="status status-message"></p></form><h3>Saved keyword groups</h3><div class="presetGrid">${Object.entries(keywordGroups).map(([name, kws]) => `<article class="placeholderBox"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(kws.join(' · '))}</span></article>`).join('')}</div><h3>Connectors</h3><div class="placeholderGrid">${connectors.map((c) => `<div class="placeholderBox"><strong>${escapeHtml(c)}</strong><span>manual/API-safe placeholder; no uncontrolled scraping</span></div>`).join('')}</div><div id="scanner-list" class="adminList"></div></section>`;
}

function renderSearch() {
  app.innerHTML = `<section class="card panel search-card"><p class="eyebrow">Public search</p><h2 class="pageTitle">Public Search</h2><p class="formIntro">Search only approved public records. Pending, private, rejected, sealed/confidential, needs-redaction, and admin-only records are never shown.</p><form class="form-grid filterGrid" id="public-search-form"><label>Name<input name="name" /></label><label>Role${selectHtml('role', [''].concat(config.professionalRoles), '')}</label><label>State<input name="state" /></label><label>County<input name="county" /></label><label>Court<input name="court" /></label><label>Source type<input name="source_type" /></label><label>Reliability label${selectHtml('source_label', [''].concat(config.sourceLabels), '')}</label><label>Allegation/category<input name="allegation_category" /></label><label>Keyword<input name="q" /></label><button class="primary-button search-submit" type="submit">Search approved public records</button></form><div id="public-results" class="cards search-results status-message"></div></section>`;
}

function uploaderFields(mode) {
  const publicOnly = mode === 'public';
  if (publicOnly) {
    return `<div class="grid two compactGrid"><label>Name<input name="uploader_name" required /></label><label>Email address<input name="uploader_email" required type="email" /></label></div><label>Case state<input name="state" required /></label><label>Short description of the proceeding/case<textarea name="description" required></textarea></label>`;
  }
  return `<div class="grid two compactGrid"><label>Uploader/admin name<input name="uploader_name" required /></label><label>Email<input name="uploader_email" type="email" /></label></div><label>Subject/person/entity name<input name="subject_name" required /></label><label>Role of subject${selectHtml('subject_role', roles, 'judge')}</label><div class="grid two compactGrid"><label>Court<input name="court" /></label><label>County<input name="county" /></label><label>State<input name="state" /></label><label>Case number<input name="case_number" /></label></div><div class="grid two compactGrid"><label>Document type<input name="document_type" /></label><label>Source type<input name="source_type" /></label></div><label>Short description<textarea name="description"></textarea></label><label>Tags/categories<input name="tags" /></label><label>Source/reliability label${selectHtml('source_label', config.sourceLabels, config.sourceLabels[0] || 'unknown source')}</label>`;
}

function missionReminderBlock() { return `<div class="missionReminder"><div class="missionVisual"><div class="robotGirlThumb" aria-hidden="true">🤖</div><div class="fleLogoBadge" aria-label="FLE logo">FLE</div></div><p>Upload transcripts, court orders, reports, evidence, and other official records to help us build a centralized hub that identifies patterns, conduct, rule compliance, and decision-making by the guardians, judges, prosecutors, attorneys, and court officials responsible for shaping families’ futures.</p></div>`; }
function fleLogoInline() { return `<span class="fleLogoBadge headerLogo" aria-hidden="true">FLE</span>`; }


function hydrateDirectVisitFromQuery() { const params = new URLSearchParams(location.search); const redirectedPath = params.get('p'); if (!redirectedPath) return; const cleanPath = redirectedPath.startsWith('/') ? redirectedPath : `/${redirectedPath}`; params.delete('p'); const query = params.toString(); history.replaceState({}, '', `${cleanPath}${query ? `?${query}` : ''}${location.hash || ''}`); }
function wireNavigation() { document.addEventListener('click', (event) => { const link = event.target.closest('a[href]'); if (!link) return; const url = new URL(link.href, location.origin); if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return; if (link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(`${url.pathname}${url.search}${url.hash}`); }); window.addEventListener('popstate', () => { renderRoute(); applyLayoutClasses(); }); }
function navigate(pathAndQuery) { const next = new URL(pathAndQuery, location.origin); if (`${next.pathname}${next.search}${next.hash}` === `${location.pathname}${location.search}${location.hash}`) return; history.pushState({}, '', `${next.pathname}${next.search}${next.hash}`); renderRoute(); applyLayoutClasses(); }

function wireRoute() {
  hydrateAdminToken();
  document.querySelector('#refresh-admin')?.addEventListener('click', loadAdminStats);
  document.querySelector('#local-intake')?.addEventListener('submit', (event) => submitUpload(event, '/api/uploads/local', '#local-status'));
  document.querySelector('#public-submit')?.addEventListener('submit', (event) => submitUpload(event, '/api/submissions/public', '#public-status'));
  document.querySelector('#public-search-form')?.addEventListener('submit', handlePublicSearch);
  document.querySelector('#admin-filters')?.addEventListener('submit', (event) => { event.preventDefault(); loadAdminUploads(); });
  document.querySelector('#profile-form')?.addEventListener('submit', submitProfile);
  document.querySelector('#lead-form')?.addEventListener('submit', submitLead);
  document.querySelector('#scanner-form')?.addEventListener('submit', submitScanner);
  document.querySelector('#documents-upload')?.addEventListener('submit', submitDocumentsUpload);
  document.querySelector('#documents-ask')?.addEventListener('submit', askIndexedDocuments);
  if (location.pathname === '/review') loadAdminUploads(false);
  if (location.pathname === '/documents') loadDocumentsPage(false);
  if (location.pathname === '/search' || location.pathname === '/public-search') handlePublicSearch(new Event('submit'));
  if (location.pathname === '/profiles') loadProfiles();
  if (location.pathname === '/leads') loadLeads();
  if (location.pathname === '/scanner') loadScannerJobs();
}


async function loadDocumentsPage(showErrors = true) { const tbody = document.querySelector('#documents-list'); if (!tbody) return; try { const payload = await api('/api/admin/documents/flow', { headers: adminHeaders() }); const devPath = document.querySelector('#dev-upload-path'); if (devPath) devPath.textContent = payload.uploadDirectory || './record-room-data/uploads'; tbody.innerHTML = payload.documents.length ? payload.documents.map(renderDocumentsFlowRow).join('') : '<tr><td colspan="6" class="empty">No uploaded documents yet.</td></tr>'; tbody.querySelectorAll('[data-delete-document]').forEach((b) => b.addEventListener('click', deleteDocument)); } catch (e) { if (showErrors) tbody.innerHTML = `<tr><td colspan="6" class="status error">${escapeHtml(e.message)}</td></tr>`; } }
function renderDocumentsFlowRow(doc) { return `<tr><td>${escapeHtml(doc.original_filename || '')}</td><td>${escapeHtml(new Date(doc.created_at).toLocaleString())}</td><td>${escapeHtml(formatBytes(doc.file_size || 0))}</td><td>${pill(doc.uploadStatusLabel || 'Uploaded')}</td><td>${pill(doc.aiIndexingStatusLabel || 'Processing')}<div class="statusDetail">${escapeHtml(doc.flowMessage || '')}</div></td><td><button type="button" data-delete-document="${doc.id}">Delete</button></td></tr>`; }
async function deleteDocument(event) { const id = event.currentTarget.dataset.deleteDocument; if (!confirm('Delete this test document?')) return; await api(`/api/admin/documents/${id}`, { method: 'DELETE', headers: adminHeaders() }); await loadDocumentsPage(); }
async function submitDocumentsUpload(event) { event.preventDefault(); const status = document.querySelector('#documents-upload-status'); const form = event.currentTarget; const file = form.querySelector('input[type="file"][name="file"]')?.files?.[0]; if (!file) return setStatus(status, 'Choose a file before uploading.', 'error'); const ext = (file.name.split('.').pop() || '').toLowerCase(); if (!['pdf','docx','txt'].includes(ext)) return setStatus(status, 'Only PDF, DOCX, and TXT files are allowed on this page.', 'error'); try { setStatus(status, 'Uploading...', 'info'); const res = await fetch(apiUrl('/api/uploads/local'), { method: 'POST', body: new FormData(form) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Upload failed.'); setStatus(status, 'Upload received. The document is pending processing and review.', 'success'); alert('Upload received. The document is pending processing and review.'); form.reset(); await loadDocumentsPage(); } catch (e) { setStatus(status, e.message, 'error'); } }
async function askIndexedDocuments(event) { event.preventDefault(); const form = event.currentTarget; const status = document.querySelector('#documents-ask-status'); const out = document.querySelector('#documents-ask-response'); const button = form.querySelector('button[type="submit"]'); out.textContent = ''; const question = String(new FormData(form).get('question') || '').trim(); if (!question) return setStatus(status, 'Enter a question first.', 'error'); try { if (button) button.disabled = true; setStatus(status, 'Searching indexed documents...', 'info'); const payload = await api('/api/admin/documents/ask', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }); out.textContent = payload.answer || 'No answer returned.'; if (payload.noChunks) setStatus(status, 'No indexed chunks found for those documents yet.', 'error'); else setStatus(status, `Answered using ${payload.indexedDocumentCount} indexed document(s) and ${payload.chunkCount || 0} chunk(s).`, 'success'); } catch (e) { out.textContent = ''; setStatus(status, e.message, 'error'); } finally { if (button) button.disabled = false; } }
function formatBytes(bytes) { if (!bytes) return '0 B'; const units = ['B','KB','MB','GB']; let v = bytes; let i = 0; while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; } return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`; }
async function loadAdminStats() {
  const target = document.querySelector('#admin-stats');
  if (!target) return;
  const payload = await api('/api/admin/stats', { headers: adminHeaders() });
  const s = payload.stats;
  target.innerHTML = stat('Database', payload.health.database) + stat('Total documents', s.totalDocuments) + stat('Pending review', s.pendingReviewCount) + stat('Public approved', s.publicApprovedCount) + stat('Private/admin-only', s.privateAdminOnlyCount) + stat('Profiles', s.profilesCount) + stat('Research leads', s.researchLeadsCount) + stat('Scanner jobs', s.scannerJobsCount);
  const pathTarget = document.querySelector('#admin-system-paths');
  if (pathTarget) pathTarget.innerHTML = `<h3>System Paths</h3><div class="pathRow"><strong>Data root</strong><code class="pathValue">${escapeHtml(payload.health.dataRoot || '')}</code></div><div class="pathRow"><strong>Database path</strong><code class="pathValue">${escapeHtml(payload.health.databasePath || '')}</code></div>`;
}
async function loadAdminUploads(showErrors = true) { const el = document.querySelector('#admin-list'); if (!el) return; el.innerHTML = '<p class="empty">Loading records...</p>'; try { const q = new URLSearchParams(new FormData(document.querySelector('#admin-filters'))); const payload = await api(`/api/admin/uploads?${q}`, { headers: adminHeaders() }); el.innerHTML = payload.documents.length ? payload.documents.map(renderAdminCard).join('') : '<p class="empty">No records matched.</p>'; el.querySelectorAll('[data-save-upload]').forEach((b) => b.addEventListener('click', saveUploadEdits)); el.querySelectorAll('[data-show-text]').forEach((b) => b.addEventListener('click', showExtractedText)); el.querySelectorAll('[data-create-profile]').forEach((b) => b.addEventListener('click', createProfileFromUpload)); } catch (e) { if (showErrors) el.innerHTML = `<p class="status error">${escapeHtml(e.message)}</p>`; } }
async function handlePublicSearch(event) { event.preventDefault(); const el = document.querySelector('#public-results'); if (!el) return; el.innerHTML = '<p class="empty">Searching approved public records...</p>'; try { const q = new URLSearchParams(new FormData(document.querySelector('#public-search-form'))); const payload = await api(`/api/public/search?${q}`); el.innerHTML = payload.results.length ? payload.results.map(renderPublicCard).join('') : '<p class="empty">No approved public records are currently available for this search.</p>'; } catch (e) { el.innerHTML = `<p class="status error">${escapeHtml(e.message)}</p>`; } }
async function submitUpload(event, endpoint, statusSelector) { event.preventDefault(); const status = document.querySelector(statusSelector); const form = event.currentTarget; const file = form.querySelector('input[type="file"][name="file"]')?.files?.[0]; const validation = validateFile(file); if (validation) return setStatus(status, validation, 'error'); try { setStatus(status, 'Uploading and saving to persistent storage...', 'info'); const res = await fetch(apiUrl(endpoint), { method: 'POST', body: new FormData(form) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Upload failed. Please try again.'); if (location.pathname === '/submit' || location.pathname === '/record-room-submit') { const msg = 'Thank you. Your document has been submitted for review. Submissions are private/pending by default and will not become public automatically.'; setStatus(status, msg, 'success'); alert(msg); } else { const msg = 'Upload received. The document is pending processing and review.'; setStatus(status, msg, 'success'); alert(msg); } form.reset(); } catch (e) { setStatus(status, e.message, 'error'); } }
async function submitProfile(event) { event.preventDefault(); const status = document.querySelector('#profile-status'); try { const payload = await api('/api/admin/profiles', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); setStatus(status, `Profile created: ${payload.profile.name}`, 'success'); event.currentTarget.reset(); loadProfiles(); } catch (e) { setStatus(status, e.message, 'error'); } }
async function submitLead(event) { event.preventDefault(); const status = document.querySelector('#lead-status'); try { const res = await fetch(apiUrl('/api/admin/research-leads'), { method: 'POST', headers: adminHeaders(), body: new FormData(event.currentTarget) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Lead save failed.'); setStatus(status, 'Research lead saved for review.', 'success'); event.currentTarget.reset(); loadLeads(); } catch (e) { setStatus(status, e.message, 'error'); } }
async function submitScanner(event) { event.preventDefault(); const status = document.querySelector('#scanner-status'); try { await api('/api/admin/scanner-jobs', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); setStatus(status, 'Scanner placeholder job saved. Results must go to review first.', 'success'); event.currentTarget.reset(); loadScannerJobs(); } catch (e) { setStatus(status, e.message, 'error'); } }
async function loadProfiles() { const el = document.querySelector('#profiles-list'); if (!el) return; const p = await api('/api/admin/profiles', { headers: adminHeaders() }); el.innerHTML = p.profiles.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.name)}</h3><p>${pill(x.role)} ${pill(x.visibility)} ${pill(x.profile_status || 'new profile')}</p><p>${escapeHtml([x.court_office_firm, x.county, x.state].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No profiles yet.</p>'; }
async function loadLeads() { const el = document.querySelector('#leads-list'); if (!el) return; const p = await api('/api/admin/research-leads', { headers: adminHeaders() }); el.innerHTML = p.leads.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.document_title || x.case_name || x.lead_text || 'Research lead')}</h3><p>${pill(x.source_platform || 'source')} ${pill(x.status)}</p><p>${escapeHtml([x.court, x.county, x.state, x.case_number].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No research leads yet.</p>'; }
async function loadScannerJobs() { const el = document.querySelector('#scanner-list'); if (!el) return; const p = await api('/api/admin/scanner-jobs', { headers: adminHeaders() }); el.innerHTML = p.jobs.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.source_connector || x.query || 'Scanner job')}</h3><p>${pill(x.status)} ${pill(x.keyword_group || 'keyword group')}</p><p>${escapeHtml([x.court, x.county, x.state, x.person_name].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No scanner jobs yet.</p>'; }

function renderAdminCard(doc) { return `<article class="adminCard" data-upload-id="${doc.id}"><div class="adminCardHeader"><div><h3>#${doc.id} ${escapeHtml(doc.document_title || doc.original_filename)}</h3><p>${pill(doc.review_status)} ${pill(doc.visibility)} ${pill(doc.redaction_status)} ${pill(doc.extraction_status)}</p></div><div class="adminActions"><a class="buttonLink" href="${apiUrl(`/api/admin/uploads/${doc.id}/download`)}?token=${encodeURIComponent(adminToken())}" target="_blank" rel="noopener">Download original</a><button type="button" data-show-text="${doc.id}">View extracted text</button><button type="button" data-create-profile="${doc.id}">Create profile</button></div></div><div class="table-wrap tableWrap"><table><tbody>${['original_filename','document_type','source_type','source_label','state','county','court','case_number','subject_name','subject_role','created_at'].map((k) => `<tr><th>${k.replaceAll('_',' ')}</th><td>${escapeHtml(doc[k] || '')}</td></tr>`).join('')}</tbody></table></div><div class="form-grid grid three editGrid">${editInput('subject_name', doc.subject_name)}${editInput('document_type', doc.document_type)}${editInput('source_type', doc.source_type)}${editInput('state', doc.state)}${editInput('county', doc.county)}${editInput('court', doc.court)}${editInput('case_number', doc.case_number)}${editSelect('review_status', doc.review_status, ['pending','approved','approved public','approved private','rejected','needs redaction','needs official source verification','duplicate','sealed/do not publish'])}${editSelect('visibility', doc.visibility, ['private','public','admin-only'])}${editSelect('redaction_status', doc.redaction_status, ['not_requested','needs redaction','redacted','sealed/do not publish'])}</div><label>Reliability tags<input data-field="reliability_tags" value="${escapeHtml(doc.reliability_tags || '')}" /></label><label>Tags/allegation categories<input data-field="tags" value="${escapeHtml(doc.tags || '')}" /></label><label>Public summary<textarea data-field="public_summary">${escapeHtml(doc.public_summary || '')}</textarea></label><details><summary>AI-ready source-bound summary structure</summary><pre>${escapeHtml(doc.ai_summary_json || '{}')}</pre></details><div class="extractedText" id="text-${doc.id}">${escapeHtml(doc.extraction_preview || '[No extracted preview available.]')}</div><button type="button" data-save-upload="${doc.id}">Save metadata/status</button></article>`; }
function renderPublicCard(doc) { return `<article class="recordCard"><h3>${escapeHtml(doc.subject_name || 'Approved public record')}</h3><p>${pill(doc.subject_role)} ${pill(doc.source_label)} ${pill(doc.reliability_tags)}</p><p><strong>Court/location:</strong> ${escapeHtml([doc.court, doc.county, doc.state].filter(Boolean).join(' · ') || 'not specified')}</p><p><strong>Summary:</strong> ${escapeHtml(doc.public_summary || doc.description || 'Approved source record. No public summary has been added yet.')}</p><small>Relevance confidence is not truth. Public records distinguish official findings, court-record-supported allegations, user-submitted allegations, and unresolved/conflicting information.</small></article>`; }
async function saveUploadEdits(event) { const card = event.currentTarget.closest('[data-upload-id]'); const body = {}; card.querySelectorAll('[data-field]').forEach((i) => { body[i.dataset.field] = i.value; }); await api(`/api/admin/uploads/${card.dataset.uploadId}`, { method: 'PATCH', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadAdminUploads(); }
async function showExtractedText(event) { const id = event.currentTarget.dataset.showText; const target = document.querySelector(`#text-${id}`); target.textContent = 'Loading extracted text...'; const payload = await api(`/api/admin/uploads/${id}/text`, { headers: adminHeaders() }); target.textContent = payload.text || `[${payload.extractionStatus}] ${payload.extractionMessage || 'No text extracted yet.'}`; }
async function createProfileFromUpload(event) { const payload = await api(`/api/admin/uploads/${event.currentTarget.dataset.createProfile}/create-profile`, { method: 'POST', headers: adminHeaders() }); alert(`Profile created/assigned: ${payload.profile?.name || 'profile'}`); }

function flowPanel() { return `<section class="card panel"><p class="eyebrow">Our mission</p><h2>Public accountability grounded in official records</h2><p>Record Room AI focuses on collecting and organizing official family court records so the public can better understand patterns, conduct, decision-making, and outcomes tied to court-connected professionals.</p><div class="actionsList">${['No uncontrolled scraping','No sealed/confidential publication','Redaction workflow','Source-based review before publication','Public visibility only after approval'].map(pill).join('')}</div></section>`; }
function sealedWarning() { return `<div class="warningBanner">Do not upload sealed, confidential, protected, unlawfully obtained, minor-child identifying, SSN, address, phone, financial account, medical, or other confidential identifiers for public display. Use the redaction workflow.</div>`; }
function fileInput(required = true) { return `<input name="file" ${required ? 'required' : ''} type="file" accept=".pdf,.docx,.doc,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" />`; }
function selectHtml(name, options, selected) { return `<select name="${name}">${options.map((o) => `<option value="${escapeHtml(o)}" ${o === selected ? 'selected' : ''}>${escapeHtml(o || 'Any')}</option>`).join('')}</select>`; }
function stat(label, value) { return `<article class="statCard"><span class="statLabel">${escapeHtml(label)}</span><strong class="statValue">${escapeHtml(value ?? 0)}</strong></article>`; }
function editInput(field, value) { return `<label>${field.replaceAll('_',' ')}<input data-field="${field}" value="${escapeHtml(value || '')}" /></label>`; }
function editSelect(field, value, opts) { return `<label>${field.replaceAll('_',' ')}<select data-field="${field}">${opts.map((o) => `<option value="${escapeHtml(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>`; }
function validateFile(file) { if (!file) return 'Choose a document file before submitting.'; const ext = file.name.split('.').pop().toLowerCase(); if (!allowedExtensions.includes(ext)) return 'Unsupported file type. Accepted: PDF, DOCX, DOC, TXT.'; if (file.size > MAX_FILE_BYTES) return 'File is too large. Maximum size is 25 MB per file.'; return ''; }
function apiUrl(path) { return path.startsWith('http://') || path.startsWith('https://') ? path : `${API_BASE}${path}`; }
async function api(url, options = {}) { const headers = new Headers(options.headers || {}); if (url.startsWith('/api/admin/') && !url.startsWith('/api/admin/login') && adminToken()) headers.set('X-Admin-Token', adminToken()); const res = await fetch(apiUrl(url), { ...options, headers }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || `Request failed with ${res.status}`); return payload; }
function hydrateAdminToken() { const token = new URLSearchParams(location.search).get('token') || localStorage.getItem('recordRoomAdminToken') || config.localDevAdminToken || ''; const input = document.querySelector('#admin-token'); if (input) { input.value = token; input.addEventListener('input', () => localStorage.setItem('recordRoomAdminToken', input.value)); } if (token) localStorage.setItem('recordRoomAdminToken', token); }
function adminToken() { return document.querySelector('#admin-token')?.value.trim() || localStorage.getItem('recordRoomAdminToken') || config.localDevAdminToken || ''; }
function adminHeaders() { return adminToken() ? { 'X-Admin-Token': adminToken() } : {}; }
function setStatus(el, msg, type) { if (el) { el.className = `status status-message ${type}`; el.textContent = msg; } }
function pill(text) { return `<span class="pill">${escapeHtml(text || 'unset')}</span>`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
function applyTitle(path = location.pathname) { const names = { '/admin': 'Admin Dashboard', '/upload': 'Local Upload', '/submit': 'Public Submit', '/review': 'Review Queue', '/documents': 'Documents', '/profiles': 'Profiles', '/leads': 'Research Leads', '/scanner': 'Scanner', '/search': 'Public Search' }; document.title = `${names[path] || 'Record Room AI'} · Record Room AI`; }
