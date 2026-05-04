# Record Room AI

A secure, local-first AI-assisted legal document intake and review web app for organizing uploaded court transcripts, court orders, motions, exhibits, and official records by case/project.

## Current phase: no-account document upload portal with OpenAI pattern analysis

Record Room AI now includes a simple intake portal that does **not** require accounts or authentication yet.

- Collects submitter name, email, case/project name, document type, optional notes, and one or more files.
- Accepts PDF, DOCX, TXT, JPG/JPEG, and PNG files.
- Generates a unique case ID for every submission, such as `RR-20260504-AB12CD34`.
- Saves upload metadata, extracted text, extraction status, source references, and file blobs in the browser's IndexedDB as a **local-only private-storage simulation**.
- Shows upload progress, success states, validation errors, storage errors, and extraction errors.
- Extracts TXT, DOCX, and best-effort embedded PDF text locally in the browser.
- Preserves document names, page numbers/source locators when available, extraction previews, and processing status (`uploaded`, `processing`, `processed`, `failed`).
- Provides an admin preview list grouped by case/project without adding full user authentication.
- Keeps the existing citation-backed local document analysis shell.
- Adds an OpenAI-powered pattern-analysis layer through a local Node API proxy that reads `OPENAI_API_KEY` from the environment.
- Adds a unified Actor Tracking & Conduct Analysis layer for judges, guardians ad litem, attorneys, prosecutors, clerks, DFCS/CPS workers, court staff, agency officials, and other court officials.
- Extracts actor profile fields from uploaded materials where available, including names, roles, offices/firms/agencies, bar or license numbers, signature/contact details from public filings, court/county/state, case numbers, represented party/served role, first/last appearance dates, and source documents.
- Tracks judge, GAL, attorney, prosecutor, clerk/staff/agency official fields; course-of-conduct indicators; actor interaction/alignment indicators; and motion/filing/order outcomes only when supported by cited uploaded text.
- Lets the user/admin ask custom questions about uploaded case documents and run preset analyses for timeline, unified actor profiles, judge conduct, GAL/guardian ad litem conduct, attorney conduct, prosecutor conduct, motion outcomes, actor interactions, due process concerns, notice/service issues, ex parte indicators, and contradictions between orders/transcripts.
- Adds UI filters for actor name/type, role served, represented party, prosecutor office, court, county, state, case number, document type, date range, issue type, and confidence level.
- Leaves explicit placeholders for scanned PDF/image OCR.

> Local-only note: uploaded file blobs remain in this browser profile/device IndexedDB. When OpenAI analysis is requested, the browser sends extracted page text, document names, page numbers/source locators, the selected preset/custom question, and case metadata to the local Node proxy. The original file blobs are not sent by the browser to OpenAI.

## Core safeguards

- **Uploaded documents only:** local reports and OpenAI requests are generated exclusively from text extracted from files selected by the user, or from placeholder text when extraction is not implemented yet.
- **Citation-backed output:** every timeline event, repeated procedural pattern, potential course-of-conduct finding, and AI finding is required to include a quoted source passage with document name and page reference when source text is available.
- **Fact-pattern discipline:** the app labels actor-based results as fact patterns for attorney review and instructs OpenAI to distinguish documented facts, reasonable inferences, possible legal issues, and unsupported allegations.
- **Identity verification:** the actor layer does not merge people by last name alone. It uses full name, initials, title, office, court, county, state, signature block, bar/license number, email, case number, and document context when available. Uncertain identities stay separate and are labeled “Possible match — needs human review.”
- **Pattern threshold:** Record Room AI does not call something a “pattern” unless there are at least two cited examples, unless a user specifically requests single-incident analysis.
- **No unsupported conclusions:** OpenAI instructions prohibit conclusions about intent, bias, misconduct, corruption, collusion, conspiracy, fraud, ex parte contact, due process violations, service defects, ethics violations, or liability unless quoted uploaded text directly establishes the limited factual premise.
- **Server-side API key:** the OpenAI API key is read only from `OPENAI_API_KEY` on the local Node server and is never hard-coded into the browser code.

## Unified Actor Tracking & Conduct Analysis

Record Room AI performs document-based actor tracking, course-of-conduct review, interaction/alignment review, and pattern analysis using uploaded materials only. The actor layer is designed for legal-document organization and human legal review; it does **not** decide that anyone acted improperly, violated a rule, or had a particular motive. All outputs require human legal review before use in court filings, complaints, investigations, or legal strategy.

The local report and OpenAI prompt support these report templates:

- Unified Actor Profile Report
- Judicial Pattern Report
- GAL Conduct Report
- Attorney Conduct & Activity Report
- Prosecutor Conduct & Activity Report
- Court Staff / Agency Conduct Report
- Course of Conduct Report
- Actor Interaction / Alignment Report
- Motion Outcome Chart
- Filing Frequency Report
- Hearing Participation Report
- Due Process Timeline
- Notice and Service Defect Report
- Ex Parte Indicator Report
- Contradiction Chart
- Missing Evidence Checklist
- Human Review Questions Report

