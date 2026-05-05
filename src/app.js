const MAX_FILE_BYTES = 25 * 1024 * 1024;
const allowedExtensions = ['pdf', 'docx', 'doc', 'txt', 'jpg', 'jpeg', 'png'];
let config = { sourceLabels: [], reliabilityTags: [], professionalRoles: [], localDevAdminToken: null, isProduction: false };

const selectors = {
  localForm: document.querySelector('#local-intake'),
  publicForm: document.querySelector('#public-submit'),
  publicSearchForm: document.querySelector('#public-search-form'),
  adminFilters: document.querySelector('#admin-filters'),
  localStatus: document.querySelector('#local-status'),
  publicStatus: document.querySelector('#public-status'),
  publicResults: document.querySelector('#public-results'),
  adminList: document.querySelector('#admin-list'),
  adminToken: document.querySelector('#admin-token'),
  loadAdmin: document.querySelector('#load-admin'),
  exportCsv: document.querySelector('#export-csv'),
};

bootstrap();

async function bootstrap() {
  config = await api('/api/config');
  applyRouteMode();
  hydrateAdminToken();
  populateSelects();
  selectors.localForm.addEventListener('submit', (event) => submitUpload(event, '/api/uploads/local', selectors.localStatus));
  selectors.publicForm.addEventListener('submit', (event) => submitUpload(event, '/api/submissions/public', selectors.publicStatus));
  selectors.publicSearchForm.addEventListener('submit', handlePublicSearch);
  selectors.adminFilters.addEventListener('submit', (event) => { event.preventDefault(); loadAdminUploads(); });
  selectors.adminToken.addEventListener('input', () => localStorage.setItem('recordRoomAdminToken', adminToken()));
  selectors.loadAdmin.addEventListener('click', loadAdminUploads);
  selectors.exportCsv.addEventListener('click', downloadCsv);
  await handlePublicSearch(new Event('submit'));
  if (location.pathname.startsWith('/admin')) await loadAdminUploads(false);
}

function populateSelects() {
  document.querySelectorAll('[data-role-select]').forEach((select) => {
    const keep = Array.from(select.options).map((option) => option.outerHTML).join('');
    const roleOptions = config.professionalRoles.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join('');
    select.innerHTML = keep + roleOptions;
  });
  document.querySelectorAll('[data-source-label-select]').forEach((select) => {
    const keep = Array.from(select.options).map((option) => option.outerHTML).join('');
    const options = config.sourceLabels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('');
    select.innerHTML = keep + options;
  });
}

