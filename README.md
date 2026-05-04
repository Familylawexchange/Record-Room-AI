# Record Room AI

A secure, local-first AI-assisted legal document review web app for organizing uploaded court transcripts, court orders, motions, exhibits, and official records by case.

## Core safeguards

- **Uploaded documents only:** reports are generated exclusively from text extracted from files selected by the user.
- **Citation-backed output:** every timeline event, repeated procedural pattern, and potential course-of-conduct finding includes a quoted source passage with document and page references.
- **Fact-pattern discipline:** the app labels actor-based results as fact patterns for attorney review and avoids conclusions about intent, bias, misconduct, ethics violations, or liability.
- **Browser-side processing:** text extraction and analysis run in the browser; no remote AI provider, search index, or outside legal corpus is contacted.

## Supported uploads

- TXT, Markdown, CSV, JSON, HTML, XML, log files, and other text-based court-record exports
- PDF, DOCX, and scanned exhibit content should be OCR/text-exported before upload so the browser can reliably quote source text

## Development

```bash
npm run dev
npm run test
```

## Review workflow

1. Enter a case ID and document type.
2. Upload one or more court records.
3. Select a case to inspect extracted document counts, timeline events, repeated procedural patterns, and actor-based fact patterns.
4. Export the citation-backed JSON report for attorney review or further analysis.

> This app supports legal document review. It does not provide legal advice or replace review by a licensed attorney.