The analysis layer uses neutral labels such as “alignment observed,” “recurring sequence observed,” “documented communication exists,” and “possible issue requiring human review.” If a motion outcome, identity match, date, quote, page number, notice/service fact, or prevailing party is unclear, the app labels it as not determinable from available documents rather than filling gaps.

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

5. Install dependencies. This project currently uses no external npm packages; extraction relies on built-in browser APIs and the OpenAI proxy uses Node built-ins. This command prepares the local npm project:

   ```powershell
   npm install
   ```

6. Set your OpenAI API key for the current PowerShell window. Replace `sk-your-api-key-here` with the key from your OpenAI account. Do **not** paste this key into source files.

   ```powershell
   $env:OPENAI_API_KEY="sk-your-api-key-here"
   ```

   Optional: choose a different OpenAI model for the analysis endpoint. If omitted, the server uses `gpt-5-mini`.

   ```powershell
   $env:OPENAI_MODEL="gpt-5-mini"
   ```

7. Start the local web server from the same PowerShell window so it can read `OPENAI_API_KEY`:

   ```powershell
   npm run dev
   ```

8. Open the app in your browser:

   ```text
   http://localhost:5173
   ```

9. Upload documents, select a case, and use the OpenAI pattern-analysis buttons or custom question box. If the app says the key is missing, stop the server, set `$env:OPENAI_API_KEY`, and run `npm run dev` again.

10. Keep the PowerShell window open while using the app. To stop the server, click the PowerShell window and press:

   ```text
   Ctrl+C
   ```


## OpenAI pattern-analysis behavior

The OpenAI analysis panel includes these presets:

1. Timeline of events
2. Pattern of conduct by judge
3. Pattern of conduct by GAL/guardian ad litem
4. Pattern of conduct by attorney
5. Due process concerns
6. Notice/service issues
7. Ex parte communication indicators
8. Contradictions between orders/transcripts
9. Unified Actor Profile Report
10. Prosecutor Conduct & Activity Report
11. Motion Outcome Chart
12. Actor Interaction / Alignment Report

For each request, the browser sends only extracted page text and source metadata to `/api/analyze`. The local Node server then calls the OpenAI Responses API using `OPENAI_API_KEY`. The prompt requires the model to:

- Use extracted uploaded-document text as the only source material.
- Cite document name, page number when available, and quoted source text for every finding.
- Distinguish facts from possible legal issues for human review.
- Avoid unsupported conclusions and explicitly state what is not established.
- Verify actor identity using more than last name when possible and label uncertain identities for human review.
- Track motion outcomes only when determinable; otherwise state “Outcome not determinable from available documents.”
- Require at least two cited examples before labeling something a pattern.
- Produce relevant actor, conduct, motion, issue, citation, missing-evidence, and human-review-question headings.

## Development

```bash
npm run dev
npm run test
```

`npm run dev` starts the local Node server on port 5173 and exposes `/api/analyze` as a server-side OpenAI proxy. `npm run test` runs JavaScript syntax checks for the browser app and the Node server.

### Extraction and OCR dependencies

No npm dependencies are required for the current static build.

Required runtime tools:

- Node.js LTS and npm for the local development server/test script.
- A modern browser with IndexedDB, `Blob`, `FileReader`, and `DecompressionStream` support for DOCX ZIP/PDF Flate decompression. Use current Microsoft Edge or Google Chrome on Windows for best local DOCX/PDF extraction support.

Future OCR dependency placeholder:

- Scanned PDFs and JPG/PNG OCR should connect next to either a local Tesseract.js worker bundled with the app or a private backend OCR service.
- Keep uploaded files private. Do not send original file blobs to OpenAI pattern analysis. The OpenAI integration receives extracted text snippets with document/page/source references through the local Node proxy.

## Review workflow

1. Enter submitter name, email, case/project name, document type, optional notes, and one or more accepted files.
2. Submit the upload to generate a unique case ID and save metadata/files in local-only simulated private storage.
3. Review the admin document list grouped by case/project.
4. Select a case to inspect extracted document counts, text previews, timeline events, unified actor profiles, repeated procedural patterns, motion outcomes, and actor-based fact patterns in the analysis shell.
5. Use the actor/conduct filters to narrow by actor, office, court, county, state, case number, document type, date range, issue type, or confidence level.
6. Use a preset OpenAI analysis button or enter a custom question about the uploaded case documents.
7. Review the AI report output headings, findings, citations, unsupported/not-established items, and suggested human review questions.
8. Export the citation-backed JSON report for attorney review or further analysis.

> This app supports legal document review. It does not provide legal advice, does not make final legal or ethics conclusions, and does not replace review by a licensed attorney. All actor-tracking, course-of-conduct, and pattern-analysis outputs require human legal review before use.