async function submitUpload(event, endpoint, statusElement) {
  event.preventDefault();
  clearStatus(statusElement);
  const form = event.currentTarget;
  const file = form.querySelector('input[type="file"]')?.files?.[0];
  const validation = validateFile(file);
  if (validation) return setStatus(statusElement, validation, 'error');
  try {
    setStatus(statusElement, 'Uploading and saving to persistent storage...', 'info');
    const response = await fetch(endpoint, { method: 'POST', body: new FormData(form) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Upload failed.');
    setStatus(statusElement, payload.message, 'success');
    form.reset();
    await loadAdminUploads(false);
  } catch (error) {
    setStatus(statusElement, error.message, 'error');
  }
}

function validateFile(file) {
  if (!file) return 'Choose a document file before submitting.';
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) return 'Unsupported file type. Accepted: PDF, DOCX, DOC, TXT, JPG, JPEG, PNG.';
  if (file.size > MAX_FILE_BYTES) return 'File is too large. Maximum size is 25 MB per file.';
  return '';
}

async function handlePublicSearch(event) {
  event.preventDefault();
  selectors.publicResults.innerHTML = '<p class="empty">Searching approved public records...</p>';
  try {
    const query = new URLSearchParams(new FormData(selectors.publicSearchForm));
    const payload = await api(`/api/public/search?${query.toString()}`);
    selectors.publicResults.innerHTML = payload.results.length ? payload.results.map(renderPublicCard).join('') : '<p class="empty">No approved public records matched.</p>';
  } catch (error) {
    selectors.publicResults.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
  }
}

async function downloadCsv(event) {
  event.preventDefault();
  try {
    const response = await fetch('/api/admin/uploads/export.csv', { headers: adminHeaders() });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'CSV export failed.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'record-room-uploads.csv';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

async function loadAdminUploads(showErrors = true) {
  if (!adminToken()) return;
  selectors.adminList.innerHTML = '<p class="empty">Loading admin review queue...</p>';
  try {
    const query = new URLSearchParams(new FormData(selectors.adminFilters));
    const payload = await api(`/api/admin/uploads?${query.toString()}`, { headers: adminHeaders() });
    selectors.adminList.innerHTML = payload.documents.length ? payload.documents.map(renderAdminCard).join('') : '<p class="empty">No uploads matched.</p>';
    selectors.adminList.querySelectorAll('[data-save-upload]').forEach((button) => button.addEventListener('click', saveUploadEdits));
    selectors.adminList.querySelectorAll('[data-create-profile]').forEach((button) => button.addEventListener('click', createProfileFromUpload));
    selectors.adminList.querySelectorAll('[data-show-text]').forEach((button) => button.addEventListener('click', showExtractedText));
  } catch (error) {
    if (showErrors) selectors.adminList.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
  }
}

function renderPublicCard(doc) {
  return `<article class="recordCard">
    <h3>${escapeHtml(doc.subject_name || 'Approved record')}</h3>
    <p><strong>Role:</strong> ${escapeHtml(doc.subject_role || 'not specified')} · <strong>Court:</strong> ${escapeHtml(doc.court || 'not specified')}</p>
    <p><strong>Location:</strong> ${escapeHtml([doc.county, doc.state].filter(Boolean).join(', ') || 'not specified')} · <strong>Case:</strong> ${escapeHtml(doc.case_number || 'not provided')}</p>
    <p><strong>Source label:</strong> ${escapeHtml(doc.source_label || 'unknown source')}</p>
    <p><strong>Reliability tags:</strong> ${escapeHtml(doc.reliability_tags || 'needs admin review')}</p>
    <p><strong>Summary:</strong> ${escapeHtml(doc.public_summary || doc.description || 'Approved source record. No public summary has been added yet.')}</p>
    <small>Approved public record. User-submitted allegations are not displayed as verified facts unless tied to approved source records.</small>
  </article>`;
}

function renderAdminCard(doc) {
  return `<article class="adminCard" data-upload-id="${doc.id}">
    <div class="adminCardHeader">
      <div>
        <h3>#${doc.id} ${escapeHtml(doc.original_filename)}</h3>
        <p>${pill(doc.review_status)} ${pill(doc.visibility)} ${pill(doc.redaction_status)} ${pill(doc.extraction_status)}</p>
      </div>
      <div class="adminActions">
        <a class="buttonLink" href="/api/admin/uploads/${doc.id}/download?token=${encodeURIComponent(adminToken())}" target="_blank" rel="noopener">Download original</a>
        <button type="button" data-show-text="${doc.id}">See extracted text</button>
        <button type="button" data-create-profile="${doc.id}">Create profile from upload</button>
      </div>
    </div>
    <div class="grid three editGrid">
      ${input('subject_name', 'Subject/name', doc.subject_name)}
      ${select('subject_role', 'Subject role', doc.subject_role, config.professionalRoles)}
      ${input('court', 'Court', doc.court)}
      ${input('county', 'County', doc.county)}
      ${input('state', 'State', doc.state)}
      ${input('case_number', 'Case number', doc.case_number)}
      ${input('document_type', 'Document type', doc.document_type)}
      ${input('source_type', 'Source type', doc.source_type)}
      ${select('source_label', 'Source label', doc.source_label, config.sourceLabels)}
      ${select('review_status', 'Review status', doc.review_status, ['pending', 'approved', 'rejected'])}
      ${select('visibility', 'Visibility', doc.visibility, ['private', 'public', 'admin-only', 'needs redaction'])}
      ${select('redaction_status', 'Redaction', doc.redaction_status, ['not_requested', 'needs redaction', 'redacted'])}
    </div>
    <label>Reliability tags<input data-field="reliability_tags" value="${escapeHtml(doc.reliability_tags || '')}" /></label>
    <label>Tags/allegation categories<input data-field="tags" value="${escapeHtml(doc.tags || '')}" /></label>
    <label>Public summary<textarea data-field="public_summary">${escapeHtml(doc.public_summary || '')}</textarea></label>
    <label>Admin notes<textarea data-field="admin_notes">${escapeHtml(doc.admin_notes || doc.notes || '')}</textarea></label>
    <details><summary>AI-ready source-bound summary structure</summary><pre>${escapeHtml(doc.ai_summary_json || '{}')}</pre></details>
    <div class="extractedText" id="text-${doc.id}">${escapeHtml(doc.extraction_preview || '[No extracted preview available.]')}</div>
    <button type="button" data-save-upload="${doc.id}">Save metadata / status</button>
  </article>`;
}

async function saveUploadEdits(event) {
  const card = event.currentTarget.closest('[data-upload-id]');
  const id = card.dataset.uploadId;
  const body = {};
  card.querySelectorAll('[data-field]').forEach((input) => { body[input.dataset.field] = input.value; });
  try {
    event.currentTarget.disabled = true;
    await api(`/api/admin/uploads/${id}`, { method: 'PATCH', headers: { ...adminHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await loadAdminUploads();
  } catch (error) {
    alert(error.message);
  } finally {
    event.currentTarget.disabled = false;
  }
}

async function createProfileFromUpload(event) {
  const id = event.currentTarget.dataset.createProfile;
  try {
    const payload = await api(`/api/admin/uploads/${id}/create-profile`, { method: 'POST', headers: adminHeaders() });
    alert(`Profile created/assigned: ${payload.profile?.name || 'profile'}`);
  } catch (error) {
    alert(error.message);
  }
}

async function showExtractedText(event) {
  const id = event.currentTarget.dataset.showText;
  const target = document.querySelector(`#text-${id}`);
  target.textContent = 'Loading extracted text...';
  try {
    const payload = await api(`/api/admin/uploads/${id}/text`, { headers: adminHeaders() });
    target.textContent = payload.text || `[${payload.extractionStatus}] ${payload.extractionMessage || 'No text extracted yet.'}`;
  } catch (error) {
    target.textContent = error.message;
  }
}

function input(field, label, value) {
  return `<label>${escapeHtml(label)}<input data-field="${field}" value="${escapeHtml(value || '')}" /></label>`;
}

function select(field, label, value, options) {
  return `<label>${escapeHtml(label)}<select data-field="${field}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (url.startsWith('/api/admin/') && !url.startsWith('/api/admin/login') && adminToken()) headers.set('X-Admin-Token', adminToken());
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

function hydrateAdminToken() {
  const queryToken = new URLSearchParams(location.search).get('token');
  const savedToken = localStorage.getItem('recordRoomAdminToken');
  const token = queryToken || savedToken || config.localDevAdminToken || '';
  if (selectors.adminToken) selectors.adminToken.value = token;
  if (token) localStorage.setItem('recordRoomAdminToken', token);
  if (!config.isProduction && config.localDevAdminToken) console.info(`Record Room local-dev admin token: ${config.localDevAdminToken}`);
}

function applyRouteMode() {
  const path = location.pathname;
  document.body.classList.toggle('route-admin', path.startsWith('/admin'));
  document.body.classList.toggle('route-submit', ['/submit', '/record-room-submit'].includes(path));
  document.body.classList.toggle('route-upload', path === '/upload');
  document.body.classList.toggle('route-search', ['/search', '/public-search'].includes(path));
  document.body.classList.toggle('route-profiles', path === '/profiles');
  if (path.startsWith('/admin')) document.title = 'Admin dashboard · Record Room AI';
}

function adminToken() { return selectors.adminToken?.value.trim() || config.localDevAdminToken || ''; }
function adminHeaders() { return adminToken() ? { 'X-Admin-Token': adminToken() } : {}; }
function setStatus(element, message, type) { element.className = `status ${type}`; element.textContent = message; }
function clearStatus(element) { element.className = 'status'; element.textContent = ''; }
function pill(text) { return `<span class="pill">${escapeHtml(text || 'unset')}</span>`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
