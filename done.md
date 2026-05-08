# Phase 1 Done: Document Upload + Parsing Foundation

## What existed before

- Upload endpoint already accepted files and saved metadata into SQLite.
- Storage supported local disk and Cloudflare R2, but env handling depended on process startup environment.
- PDF extraction was placeholder-grade:
  - best-effort text scraping from raw bytes only,
  - no proper PDF parser integration,
  - many PDFs (especially scanned/complex PDFs) could return weak or pending extraction.
- Download handler always streamed from local `file_path` and did not properly support streaming from R2 URLs.
- `documents` table did not persist a dedicated `storage_provider` column for reliable local-vs-R2 retrieval logic.

## What was implemented now

### 1) Environment loading and compatibility

- Added automatic `.env` loading at startup in `server.js` via `dotenv`.
- Added compatibility fallback for legacy R2 env names:
  - supports both `CLOUDFLARE_R2_*` and `R2_*`.

### 2) PDF parsing improvements

- Added `pdf-parse` based extraction path for `.pdf` uploads.
- Added `parsePdfText()` helper with:
  - extracted text normalization,
  - robust error handling,
  - explicit extraction status messages.
- Kept fallback text extraction for resilience when parser fails.

### 3) Storage provider persistence and migration

- Added `storage_provider` column to `documents` schema with default `local`.
- Added safe migration in `applySafeMigrations()` for existing databases.
- Updated upload insert query to store provider (`local` or `cloudflare-r2`) per document.

### 4) R2 download support

- Updated download endpoint logic:
  - stream local files from disk when provider is local,
  - stream object directly from R2 when provider is `cloudflare-r2`.

## Smoke tests performed

## Date
- 2026-05-08

## Results

- Health check:
  - `GET /health` returned `server: running` and `database: connected`.
- Upload test:
  - `POST /api/uploads/local` with `smoke-test.pdf` returned:
    - `ok: true`
    - `storageProvider: cloudflare-r2`
    - `extractionStatus: processed`
    - document persisted with `storage_provider: cloudflare-r2`.
- Extraction readback:
  - `GET /api/admin/uploads/2/text` returned extracted text and `processed` status.
- Download readback:
  - `GET /api/admin/uploads/2/download` returned the uploaded file content through API successfully.

## Current status

- Phase 1 core is working end-to-end:
  - PDF upload works,
  - R2 storage works,
  - text extraction is persisted and queryable,
  - uploaded file retrieval works for R2-backed records.

## Remaining known limitations (expected for next phases)

- Scanned PDFs without embedded text still require OCR workflow.
- Malware scanning remains a placeholder.
- AI retrieval/search quality improvements are deferred to next phases.
