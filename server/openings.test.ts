import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBoard, findCareersLinks, parseJobPostingLd, parseLinkedInCompanyId, parseLinkedInJobCards } from './openings.js';
import { conversationStats, profileKey } from './contacts.js';

test('parseLinkedInJobCards reads title, company, location, date and id', () => {
  const html = `
<li>
  <div class="base-card" data-entity-urn="urn:li:jobPosting:4473208616">
    <a class="base-card__full-link" href="https://eg.linkedin.com/jobs/view/gl-accountant-at-sumerge-4473208616?position=1">
    <h3 class="base-search-card__title">
          GL &amp; Accountant
        </h3>
    <h4 class="base-search-card__subtitle"><a href="x">Sumerge</a></h4>
    <span class="job-search-card__location"> Cairo, Egypt </span>
    <time class="job-search-card__listdate" datetime="2026-09-29">2 weeks ago</time>
</li>
<li><div>no title here</div></li>`;
  assert.deepEqual(parseLinkedInJobCards(html), [
    {
      external_id: '4473208616',
      title: 'GL & Accountant',
      company: 'Sumerge',
      location: 'Cairo, Egypt',
      url: 'https://www.linkedin.com/jobs/view/4473208616',
      posted_at: '2026-09-29',
    },
  ]);
});

test('parseLinkedInCompanyId finds f_C on the company page', () => {
  assert.equal(parseLinkedInCompanyId('<a href="/jobs/search?f_C=108462&trk=x">Jobs</a>'), '108462');
  assert.equal(parseLinkedInCompanyId('<p>nothing</p>'), null);
});

test('detectBoard recognises job board links', () => {
  assert.deepEqual(detectBoard('https://boards.greenhouse.io/acme/jobs/123'), { kind: 'greenhouse', slug: 'acme' });
  assert.deepEqual(detectBoard('https://boards.greenhouse.io/embed/job_board?for=acme'), { kind: 'greenhouse', slug: 'acme' });
  assert.deepEqual(detectBoard('https://jobs.lever.co/acme'), { kind: 'lever', slug: 'acme' });
  assert.deepEqual(detectBoard('https://apply.workable.com/acme/'), { kind: 'workable', slug: 'acme' });
  assert.deepEqual(detectBoard('https://acme.wd3.myworkdayjobs.com/en-US/External'), {
    kind: 'workday',
    host: 'acme.wd3.myworkdayjobs.com',
    tenant: 'acme',
    site: 'External',
  });
  assert.equal(detectBoard('https://www.acme.com/careers'), null);
});

test('parseJobPostingLd reads schema.org JobPosting, including inside @graph', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"QA Engineer","url":"https://acme.com/j/1",
    "datePosted":"2026-10-01","jobLocation":{"address":{"addressLocality":"Cairo","addressCountry":"EG"}}}]}</script>
    <script type="application/ld+json">not json</script>`;
  assert.deepEqual(parseJobPostingLd(html, 'https://acme.com/careers'), [
    { external_id: 'https://acme.com/j/1#QA Engineer', title: 'QA Engineer', location: 'Cairo, EG', url: 'https://acme.com/j/1', posted_at: '2026-10-01' },
  ]);
});

test('findCareersLinks picks careers-looking links and resolves them', () => {
  const html = `<a href="/about">About</a><a href="/careers">Careers</a><a href="https://jobs.acme.com">Join us</a><a href="mailto:jobs@acme.com">Jobs</a>`;
  assert.deepEqual(findCareersLinks(html, 'https://acme.com/'), ['https://acme.com/careers', 'https://jobs.acme.com/']);
});

test('conversationStats counts per person, skips spam and leaves you out', () => {
  const csv = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS
c1,,Me,https://www.linkedin.com/in/me,Sara,https://www.linkedin.com/in/Sara-H,2026-10-01 10:00:00 UTC,,"hi, there",INBOX,
c1,,Sara,https://www.linkedin.com/in/sara-h/,Me,https://www.linkedin.com/in/me,2026-10-02 10:00:00 UTC,,"hello",INBOX,
c2,,Me,https://www.linkedin.com/in/me,Ali,https://www.linkedin.com/in/ali,2026-09-01 10:00:00 UTC,,x,INBOX,
c3,,Spammer,https://www.linkedin.com/in/spam,Me,https://www.linkedin.com/in/me,2026-09-01 10:00:00 UTC,,buy,SPAM,`;
  const s = conversationStats(csv);
  assert.equal(s.has('linkedin.com/in/me'), false);
  assert.equal(s.has('linkedin.com/in/spam'), false);
  assert.deepEqual(s.get(profileKey('https://www.linkedin.com/in/sara-h')!), {
    conversations: 1,
    messages: 2,
    messages_from_them: 1,
    last_message_at: '2026-10-02T10:00:00Z',
  });
  assert.equal(s.get('linkedin.com/in/ali')?.messages_from_them, 0);
});

test('inRegion keeps postings in the company country or city', async () => {
  const { inRegion, countryName } = await import('./openings.js');
  assert.equal(countryName('UAE'), 'United Arab Emirates');
  assert.ok(inRegion('Cairo, Cairo, Egypt', 'Egypt', 'Cairo'));
  assert.ok(inRegion('Giza, EG', 'Egypt', null));
  assert.ok(inRegion('Dubai, United Arab Emirates', 'UAE', null));
  assert.ok(inRegion('3 Locations', 'Egypt', null));
  assert.ok(inRegion(null, 'Egypt', null));
  assert.ok(!inRegion('Paris, France', 'Egypt', 'Cairo'));
  assert.ok(!inRegion('Segrate, Italy', 'Egypt', null));
  assert.ok(inRegion('Paris, France', null, null));
});

