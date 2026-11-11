# Changelog

All notable changes to Job Applications.

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
