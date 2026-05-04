const documents = [];
let activeCase = 'CASE-001';

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
  caseId: document.querySelector('#case-id'),
  caseSelect: document.querySelector('#case-select'),
  documentType: document.querySelector('#document-type'),
  fileInput: document.querySelector('#file-input'),
  status: document.querySelector('#status'),
  documents: document.querySelector('#documents'),
  boundary: document.querySelector('#boundary'),
  documentCount: document.querySelector('#document-count'),
  timelineCount: document.querySelector('#timeline-count'),
  patternCount: document.querySelector('#pattern-count'),
  reportOutput: document.querySelector('#report-output'),
  exportReport: document.querySelector('#export-report'),
};

elements.fileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  elements.status.textContent = `Extracting available text from ${files.length} document(s) in your browser...`;

  const caseId = elements.caseId.value.trim() || 'Unassigned Case';
  const documentType = elements.documentType.value;
  const extracted = await Promise.all(files.map((file) => buildDocument(file, caseId, documentType)));
  documents.push(...extracted);
  activeCase = caseId;
  event.target.value = '';
  elements.status.textContent = `Added ${extracted.length} document(s). Review remains limited to uploaded source text.`;
  render();
});

elements.caseSelect.addEventListener('change', (event) => {
  activeCase = event.target.value;
  render();
});

elements.exportReport.addEventListener('click', () => downloadReport(buildReport(activeCase, activeDocuments())));

async function buildDocument(file, caseId, documentType) {
  const text = await extractText(file);
  const doc = {
    id: crypto.randomUUID(),
    caseId,
    name: file.name,
    type: documentType,
    uploadedAt: new Date().toISOString(),
    pages: splitTextIntoPages(text),
    actors: [],
  };
  doc.actors = extractActors(doc);
  return doc;
}

async function extractText(file) {
  const text = await file.text();
  const normalized = normalizeWhitespace(text);
  return normalized || '[No extractable text found. OCR or text-export this source, then upload the resulting text file.]';
}

function splitTextIntoPages(text) {
  const explicitPages = text.split(/\f|\n\s*Page\s+\d+\s*\n/i).map(normalizeWhitespace).filter(Boolean);
  const chunks = explicitPages.length > 1 ? explicitPages : chunkWords(normalizeWhitespace(text), 350);
  return chunks.map((chunk, index) => ({ page: index + 1, text: chunk }));
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
  return {
    caseId,
    generatedAt: new Date().toISOString(),
    documentCount: docs.length,
    timeline,
    repeatedPatterns,
    coursesOfConduct: buildCoursesOfConduct(docs),
    sourceBoundary: `This report is limited to ${docs.length} uploaded document(s) for case ${caseId}. It identifies quoted fact patterns, not legal findings.`,
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
  const cases = Array.from(new Set([...documents.map((doc) => doc.caseId), activeCase])).sort();
  elements.caseSelect.innerHTML = cases.map((caseId) => `<option ${caseId === activeCase ? 'selected' : ''}>${escapeHtml(caseId)}</option>`).join('');

  const docs = activeDocuments();
  elements.documents.innerHTML = docs.length
    ? docs.map((doc) => `<article class="docCard"><strong>${escapeHtml(doc.name)}</strong><span>${escapeHtml(doc.type)} · ${doc.pages.length} page(s) · ${doc.actors.length} actor mention(s)</span></article>`).join('')
    : '<p class="empty">No documents uploaded for this case yet.</p>';

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
  return `<article class="evidence"><h4>${escapeHtml(title)}</h4>${body ? `<p>${escapeHtml(body)}</p>` : ''}${citations.slice(0, 5).map((citation) => `<blockquote>“${escapeHtml(citation.quote)}”<cite>${escapeHtml(citation.documentName)}, p. ${citation.page}</cite></blockquote>`).join('')}</article>`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

render();
