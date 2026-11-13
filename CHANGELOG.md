# Changelog

All notable changes to Job Applications.

## [Unreleased]

### Added
- Applications have **recruiters** (up to 5): pick a contact, type a name or paste a LinkedIn profile link, in the form or with **Add recruiter** on the job page
- Browser extension 1.4.0: importing a LinkedIn job takes everyone under **Meet the hiring team** as recruiters, and adds them to your contacts (with their profile link and title) if they aren't there yet
- A **Features** page in the menu lists everything the app can do, with a search box

- Contacts: a **Waiting for connection** status, for people you sent a connection request to

### Fixed
- A job page no longer runs wider than a phone screen when the company has many connections

## [1.2.1] - 2026-11-11

### Changed
- Starter companies: 228 in all. The new Egypt companies use their LinkedIn names and pages (Abu Dhabi Commercial Bank, EGYPTAIR, Eastern Company, Intel, KPMG Middle East), and 11 more now have their LinkedIn page, details and offices (Bank NXT, Capgemini, Concentrix, Dell Technologies, Edita, Ezz Steel, Faisal Islamic Bank, Mansour Group, Nokia, Oracle, The Arab Contractors)
- Huawei, Teleperformance and Unilever are no longer in the starter list

On a copy you already use, **Settings → Starter companies** adds the ones you don't have yet.

## [1.2.0] - 2026-11-11

### Added
- Companies can have several offices: imported from LinkedIn's Locations, edited as a list, each put on the map from its address (OpenStreetMap, or Google with an API key in Settings), with a Google Maps link to check or correct it
- Map: every office has a pin; clicking one highlights all of that company's offices and fades the rest
- Browser extension 1.3.0 knows the LinkedIn page you're on: a company page imports the company with its offices, a profile imports the contact (and their company), a post imports a job with the company it's for
- Contacts: a status for each person (Message sent, Chatting, Referred), a status filter, and a Favourites tab
- Update check: the app looks for a new version on GitHub and updates itself with one click
- `setup.bat` installs everything and puts a Job Tracker icon on the desktop; `start.bat` is what the icon runs
- A new install starts with 231 companies (with offices and logos), including 50 of Egypt's biggest employers; Settings can add them back
- **Refresh all from LinkedIn** on the Companies page: every company's details and offices read again in the background, without overwriting what you typed
- **Find all jobs on LinkedIn** on the Companies page: the openings scan for every company, with progress
- Company cards show how many jobs you applied to there and how many openings it has (click it to see them)
- Applied via **Wuzzuf** is its own channel, and a company can keep its Wuzzuf page next to its LinkedIn page
- **Settings → Check for updates**: check GitHub right away (the app also checks when it starts and every 6 hours)

### Fixed
- Importing a job for a company that isn't in your list works, including on a brand-new install with no companies (the form used to say "Add a company first" and the extension did nothing); you can also type a new company in the form
- A job with no company found is no longer filed under the first company in the list
- A logo fetched for a company deleted meanwhile no longer crashes the server
- Saving a company logo crashed the server with "Too many parameter values"
- Company cards no longer overflow on a phone-width screen

## [1.1.0] - 2026-11-11

### Added
- Getting started guide for new users (`docs/getting-started.md`), linked from the README
- Interview steps can be dated in the future (scheduled interviews), marked "Upcoming"

### Changed
- The Applications list includes jobs you haven't applied to yet by default
- Saved jobs stay visible after saving; a Saved job has no applied date, and giving it one moves it to Applied

### Fixed
- Fill from LinkedIn works again for company pages: LinkedIn started answering with a 403 "Just a moment..." page, so company pages are now read the same way as profiles and posts
- A company link LinkedIn doesn't know now says to check the name after /company/

## [1.0.0] - 2026-11-03

First release. Everything built so far, oldest first:

- Job Tracker: applications, openings, contacts and LinkedIn tools
- Flow chart: hover box no longer adds a scrollbar
- Contacts: import a person from their LinkedIn profile link
- LinkedIn posts fill the job description (form and background)
- Import jobs from Workable links (title, company, description, work type)
- Import button says 'Import job' until a link is pasted
- Open applications with no update for 60 days move to Ghosted
- Ghost stale applications on save; add tab icon
- Flow chart: columns stack from the top, bands never cross
- Flow chart: no twisted bands on ties, labels drawn above bands
- Applications: sort by job, company, applied date or stage
- Browser extension to import jobs; app opens Log application from ?import=; CLAUDE.md
- Extension imports in a small window beside the page; add missing company in one click
- Import picks a new company as '(new)' and creates it from LinkedIn on save
- CVs: store every version with a label, preview, default CV, CV sent per application
- Quiz: import interview question sets, practise by topic, remember answers, retry missed
- Import jobs from Indeed, Wuzzuf and jobs.workable.com
- Flow chart: bands that skip a stage run under it, not through it
- Add a Managerial interview stage after Technical interview
- Themed dropdowns with an aligned chevron; delete from the edit form
- Stage dropdowns are all the same width again
