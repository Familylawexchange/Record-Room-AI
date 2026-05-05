# The Record Room AI

The Record Room AI is a full-stack, source-labeled legal accountability database for judges, lawyers, guardians ad litem, prosecutors, custody evaluators, court staff, agencies, and related legal professionals.

The app supports:

- **Local/private admin mode** for uploading files from your computer into persistent local storage.
- **Public submission mode** for outside users to submit documents into a private pending review queue.
- **Research/scanner mode** for manual/import research leads and connector-safe scanner job placeholders.
- **Public search** limited to approved, public, non-confidential, non-redaction-needed records.

## Run locally

```bash
npm install
npm run dev
```

You can also run:

```bash
node server.js
```

The default local URL is `http://localhost:5173`.

## Main routes

- Admin dashboard: `http://localhost:5173/admin`
- Local/private upload: `http://localhost:5173/upload`
- Public submission portal: `http://localhost:5173/submit`
- Review queue: `http://localhost:5173/review`
- Documents manager: `http://localhost:5173/documents`
- Profiles manager: `http://localhost:5173/profiles`
- Research leads / Trellis manual import: `http://localhost:5173/leads`
- Scanner job placeholders: `http://localhost:5173/scanner`
- Public search: `http://localhost:5173/search`
- Backend health JSON: `http://localhost:5173/health`

`/health` returns server status, database status, `dataRoot`, `databasePath`, and the current SQLite table list.

## Local storage

The app intentionally stores local data inside the project directory, not at the drive root:

- Data root: `./record-room-data`
- Uploaded originals: `./record-room-data/uploads`
- Extracted text files: `./record-room-data/extracted-text`
- SQLite database: `./record-room-data/database.sqlite`

Startup safely creates required tables if they are missing and does not destroy existing data.

## How uploads and publication work

1. Local uploads on `/upload` save the original file, metadata, extraction status, extracted text, review queue entry, hashes, and search-index text in SQLite.
2. Public submissions on `/submit` are always `pending` and `private` by default.
3. Admin review happens on `/review` and `/documents`.
4. To approve a record for public search, edit the document metadata so that it is approved/public and not marked sealed/confidential or needing redaction.
5. `/search` only returns records marked approved/public and excludes pending, private, rejected, admin-only, sealed/confidential, and needs-redaction records.

The public no-result message is: “No approved public records are currently available for this search.” The app does not state “No issues found.”

## Research leads and commercial platforms

`/leads` is the manual/import workspace for Trellis Law, Westlaw, Lexis, UniCourt, Docket Alarm, vLex/Fastcase, PACER, CourtListener, official court sites, appellate courts, official discipline sources, public/news sources, and other sources.

Commercial legal research platforms are treated as **leads, not final verification**. Trellis Law, Westlaw, Lexis, UniCourt, and Docket Alarm are manual/import only unless API/license-compatible access is configured. The app must not scrape or bypass paywalls, logins, CAPTCHA, robots.txt, sealed records, protected records, or terms of use.

## Scanner placeholders and adding connectors later

`/scanner` stores connector-based scanner jobs. It includes placeholders for CourtListener/RECAP, state appellate opinions, Georgia re:SearchGA, Florida county clerk portals, California superior court portals, Ohio clerk/common pleas/domestic relations portals, South Carolina Public Index, South Carolina C-Track, Texas re:SearchTX, official bar/judicial discipline sources, Trellis manual/import, and Westlaw/Lexis/UniCourt/Docket Alarm manual/import.

To add a connector later:

1. Confirm the source permits API access or compatible automated access.
2. Add credentials/config through environment variables, not committed source code.
3. Write results into `raw_results` or `research_leads`.
4. Add a `review_queue` item.
5. Never publish connector results automatically.

## Source-bound AI summaries

The database stores AI-ready summary JSON placeholders. Public AI summaries must be source-bound, must not use unapproved records, must link claims to sources, and must distinguish official findings, appellate findings, court-record-supported filings/orders, filed allegations not adjudicated, disciplinary findings, user-submitted allegations, commercial-platform leads, self-promotional sources, and conflicting information.

The app should not label people with conclusions such as “corrupt,” “bad judge,” or “bad lawyer.” Allegations should use careful language such as “A filed motion alleged…” or “The database contains a user-submitted document alleging…”.

## Deployment later

The current local development server is a Node HTTP server. For deployment:

1. Set `NODE_ENV=production`.
2. Set a strong `RECORD_ROOM_ADMIN_TOKEN`.
3. Configure persistent disk storage for `record-room-data` or set `RECORD_ROOM_DATA_DIR` to a durable volume.
4. Add real authentication before exposing admin routes broadly.
5. Add malware scanning, rate limiting, redaction tooling, backup policy, HTTPS, and connector credentials as needed.
