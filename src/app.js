diff --git a/src/app.js b/src/app.js
index 214af841ebe692a3e51517087fb6bfe4b827f399..aa9cb0f70474f0503b8707544b968caebda444bf 100644
--- a/src/app.js
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
 
 async function bootstrap() {
   config = await api('/api/config');
   if (!config.professionalRoles?.length) config.professionalRoles = roles;
@@ -100,52 +101,100 @@ function uploaderFields(mode) {
 
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
-async function askIndexedDocuments(event) { event.preventDefault(); const form = event.currentTarget; const status = document.querySelector('#documents-ask-status'); const out = document.querySelector('#documents-ask-response'); const button = form.querySelector('button[type="submit"]'); out.textContent = ''; const question = String(new FormData(form).get('question') || '').trim(); if (!question) return setStatus(status, 'Enter a question first.', 'error'); try { if (button) button.disabled = true; setStatus(status, 'Searching indexed documents...', 'info'); const payload = await api('/api/admin/documents/ask', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }); out.textContent = payload.answer || 'No answer returned.'; if (payload.noChunks) setStatus(status, 'No indexed chunks found for those documents yet.', 'error'); else setStatus(status, `Answered using ${payload.indexedDocumentCount} indexed document(s) and ${payload.chunkCount || 0} chunk(s).`, 'success'); } catch (e) { out.textContent = ''; setStatus(status, e.message, 'error'); } finally { if (button) button.disabled = false; } }
+async function submitDocumentsUpload(event) { event.preventDefault(); const status = document.querySelector('#documents-upload-status'); const form = event.currentTarget; const file = form.querySelector('input[type="file"][name="file"]')?.files?.[0]; if (!file) return setStatus(status, 'Choose a file before uploading.', 'error'); const ext = (file.name.split('.').pop() || '').toLowerCase(); if (!['pdf','docx','txt'].includes(ext)) return setStatus(status, 'Only PDF, DOCX, and TXT files are allowed on this page.', 'error'); try { setStatus(status, 'Uploading...', 'info'); const res = await fetch(API_BASE + '/upload', { method: 'POST', body: new FormData(form) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Upload failed.'); setStatus(status, 'Uploaded. Document status will update after processing/indexing.', 'success'); form.reset(); await loadDocumentsPage(); } catch (e) { setStatus(status, e.message, 'error'); } }
+async function askIndexedDocuments(event) {
+  event.preventDefault();
+
+  const form = event.currentTarget;
+  const status = document.querySelector('#documents-ask-status');
+  const out = document.querySelector('#documents-ask-response');
+  const button = form.querySelector('button[type="submit"]');
+
+  out.textContent = '';
+
+  const question = String(new FormData(form).get('question') || '').trim();
+
+  if (!question) {
+    return setStatus(status, 'Enter a question first.', 'error');
+  }
+
+  try {
+    if (button) button.disabled = true;
+
+    setStatus(status, 'Reading uploaded document and thinking...', 'info');
+
+    const res = await fetch(API_BASE + '/chat', {
+      method: 'POST',
+      headers: {
+        'Content-Type': 'application/json'
+      },
+      body: JSON.stringify({
+        message: question
+      })
+    });
+
+    const payload = await res.json().catch(() => ({}));
+
+    if (!res.ok) {
+      throw new Error(payload.error || 'Question failed.');
+    }
+
+    out.textContent = payload.answer || payload.error || 'No answer returned.';
+
+    setStatus(status, 'Answer generated.', 'success');
+
+  } catch (e) {
+    out.textContent = '';
+    setStatus(status, e.message, 'error');
+
+  } finally {
+    if (button) button.disabled = false;
+  }
+}
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
 async function submitUpload(event, endpoint, statusSelector) { event.preventDefault(); const status = document.querySelector(statusSelector); const form = event.currentTarget; const file = form.querySelector('input[type="file"][name="file"]')?.files?.[0]; const validation = validateFile(file); if (validation) return setStatus(status, validation, 'error'); try { setStatus(status, 'Uploading and saving to persistent storage...', 'info'); const res = await fetch(endpoint, { method: 'POST', body: new FormData(form) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Upload failed.'); setStatus(status, payload.message, 'success'); form.reset(); } catch (e) { setStatus(status, e.message, 'error'); } }
 async function submitProfile(event) { event.preventDefault(); const status = document.querySelector('#profile-status'); try { const payload = await api('/api/admin/profiles', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); setStatus(status, `Profile created: ${payload.profile.name}`, 'success'); event.currentTarget.reset(); loadProfiles(); } catch (e) { setStatus(status, e.message, 'error'); } }
 async function submitLead(event) { event.preventDefault(); const status = document.querySelector('#lead-status'); try { const res = await fetch('/api/admin/research-leads', { method: 'POST', headers: adminHeaders(), body: new FormData(event.currentTarget) }); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.error || 'Lead save failed.'); setStatus(status, 'Research lead saved for review.', 'success'); event.currentTarget.reset(); loadLeads(); } catch (e) { setStatus(status, e.message, 'error'); } }
 async function submitScanner(event) { event.preventDefault(); const status = document.querySelector('#scanner-status'); try { await api('/api/admin/scanner-jobs', { method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); setStatus(status, 'Scanner placeholder job saved. Results must go to review first.', 'success'); event.currentTarget.reset(); loadScannerJobs(); } catch (e) { setStatus(status, e.message, 'error'); } }
 async function loadProfiles() { const el = document.querySelector('#profiles-list'); if (!el) return; const p = await api('/api/admin/profiles', { headers: adminHeaders() }); el.innerHTML = p.profiles.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.name)}</h3><p>${pill(x.role)} ${pill(x.visibility)} ${pill(x.profile_status || 'new profile')}</p><p>${escapeHtml([x.court_office_firm, x.county, x.state].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No profiles yet.</p>'; }
 async function loadLeads() { const el = document.querySelector('#leads-list'); if (!el) return; const p = await api('/api/admin/research-leads', { headers: adminHeaders() }); el.innerHTML = p.leads.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.document_title || x.case_name || x.lead_text || 'Research lead')}</h3><p>${pill(x.source_platform || 'source')} ${pill(x.status)}</p><p>${escapeHtml([x.court, x.county, x.state, x.case_number].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No research leads yet.</p>'; }
 async function loadScannerJobs() { const el = document.querySelector('#scanner-list'); if (!el) return; const p = await api('/api/admin/scanner-jobs', { headers: adminHeaders() }); el.innerHTML = p.jobs.map((x) => `<article class="adminCard"><h3>${escapeHtml(x.source_connector || x.query || 'Scanner job')}</h3><p>${pill(x.status)} ${pill(x.keyword_group || 'keyword group')}</p><p>${escapeHtml([x.court, x.county, x.state, x.person_name].filter(Boolean).join(' · '))}</p></article>`).join('') || '<p class="empty">No scanner jobs yet.</p>'; }
 
 function renderAdminCard(doc) { return `<article class="adminCard" data-upload-id="${doc.id}"><div class="adminCardHeader"><div><h3>#${doc.id} ${escapeHtml(doc.document_title || doc.original_filename)}</h3><p>${pill(doc.review_status)} ${pill(doc.visibility)} ${pill(doc.redaction_status)} ${pill(doc.extraction_status)}</p></div><div class="adminActions"><a class="buttonLink" href="/api/admin/uploads/${doc.id}/download?token=${encodeURIComponent(adminToken())}" target="_blank" rel="noopener">Download original</a><button type="button" data-show-text="${doc.id}">View extracted text</button><button type="button" data-create-profile="${doc.id}">Create profile</button></div></div><div class="table-wrap tableWrap"><table><tbody>${['original_filename','document_type','source_type','source_label','state','county','court','case_number','subject_name','subject_role','created_at'].map((k) => `<tr><th>${k.replaceAll('_',' ')}</th><td>${escapeHtml(doc[k] || '')}</td></tr>`).join('')}</tbody></table></div><div class="form-grid grid three editGrid">${editInput('subject_name', doc.subject_name)}${editInput('document_type', doc.document_type)}${editInput('source_type', doc.source_type)}${editInput('state', doc.state)}${editInput('county', doc.county)}${editInput('court', doc.court)}${editInput('case_number', doc.case_number)}${editSelect('review_status', doc.review_status, ['pending','approved','approved public','approved private','rejected','needs redaction','needs official source verification','duplicate','sealed/do not publish'])}${editSelect('visibility', doc.visibility, ['private','public','admin-only'])}${editSelect('redaction_status', doc.redaction_status, ['not_requested','needs redaction','redacted','sealed/do not publish'])}</div><label>Reliability tags<input data-field="reliability_tags" value="${escapeHtml(doc.reliability_tags || '')}" /></label><label>Tags/allegation categories<input data-field="tags" value="${escapeHtml(doc.tags || '')}" /></label><label>Public summary<textarea data-field="public_summary">${escapeHtml(doc.public_summary || '')}</textarea></label><details><summary>AI-ready source-bound summary structure</summary><pre>${escapeHtml(doc.ai_summary_json || '{}')}</pre></details><div class="extractedText" id="text-${doc.id}">${escapeHtml(doc.extraction_preview || '[No extracted preview available.]')}</div><button type="button" data-save-upload="${doc.id}">Save metadata/status</button></article>`; }
 function renderPublicCard(doc) { return `<article class="recordCard"><h3>${escapeHtml(doc.subject_name || 'Approved public record')}</h3><p>${pill(doc.subject_role)} ${pill(doc.source_label)} ${pill(doc.reliability_tags)}</p><p><strong>Court/location:</strong> ${escapeHtml([doc.court, doc.county, doc.state].filter(Boolean).join(' · ') || 'not specified')}</p><p><strong>Summary:</strong> ${escapeHtml(doc.public_summary || doc.description || 'Approved source record. No public summary has been added yet.')}</p><small>Relevance confidence is not truth. Public records distinguish official findings, court-record-supported allegations, user-submitted allegations, and unresolved/conflicting information.</small></article>`; }
 async function saveUploadEdits(event) { const card = event.currentTarget.closest('[data-upload-id]'); const body = {}; card.querySelectorAll('[data-field]').forEach((i) => { body[i.dataset.field] = i.value; }); await api(`/api/admin/uploads/${card.dataset.uploadId}`, { method: 'PATCH', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadAdminUploads(); }
 async function showExtractedText(event) { const id = event.currentTarget.dataset.showText; const target = document.querySelector(`#text-${id}`); target.textContent = 'Loading extracted text...'; const payload = await api(`/api/admin/uploads/${id}/text`, { headers: adminHeaders() }); target.textContent = payload.text || `[${payload.extractionStatus}] ${payload.extractionMessage || 'No text extracted yet.'}`; }
 async function createProfileFromUpload(event) { const payload = await api(`/api/admin/uploads/${event.currentTarget.dataset.createProfile}/create-profile`, { method: 'POST', headers: adminHeaders() }); alert(`Profile created/assigned: ${payload.profile?.name || 'profile'}`); }
