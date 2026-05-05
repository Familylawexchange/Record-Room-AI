diff --git a/src/app.js b/src/app.js
index 12c2129e06ecbe84bf639dffb6d878e139db375c..f370a8cb6cb480403f35bfcf283871ee67e23680 100644
--- a/src/app.js
+++ b/src/app.js
@@ -4,55 +4,72 @@ index 214af841ebe692a3e51517087fb6bfe4b827f399..aa9cb0f70474f0503b8707544b968cae
 +++ b/src/app.js
 @@ -1,25 +1,26 @@
 +const API_BASE = "https://record-room-ai.onrender.com";
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const allowedExtensions = ['pdf', 'docx', 'doc', 'txt', 'jpg', 'jpeg', 'png'];
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
  const app = document.querySelector('#app');
  
  bootstrap();
  
- async function bootstrap() {
-   config = await api('/api/config');
-   if (!config.professionalRoles?.length) config.professionalRoles = roles;
-@@ -100,52 +101,100 @@ function uploaderFields(mode) {
- 
+async function bootstrap() {
+  try {
+    config = await api('/api/config');
+  } catch (e) {
+    console.warn('Using fallback config because /api/config is unavailable:', e.message);
+    config = {
+      sourceLabels: ['official court source', 'user-submitted document', 'Trellis Law research lead', 'unknown source'],
+      reliabilityTags: [],
+      professionalRoles: roles,
+      localDevAdminToken: null,
+      isProduction: true
+    };
+  }
+
+  if (!config.professionalRoles?.length) config.professionalRoles = roles;
+  if (!config.sourceLabels?.length) config.sourceLabels = ['official court source', 'user-submitted document', 'Trellis Law research lead', 'unknown source'];
+
+  applyTitle();
+  renderRoute();
+  applyLayoutClasses();
+  wireRoute();
+}
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
    if (location.pathname === '/search') handlePublicSearch(new Event('submit'));
    if (location.pathname === '/profiles') loadProfiles();
    if (location.pathname === '/leads') loadLeads();
    if (location.pathname === '/scanner') loadScannerJobs();
  }
  
  
  async function loadDocumentsPage(showErrors = true) { const tbody = document.querySelector('#documents-list'); if (!tbody) return; try { const payload = await api('/api/admin/documents/flow', { headers: adminHeaders() }); const devPath = document.querySelector('#dev-upload-path'); if (devPath) devPath.textContent = payload.uploadDirectory || './record-room-data/uploads'; tbody.innerHTML = payload.documents.length ? payload.documents.map(renderDocumentsFlowRow).join('') : '<tr><td colspan="6" class="empty">No uploaded documents yet.</td></tr>'; tbody.querySelectorAll('[data-delete-document]').forEach((b) => b.addEventListener('click', deleteDocument)); } catch (e) { if (showErrors) tbody.innerHTML = `<tr><td colspan="6" class="status error">${escapeHtml(e.message)}</td></tr>`; } }
  function renderDocumentsFlowRow(doc) { return `<tr><td>${escapeHtml(doc.original_filename || '')}</td><td>${escapeHtml(new Date(doc.created_at).toLocaleString())}</td><td>${escapeHtml(formatBytes(doc.file_size || 0))}</td><td>${pill(doc.uploadStatusLabel || 'Uploaded')}</td><td>${pill(doc.aiIndexingStatusLabel || 'Processing')}</td><td><button type="button" data-delete-document="${doc.id}">Delete</button></td></tr>`; }
  async function deleteDocument(event) { const id = event.currentTarget.dataset.deleteDocument; if (!confirm('Delete this test document?')) return; await api(`/api/admin/documents/${id}`, { method: 'DELETE', headers: adminHeaders() }); await loadDocumentsPage(); }
 -async function submitDocumentsUpload(event) { event.preventDefault(); const status = document.querySelector('#documents-upload-status'); const form = event.currentTarget; const file = form.querySelector('input[type="file"][name="file"]')?.files?.[0]; if (!file) return setStatus(status, 'Choose a file before uploading.', 'error'); const ext = (file.name.split('.').pop() || '').toLowerCase(); if (!['pdf','docx','txt'].includes(ext)) return setStatus(status, 'Only PDF, DOCX, and TXT files are allowed on this page.', 'error'); try { setStatus(status, 'Uploading...', 'info'); const res = await fetch('/api/uploads/local', { method: 'POST', body: new FormData(form) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Upload failed.'); setStatus(status, 'Uploaded. Document status will update after processing/indexing.', 'success'); form.reset(); await loadDocumentsPage(); } catch (e) { setStatus(status, e.message, 'error'); } }
