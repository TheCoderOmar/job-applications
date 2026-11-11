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
server/locations.ts  LinkedIn "Locations" cards/HTML → offices (country, tags, address, city)
server/geocode.ts    address → pin (Nominatim; Google when settings.google_maps_key is set), fallback searches
server/companyLocations.ts  company_locations storage, primary mirrored on companies, background geocode queue
server/linkedinTab.ts what the extension reads from a LinkedIn tab; post → company guess
server/defaults.ts   starter companies (seed/default-companies.json) on first run / from Settings
server/update.ts     git fetch/ff-only update from origin/main
server/jobpages.ts   Indeed / Wuzzuf / jobs.workable.com job pages (schema.org JobPosting), pages sent by the extension
server/cvs.ts        CV file checks, default labels, Content-Disposition (keeps the original file name)
server/quiz.ts       question-file parsing (role → topics → mcq/card questions), shuffle
src/pages/*          Dashboard, Companies, Applications (Jobs.tsx), Openings, Contacts, Map, Settings
src/components/*     JobForm (import, steps), Steps, FlowChart (layout in flowLayout.ts: a band that skips a stage gets invisible `pass` stops so it runs under that column, tested), DateInput, Contacts, CompanyLogo…
src/dates.ts         all dates shown day/month/year
extension/           Chrome/Edge MV3 extension: opens a small popup window on /quick?import=<url>&title=… (QuickAdd page, no menu)
```

## Domain rules

- **Stages:** Saved → Applied → Screening → HR interview → Technical interview → Managerial interview → Shortlisted → Final interview → Offer; closed: Rejected, Withdrawn, Ghosted. "Applied" = past the first stage.
- **Steps** (`stage_history`) are editable with dates; the job's stage is its latest step and its applied date the first step past Saved (`syncFromHistory`). Manual steps are stored at 12:00 on their day. Changing "Applied on" moves the Applied step (`alignAppliedStep`). A job in the first stage (Saved) never has an applied date (server clears it); in the form, entering "Applied on" on a Saved job moves it to Applied, and picking Saved clears the date. Steps may be dated in the **future** (an interview Omar's been invited to; shown "Upcoming"); "Applied on" stays capped at today.
- **Applications list defaults to "Include not applied yet"** (Omar logged jobs twice when Saved ones were hidden); `?applied=1` shows applied only, and saving a not-applied job there switches back to all.
- **Ghosting:** an applied job in an open stage with no new step for 60 days → Ghosted (startup, every 12 h, and on save). A LinkedIn posting showing "No longer accepting applications" → Ghosted, never Rejected.
- **Applied via:** email / company website / LinkedIn / other. Imported LinkedIn jobs → LinkedIn; Workable → company website; Indeed/Wuzzuf → other. A LinkedIn link picked by hand is usually a recruiter's **post** ("LinkedIn post link").
- **Referrers:** up to 3 contacts per application. **Talked to:** counts from LinkedIn `messages.csv` (never message text) or marked by hand (`talked_at`).
- **Openings** (separate from Applications): LinkedIn guest job search per company (company's country only) + careers pages via job-board feeds or JobPosting markup. Rate-limited: be gentle (delays, retries on 429).
- **Indeed and Wuzzuf block server fetches** (Indeed: login/bot check 401/403; Wuzzuf: Cloudflare 403). The extension (`grabJobPage` in `extension/shared.js`, `scripting` permission) reads the page in the tab and POSTs it to `/api/import/page` (kept 30 min in memory); the QuickAdd window imports with `&page=<id>`. On Indeed's search page (`?vjk=`) it fetches `/viewjob?jk=` from inside the tab, falling back to the side panel (`vj-job-title`, `company-info-metadata`, `simple-job-description-html`). jobs.workable.com/view pages the server fetches itself.
- **LinkedIn access without login:** job pages with a browser UA; company pages, profiles and posts only with the `facebookexternalhit/1.1` UA (link-preview bot). Since Nov 2026 LinkedIn answers browser-UA company requests with a 403 "Just a moment..." challenge (Fill from LinkedIn failed until the switch). If a company link 404s with the bot UA, the slug is wrong (e.g. Fekra is `fekra-egy`, not `fekra-egypt`). LinkedIn sometimes double-encodes entities: decode until stable.
- **Company locations** (`company_locations`): a company has 0..n offices; the primary one is mirrored on `companies.address/city/country/lat/lng/maps_link` (`syncPrimary`) so old code keeps working. Saving a company with a `locations` array replaces them; without one, its flat address updates the primary. Pins: typed / Maps link = `manual`; else the background queue geocodes offices that have a street **address** (bare cities stay unpinned — Omar's 17 city-only companies). `precision` area/city is shown as approximate.
- **Map highlight:** clicking a pin selects its company: its pins `pin-selected` (amber, pulse), others `pin-dim`; cleared on map click / popup close.
- **Extension kinds:** job / post / company / profile (`linkedInKind`, same rules in `extension/shared.js` and `server/linkedinTab.ts`). For company/profile/post the tab's DOM is read (`grabLinkedIn`) and sent as `data` with the page to `/api/import/page`; QuickAdd `?kind=company|contact`. LinkedIn's logged-in DOM selectors are guesses — if an import comes back thin, ask Omar to save the page (Ctrl+S) and fix the parser with it as a fixture.
- **Contacts:** `status` (message_sent | chatting | referred | NULL) and `favorite`; `PATCH /api/contacts/:id`. Becoming a referrer sets an empty status to referred.
- **Starter companies:** `npm run companies:export` rebuilds `seed/default-companies.json` from data/jobs.db (read-only; drops notes, is_current, "CompanyNNN" placeholders and duplicate names). Loaded once on an empty DB (`default_companies_loaded` setting).
- **Dates** show as dd/mm/yyyy everywhere (`DateInput`, `dmy`); the browser's native date input is only used for its calendar popup.
- Work type includes `unknown` (default for new applications).
- **Deleting an application:** "Delete" on the application page, and "Delete application" in the edit form (`onDeleted` prop on `JobForm`; only passed by the edit screens). Steps and referrers cascade; a linked opening is just unlinked.
- **Dropdowns** (`src/index.css`): every `select` draws our chevron (same inset as DateInput's calendar icon: `select.input` → right 0.75rem, 1rem). In Edge/Chrome 135+ `appearance: base-select` themes the open list (surface, border, raised hover, checked in brand-light). A base-select box only fits the option it shows, so `StageSelect` sizes itself with invisible copies of every stage name in an `inline-grid` (padding must match the select's: `pr-10`, since `select.input` overrides `pr-*`), keeping every row the same width (Omar noticed when they differed).
- **CVs** (`cvs` table, files as BLOBs, CVs page): Omar's CV files all share one name (`Omar Ali Omar Elsayed.pdf`), so each version has a label (default `CV dd/mm/yyyy`). Downloads keep the original name. One CV is the default: new applications (form, QuickAdd, "I applied" on Openings) start on it; existing ones were left empty on purpose. `jobs.cv_id` = the CV applied with; a CV in use can't be deleted ("Replace file" keeps the same CV). Included in export/import.
- **Quiz** (`quiz_sets` / `quiz_questions` / `quiz_attempts`, Quiz page): question sets imported from JSON `{ role, topics: [{ topic, questions: [{ id, type: mcq|card, question, options?, answer }] }] }`. One set per role; re-importing the same role updates by question id and keeps answers. Every answer is stored; a question's status is its **latest** answer (right / missed / not tried), which drives the topic bars and "Practise the ones I missed". Flashcards count as right on "Knew it". Not linked to applications (Omar's choice). First set: `backend_developer_questions.json` (117 questions, 15 topics), imported 2026-10-24.

## Working notes for Claude

- Omar: plain, short replies; he tests in the browser and sends screenshots. Check UI changes with headless Edge over CDP (screenshots at ~1400–1800 px).
- Desktop shortcut "Job Applications" → `C:\mainPC\Launchers\Job Applications.bat` (starts `npm.cmd run dev` minimized if :5173 isn't listening, then opens the browser). Never set a `PORT` env var there: the API reads it and would take Vite's port (proxy loop, `ENOBUFS`).
- The dev server runs migrations on the real DB as soon as `server/db.ts` is saved: back up `data/jobs.db` first (`data/jobs-backup-YYYY-MM-DD.db`, via sqlite's backup API since the DB is in WAL mode).
- Headless Edge with `--remote-debugging-port` may listen on `[::1]` only, and its first page target can be an `edge://` dialog: pick the `about:blank` target. `select.showPicker()` needs `userGesture: true` in `Runtime.evaluate`.
- In Python patch scripts, `\n` inside TS strings becomes a real newline: use the Edit tool for those lines.
- Git: `main`; remote `origin` = github.com/TheCoderOmar/job-applications (friends clone it, and the in-app update pulls from its `main`). Commit with the Co-Authored-By trailer; **never push** unless Omar asks — but updates only reach other people once he pushes.
- Windows scripts (`start.bat`, `setup.bat`, `scripts/make-shortcut.ps1`) must stay CRLF (`.gitattributes`). Writing `>nul` through Git Bash can turn into `>/dev/null`: check after writing .bat files.
- Test servers: `JOBS_NO_UPDATE_CHECK=1` skips the GitHub check; `JOBS_NO_BROWSER=1` stops start.bat opening the browser; `APP_PORT` moves Vite.
