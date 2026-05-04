# Record Room AI

A secure, local-first AI-assisted legal document intake and review web app for organizing uploaded court transcripts, court orders, motions, exhibits, and official records by case/project.

## Current phase: no-account document upload portal

Record Room AI now includes a simple intake portal that does **not** require accounts or authentication yet.

- Collects submitter name, email, case/project name, document type, optional notes, and one or more files.
- Accepts PDF, DOCX, TXT, JPG/JPEG, and PNG files.
- Generates a unique case ID for every submission, such as `RR-20260504-AB12CD34`.
- Saves upload metadata, extracted text, extraction status, source references, and file blobs in the browser's IndexedDB as a **local-only private-storage simulation**.
- Shows upload progress, success states, validation errors, storage errors, and extraction errors.
- Extracts TXT, DOCX, and best-effort embedded PDF text locally in the browser.
- Preserves document names, page numbers/source locators when available, extraction previews, and processing status (`uploaded`, `processing`, `processed`, `failed`).
- Provides an admin preview list grouped by case/project without adding full user authentication.
- Keeps the existing citation-backed document analysis shell.
- Leaves explicit placeholders for scanned PDF/image OCR and OpenAI AI pattern analysis.

> Local-only note: this static phase does not upload files to a server. IndexedDB data is private to the current browser profile/device, but it is still a development simulation rather than production private object storage.

## Core safeguards

- **Uploaded documents only:** reports are generated exclusively from text extracted from files selected by the user, or from placeholder text when extraction is not implemented yet.
- **Citation-backed output:** every timeline event, repeated procedural pattern, and potential course-of-conduct finding includes a quoted source passage with document and page references when source text is available.
- **Fact-pattern discipline:** the app labels actor-based results as fact patterns for attorney review and avoids conclusions about intent, bias, misconduct, ethics violations, or liability.
- **Browser-side processing in this phase:** intake, simulated private storage, metadata listing, and the current analysis shell run in the browser; no remote AI provider, search index, or outside legal corpus is contacted.

## Supported uploads

- PDF (`.pdf`)
- DOCX (`.docx`)
- TXT (`.txt`)
- JPG/JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)

Extraction behavior in this static local-first phase:

- TXT files are read directly in the browser.
- DOCX files are parsed locally by reading `word/document.xml` from the uploaded DOCX ZIP package. Current Microsoft Edge and Google Chrome builds include the browser `DecompressionStream` API needed for compressed DOCX entries; if another browser lacks it, the app shows a clear local extraction error.
- PDFs use a best-effort local parser for embedded text operators and Flate-compressed streams. This works for many text PDFs but is not a replacement for PDF.js or a backend parser.
- Scanned PDFs and JPG/JPEG/PNG images are kept private and receive a clear OCR placeholder. Add a local Tesseract.js worker or private backend OCR job at the marked placeholder before AI analysis.
- Every document stores extracted text, a preview, extraction status/message/error, document name, page number when available, and source locator metadata in IndexedDB.

## Exact Windows run instructions

These steps work in Windows PowerShell.

1. Install Node.js LTS from <https://nodejs.org/>.
2. Open **PowerShell**.
3. Go to the project folder. If the repo is in Downloads, run:

   ```powershell
   cd $env:USERPROFILE\Downloads\Record-Room-AI
   ```

   If you cloned it somewhere else, replace the path after `cd` with your actual folder path.

4. Verify Node and npm are available:

   ```powershell
   node --version
   npm --version
   ```

5. Install dependencies. This project currently uses no external npm packages; extraction relies on built-in browser APIs. This command prepares the local npm project:

   ```powershell
   npm install
   ```

6. Start the local web server:

   ```powershell
   npm run dev
   ```

7. Open the app in your browser:

   ```text
   http://localhost:5173
   ```

8. Keep the PowerShell window open while using the app. To stop the server, click the PowerShell window and press:

   ```text
   Ctrl+C
   ```

## Development

```bash
npm run dev
npm run test
```

`npm run dev` starts a static local server on port 5173. `npm run test` currently runs a JavaScript syntax check.

### Extraction and OCR dependencies

No npm dependencies are required for the current static build.

Required runtime tools:

- Node.js LTS and npm for the local development server/test script.
- A modern browser with IndexedDB, `Blob`, `FileReader`, and `DecompressionStream` support for DOCX ZIP/PDF Flate decompression. Use current Microsoft Edge or Google Chrome on Windows for best local DOCX/PDF extraction support.

Future OCR dependency placeholder:

- Scanned PDFs and JPG/PNG OCR should connect next to either a local Tesseract.js worker bundled with the app or a private backend OCR service.
- Keep uploaded files private. Do not send original file blobs to OpenAI pattern analysis. The OpenAI integration placeholder should receive only extracted text snippets with document/page/source references.

## Review workflow

1. Enter submitter name, email, case/project name, document type, optional notes, and one or more accepted files.
2. Submit the upload to generate a unique case ID and save metadata/files in local-only simulated private storage.
3. Review the admin document list grouped by case/project.
4. Select a case to inspect extracted document counts, text previews, timeline events, repeated procedural patterns, and actor-based fact patterns in the existing analysis shell.
5. Export the citation-backed JSON report for attorney review or further analysis.

> This app supports legal document review. It does not provide legal advice or replace review by a licensed attorney.
