const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 5173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const ROOT = __dirname;
const MAX_BODY_BYTES = 1_500_000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/analyze') {
      await handleAnalyze(request, response);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Record Room AI running at http://localhost:${PORT}`);
  console.log(OPENAI_API_KEY ? 'OpenAI analysis endpoint is enabled.' : 'OPENAI_API_KEY is not set; OpenAI analysis endpoint will return setup guidance.');
});

async function handleAnalyze(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST for OpenAI analysis.' });
    return;
  }
  if (!OPENAI_API_KEY) {
    sendJson(response, 503, { error: 'OPENAI_API_KEY is not set on the local Node server. Set it in PowerShell, restart npm run dev, and try again.' });
    return;
  }

  const payload = await readJsonBody(request);
  const validationError = validateAnalysisPayload(payload);
  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return;
  }

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: buildSystemInstructions(),
      input: buildAnalysisPrompt(payload),
      max_output_tokens: 2400,
    }),
  });

  const result = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    sendJson(response, openAiResponse.status, { error: result.error?.message || 'The OpenAI API request failed.' });
    return;
  }

  sendJson(response, 200, {
    analysis: extractResponseText(result),
    model: result.model || OPENAI_MODEL,
    responseId: result.id,
  });
}

function buildSystemInstructions() {
  return [
    'You are Record Room AI, an evidence-bound legal document analysis assistant.',
    'Use only the extracted document text supplied by the user. Do not use outside facts, web knowledge, assumptions, or legal research.',
    'Every finding must cite document name, page number if available, and a short quoted source passage copied from the supplied text.',
    'Distinguish observed facts from possible legal issues for human review.',
    'Avoid unsupported conclusions. Do not conclude misconduct, intent, bias, fraud, ex parte contact, due process violation, service defect, ethics violation, or liability unless the quoted text directly establishes it.',
    'If support is weak or missing, say what is not established and suggest a human review question instead.',
    'Return a concise Markdown report with these headings: Findings, Facts from the Documents, Possible Legal Issues for Human Review, Citations, Unsupported or Not Established, Suggested Human Review Questions.',
  ].join('\n');
}

function buildAnalysisPrompt(payload) {
  const sourcePages = payload.sourceMaterial.pages.map((page, index) => [
    `SOURCE ${index + 1}`,
    `Document: ${page.documentName}`,
    `Document type: ${page.documentType || 'Unknown'}`,
    `Page: ${page.page || 'Not available'}`,
    `Locator: ${page.sourceLocator || page.documentName}`,
    `Extracted text: ${page.text}`,
  ].join('\n')).join('\n\n---\n\n');

  return [
    `Case ID: ${payload.caseId || 'Not provided'}`,
    `Case name: ${payload.caseName || 'Not provided'}`,
    `Analysis type: ${payload.analysisType || 'Custom question'}`,
    `User/admin question: ${payload.question}`,
    payload.sourceMaterial.sourceBoundary || 'Source boundary: extracted uploaded-document text only.',
    payload.sourceMaterial.truncated ? 'Note: Source material was truncated for request size. Mention that a complete human review should inspect the full uploaded record.' : '',
    'Analyze the following extracted source material under the instructions above.',
    sourcePages,
  ].filter(Boolean).join('\n\n');
}

function extractResponseText(result) {
  if (typeof result.output_text === 'string' && result.output_text.trim()) return result.output_text.trim();
  const parts = [];
  for (const item of result.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      else if (content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim() || '[OpenAI returned no text output.]';
}

function validateAnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid analysis request.';
  if (!payload.question || typeof payload.question !== 'string') return 'An analysis question is required.';
  if (!payload.sourceMaterial || !Array.isArray(payload.sourceMaterial.pages)) return 'Extracted source material is required.';
  if (!payload.sourceMaterial.pages.length) return 'At least one extracted document page is required.';
  const invalidPage = payload.sourceMaterial.pages.find((page) => !page.documentName || !page.text);
  if (invalidPage) return 'Every source page must include a document name and extracted text.';
  return '';
}

async function serveStatic(pathname, response) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const requestedPath = safePath || 'index.html';
  const filePath = path.join(ROOT, requestedPath);
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const index = await fs.readFile(path.join(ROOT, 'index.html'));
      response.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
      response.end(index);
      return;
    }
    throw error;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Analysis request is too large. Upload fewer pages or split the case documents.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}
