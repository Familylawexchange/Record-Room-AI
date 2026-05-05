# Record Room AI

Record Room AI is now a full-stack Node application for two intake workflows:

1. **Local/private admin mode** for documents you upload from your own computer.
2. **Public submission portal mode** for user uploads that remain pending, private, and unpublished until an admin approves them.

## Storage and database

Local development uses real persistent storage instead of browser-only storage:

- Original uploads: `./record-room-data/uploads`
- Extracted text files: `./record-room-data/extracted-text`
- SQLite database: `./record-room-data/database.sqlite`

The server code keeps storage and database operations behind small helper layers so a later production build can replace local folders and SQLite with cloud object storage and a managed database.

## Supported upload types

Accepted files:

- PDF
- DOCX
- DOC
- TXT
- JPG/JPEG
- PNG

Maximum size: **25 MB per file**.

## Public submission safety

Public users must provide uploader details, subject/person/entity metadata, court/location/case metadata, document type/source information, description, tags/allegation categories, record category, and a document file.

Before submission, public users must check all required warnings:

- They should not upload sealed, confidential, protected, or unlawfully obtained documents.
- Submission does not guarantee publication.
- Documents may be reviewed, redacted, rejected, or kept private.
- They certify a good-faith basis for submitting the material.
- The Record Room may label submissions as user-submitted, unverified, alleged, court-record-supported, official-record-supported, or rejected.

Public submissions are stored as `pending` and `private` by default. Public search only returns records that are both `approved` and `public`.

## Admin dashboard

The admin dashboard provides a protected placeholder workflow using `X-Admin-Token` / `RECORD_ROOM_ADMIN_TOKEN`. Replace this with production authentication before deployment.

Admin features include:

- View all uploads.
- Filter by review status, visibility, role, county, state, and keyword.
- Download original files.
- View extracted text.
- Edit metadata.
- Approve or reject uploads.
- Mark records public, private, admin-only, or needs redaction.
- Add source reliability labels and reliability tags.
- Add public summaries and admin notes.
- Search uploaded documents, including extracted text.
- Export records as CSV.
- Create profile records from uploads.

## Document processing

When a file is uploaded, the server:

1. Validates file extension, MIME type, and size.
2. Saves the original file to persistent storage.
3. Creates a SQLite document record.
4. Extracts text when possible:
   - TXT: direct server-side text read.
   - DOCX: local `unzip` parser reads `word/document.xml`.
   - PDF: best-effort embedded-text extraction placeholder.
   - DOC: legacy parser placeholder.
   - JPG/JPEG/PNG: OCR placeholder.
5. Stores extracted text in the database and `./record-room-data/extracted-text`.
6. Keeps the file even if extraction is pending or failed.

## Profiles, source labels, and source-bound summaries

Profiles support judges, guardians ad litem, attorneys, prosecutors, evaluators, court staff, and other legal professionals. Profile fields include role, court/office/firm, county, state, bar number, known cases, associated documents, allegations/categories, official discipline, court-record-supported issues, user-submitted complaints, news/public references, source reliability summary, admin notes, and visibility.

Documents and claims are designed to carry source/reliability labels such as court order, appellate opinion, trial court filing, transcript, government record, bar record, judicial commission record, news article, user-submitted document, review, law firm website, social media, and unknown source. Reliability tags include verified official source, court-record supported, user-submitted, unverified allegation, self-promotional source, adversarial source, anonymous source, conflicting sources, and needs admin review.

The database includes an AI-ready source-bound summary structure that separates verified official information, court-record-supported information, user-submitted allegations, unresolved/conflicting information, self-promotional sources, and marketing/review-based sources. Claims must point back to source document records before they should be displayed as facts.

## Run locally

```bash
npm install
node server.js
```

The server starts on <http://localhost:5173> by default. Startup automatically creates `./record-room-data`, `./record-room-data/uploads`, `./record-room-data/extracted-text`, `./record-room-data/database.sqlite`, and the required SQLite schema. You can verify the runtime state at `/health` or safely rerun setup at `/setup`.

Useful environment variables:

```bash
PORT=5173
RECORD_ROOM_DATA_DIR=./record-room-data
RECORD_ROOM_ADMIN_TOKEN=local-dev-admin
OPENAI_API_KEY=sk-your-api-key
OPENAI_MODEL=gpt-5-mini
```

## Test

```bash
npm test
```

The test script runs JavaScript syntax checks for the browser app and the Node server.

## Deployment notes

The app can run on Node-capable hosts such as Render or Railway. For Vercel/Netlify-style deployments, keep the static frontend but connect API routes to a Node/serverless backend with equivalent storage/database adapters.

Before public production use:

- Replace the admin token placeholder with real authentication and authorization.
- Configure production database/storage adapters.
- Connect a malware scanner.
- Connect OCR/PDF/DOC extraction workers as needed.
- Review privacy, moderation, defamation, court-record, sealed-record, and data-retention policies with qualified counsel.