test('linkedInJobId reads the usual job link shapes', async () => {
  const { linkedInJobId } = await import('./openings.js');
  assert.equal(linkedInJobId('https://eg.linkedin.com/jobs/view/gl-accountant-at-sumerge-4473208616?trk=x'), '4473208616');
  assert.equal(linkedInJobId('https://www.linkedin.com/jobs/view/4473208616/'), '4473208616');
  assert.equal(linkedInJobId('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4473208616'), '4473208616');
  assert.equal(linkedInJobId('https://www.linkedin.com/company/sumerge'), null);
  assert.equal(linkedInJobId('https://example.com/jobs/view/4473208616'), null);
});

test('parseLinkedInJob turns the posting into plain text and details', async () => {
  const { parseLinkedInJob } = await import('./openings.js');
  const html = `<h2 class="top-card-layout__title topcard__title">Integration Engineer</h2>
    <a class="topcard__org-name-link" href="x">Sumerge</a>
    <span class="topcard__flavor topcard__flavor--bullet">Cairo, Egypt (Hybrid)</span>
    <span class="topcard__flavor--bullet">84 applicants</span>
    <div class="show-more-less-html__markup"><p>We build &amp; ship.</p><ul><li>WSO2</li><li>Java</li></ul></div>
    <h3 class="description__job-criteria-subheader">Seniority level</h3>
    <span class="description__job-criteria-text">Entry level</span>`;
  const j = parseLinkedInJob(html);
  assert.equal(j.title, 'Integration Engineer');
  assert.equal(j.company, 'Sumerge');
  assert.equal(j.location, 'Cairo, Egypt (Hybrid)');
  assert.equal(j.workplace, 'hybrid');
  assert.equal(j.description, 'We build & ship.\n\n• WSO2\n• Java');
  assert.deepEqual(j.details, { 'Seniority level': 'Entry level' });
  assert.equal(j.closed, false);
  assert.equal(parseLinkedInJob('<figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>').closed, true);
});

test('workableJobRef reads Workable job links', async () => {
  const { workableJobRef } = await import('./openings.js');
  assert.deepEqual(workableJobRef('https://apply.workable.com/innovationteam/j/FC15C6EBF3/apply/?success'), { account: 'innovationteam', code: 'FC15C6EBF3' });
  assert.deepEqual(workableJobRef('https://apply.workable.com/j/FC15C6EBF3'), { account: null, code: 'FC15C6EBF3' });
  assert.equal(workableJobRef('https://apply.workable.com/innovationteam/'), null);
  assert.equal(workableJobRef('https://www.linkedin.com/jobs/view/1'), null);
});

test('parseLinkedInJob reads the hiring company link', async () => {
  const { parseLinkedInJob } = await import('./openings.js');
  const j = parseLinkedInJob(
    '<a class="topcard__org-name-link topcard__flavor--black-link" href="https://sa.linkedin.com/company/2pcompanysa?trk=x">2P Perfect Presentation</a>',
  );
  assert.equal(j.company, '2P Perfect Presentation');
  assert.equal(j.company_linkedin, 'https://www.linkedin.com/company/2pcompanysa');
});

test('profileUrl keeps only LinkedIn profile links, in one form', async () => {
  const { profileUrl } = await import('./openings.js');
  assert.equal(profileUrl('https://eg.linkedin.com/in/marianne-narouz-12ab/?trk=public_jobs'), 'https://www.linkedin.com/in/marianne-narouz-12ab');
  assert.equal(profileUrl('https://www.linkedin.com/in/ahmed%C3%A9'), 'https://www.linkedin.com/in/ahmedé');
  assert.equal(profileUrl('https://www.linkedin.com/company/sumerge'), null);
  assert.equal(profileUrl(null), null);
});

test('parseLinkedInJob reads the hiring team from the public job page', async () => {
  const { parseLinkedInJob } = await import('./openings.js');
  const card = (slug: string, name: string, headline: string) =>
    `<div class="base-main-card flex"><a class="base-card__full-link" href="https://eg.linkedin.com/in/${slug}?trk=public_jobs_hiring-team">
       <span class="sr-only">${name}</span></a><div class="base-main-card__info">
       <h3 class="base-main-card__title">\n ${name}\n </h3><h4 class="base-main-card__subtitle"> ${headline} </h4></div></div>`;
  const html = `<h2 class="topcard__title">BI Developer</h2>
    <div class="message-the-recruiter"><h2>Meet the hiring team</h2>${card('marianne-narouz', 'Marianne Narouz', 'Talent Acquisition at Sumerge')}${card('x-y', 'Ali Y', '')}</div>`;
  assert.deepEqual(parseLinkedInJob(html).hiring_team, [
    { name: 'Marianne Narouz', linkedin_url: 'https://www.linkedin.com/in/marianne-narouz', headline: 'Talent Acquisition at Sumerge' },
    { name: 'Ali Y', linkedin_url: 'https://www.linkedin.com/in/x-y', headline: null },
  ]);
  assert.deepEqual(parseLinkedInJob('<h2 class="topcard__title">No team</h2>').hiring_team, []);
});
