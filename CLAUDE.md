# Job Tracker — project guide for Claude

Personal, **local-only** job-application tracker for Omar. Others may clone it: each clone keeps its own data in `data/jobs.db` (gitignored, never commit `data/`).

## Run and test

```
npm install
npm run dev        # web http://localhost:5173 (Vite) + API http://localhost:3001 (tsx watch)
npm test           # node:test via tsx (server/*.test.ts)
npm run typecheck  # tsc --noEmit (src + server)
```

- PowerShell blocks `npm.ps1`: use `npm.cmd run dev`. VS Code: Ctrl+Shift+B runs the "Start Job Tracker" task (`.vscode/tasks.json`).
- `JOBS_DB=<path>` uses another DB file (test against a copy, never the real one); `PORT` moves the API and Vite's proxy follows it.
- **The dev server reloads on save and runs DB migrations on the real DB.** Back up `data/jobs.db` before schema changes (`new Database(...).backup(...)`).

## Stack and layout

React 18 + Vite + Tailwind (dark theme only), Express 4 + better-sqlite3, recharts (bar charts) and d3-sankey (flow chart), fflate (unzips the LinkedIn export in the browser).

```
server/index.ts      every API route + background jobs (logo queue, openings scan, description fill, ghosting)
server/db.ts         schema + one-time migrations (guarded by `settings` keys or column checks)
server/contacts.ts   CSV parsing, LinkedIn connections/messages, company-name matching, Sankey data
server/linkedin.ts   LinkedIn company pages, profiles, posts; logo lookup
server/openings.ts   LinkedIn guest job search, careers pages + job boards, LinkedIn/Workable job import
server/jobpages.ts   Indeed / Wuzzuf / jobs.workable.com job pages (schema.org JobPosting), pages sent by the extension
server/cvs.ts        CV file checks, default labels, Content-Disposition (keeps the original file name)
server/quiz.ts       question-file parsing (role → topics → mcq/card questions), shuffle
src/pages/*          Dashboard, Companies, Applications (Jobs.tsx), Openings, Contacts, Map, Settings
src/components/*     JobForm (import, steps), Steps, FlowChart, DateInput, Contacts, CompanyLogo…
src/dates.ts         all dates shown day/month/year
extension/           Chrome/Edge MV3 extension: opens a small popup window on /quick?import=<url>&title=… (QuickAdd page, no menu)
```

## Domain rules

- **Stages:** Saved → Applied → Screening → HR interview → Technical interview → Shortlisted → Final interview → Offer; closed: Rejected, Withdrawn, Ghosted. "Applied" = past the first stage.
- **Steps** (`stage_history`) are editable with dates; the job's stage is its latest step and its applied date the first step past Saved (`syncFromHistory`). Manual steps are stored at 12:00 on their day. Changing "Applied on" moves the Applied step (`alignAppliedStep`).
- **Ghosting:** an applied job in an open stage with no new step for 60 days → Ghosted (startup, every 12 h, and on save). A LinkedIn posting showing "No longer accepting applications" → Ghosted, never Rejected.
- **Applied via:** email / company website / LinkedIn / other. Imported LinkedIn jobs → LinkedIn; Workable → company website; Indeed/Wuzzuf → other. A LinkedIn link picked by hand is usually a recruiter's **post** ("LinkedIn post link").
- **Referrers:** up to 3 contacts per application. **Talked to:** counts from LinkedIn `messages.csv` (never message text) or marked by hand (`talked_at`).
- **Openings** (separate from Applications): LinkedIn guest job search per company (company's country only) + careers pages via job-board feeds or JobPosting markup. Rate-limited: be gentle (delays, retries on 429).
- **Indeed and Wuzzuf block server fetches** (Indeed: login/bot check 401/403; Wuzzuf: Cloudflare 403). The extension (`grabJobPage` in `extension/shared.js`, `scripting` permission) reads the page in the tab and POSTs it to `/api/import/page` (kept 30 min in memory); the QuickAdd window imports with `&page=<id>`. On Indeed's search page (`?vjk=`) it fetches `/viewjob?jk=` from inside the tab, falling back to the side panel (`vj-job-title`, `company-info-metadata`, `simple-job-description-html`). jobs.workable.com/view pages the server fetches itself.
- **LinkedIn access without login:** company and job pages with a browser UA; profiles and posts only with the `facebookexternalhit/1.1` UA (link-preview bot). LinkedIn sometimes double-encodes entities: decode until stable.
- **Dates** show as dd/mm/yyyy everywhere (`DateInput`, `dmy`); the browser's native date input is only used for its calendar popup.
- Work type includes `unknown` (default for new applications).
- **CVs** (`cvs` table, files as BLOBs, CVs page): Omar's CV files all share one name (`Omar Ali Omar Elsayed.pdf`), so each version has a label (default `CV dd/mm/yyyy`). Downloads keep the original name. One CV is the default: new applications (form, QuickAdd, "I applied" on Openings) start on it; existing ones were left empty on purpose. `jobs.cv_id` = the CV applied with; a CV in use can't be deleted ("Replace file" keeps the same CV). Included in export/import.
- **Quiz** (`quiz_sets` / `quiz_questions` / `quiz_attempts`, Quiz page): question sets imported from JSON `{ role, topics: [{ topic, questions: [{ id, type: mcq|card, question, options?, answer }] }] }`. One set per role; re-importing the same role updates by question id and keeps answers. Every answer is stored; a question's status is its **latest** answer (right / missed / not tried), which drives the topic bars and "Practise the ones I missed". Flashcards count as right on "Knew it". Not linked to applications (Omar's choice). First set: `backend_developer_questions.json` (117 questions, 15 topics), imported 2026-10-24.

## Working notes for Claude

- Omar: plain, short replies; he tests in the browser and sends screenshots. Check UI changes with headless Edge over CDP (screenshots at ~1400–1800 px).
- In Python patch scripts, `\n` inside TS strings becomes a real newline: use the Edit tool for those lines.
- Git: `main`, local only (no remote). Commit with the Co-Authored-By trailer; **never push** unless Omar asks.
