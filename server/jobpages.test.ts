import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobUrl, jobBoard, keepPage, keptPage, parseJobPage, canonicalWuzzufCompany } from './jobpages.js';

const ld = (v: unknown) => `<script type="application/ld+json">${JSON.stringify(v)}</script>`;

test('jobBoard tells Indeed, Wuzzuf and jobs.workable.com job links apart', () => {
  assert.equal(jobBoard('https://eg.indeed.com/viewjob?from=x&hl=en&jk=99261dd22df76cc7&tk=1'), 'indeed');
  assert.equal(jobBoard('https://eg.indeed.com/?r=us&vjk=99261dd22df76cc7'), 'indeed');
  assert.equal(jobBoard('https://www.indeed.com/jobs?q=backend'), null);
  assert.equal(jobBoard('https://wuzzuf.net/jobs/p/wcxjt9izxp3x-junior-software-engineer-megasoft-cairo-egypt?o=4'), 'wuzzuf');
  assert.equal(jobBoard('https://wuzzuf.net/search/jobs/?q=backend'), null);
  assert.equal(jobBoard('https://jobs.workable.com/view/ukSbgzHeASb1FRkDgRAroo/remote-backend-engineer'), 'workable');
  assert.equal(jobBoard('https://apply.workable.com/acme/j/FC15C6EBF3'), null);
});

test('cleanJobUrl drops tracking and points Indeed at the job page', () => {
  assert.equal(cleanJobUrl('https://eg.indeed.com/?r=us&vjk=99261dd22df76cc7'), 'https://eg.indeed.com/viewjob?jk=99261dd22df76cc7');
  assert.equal(cleanJobUrl('https://eg.indeed.com/viewjob?from=app&hl=en&jk=99261dd22df76cc7&tk=1k5q'), 'https://eg.indeed.com/viewjob?jk=99261dd22df76cc7');
  assert.equal(cleanJobUrl('https://wuzzuf.net/jobs/p/wcxjt9izxp3x-junior?o=4&l=sp#x'), 'https://wuzzuf.net/jobs/p/wcxjt9izxp3x-junior');
  assert.equal(cleanJobUrl('https://example.com/x?y=1'), 'https://example.com/x?y=1');
});

test('parseJobPage reads an Indeed JobPosting', () => {
  const html = ld({
    '@context': 'http://schema.org',
    '@type': 'JobPosting',
    title: 'Senior Integration Engineer',
    description: '<div><b>Company Description</b><p><br>Integrate systems.</p><ul><li>WebMethods</li><li>REST</li></ul></div>',
    employmentType: ['FULL_TIME'],
    hiringOrganization: { '@type': 'Organization', name: 'valU' },
    jobLocation: { '@type': 'Place', address: { addressCountry: 'EG', addressLocality: '' } },
    validThrough: '2027-02-23T00:02:09.226Z',
  });
  const job = parseJobPage(html, 'https://eg.indeed.com/viewjob?jk=99261dd22df76cc7', new Date('2026-10-26'));
  assert.equal(job.source, 'indeed');
  assert.equal(job.title, 'Senior Integration Engineer');
  assert.equal(job.company, 'valU');
  assert.equal(job.location, 'Egypt');
  assert.equal(job.description, 'Company Description\nIntegrate systems.\n\n• WebMethods\n• REST');
  assert.deepEqual(job.details, { 'Employment type': 'Full-time', Location: 'Egypt' });
  assert.equal(job.workplace, null);
  assert.equal(job.closed, false);
});

test('parseJobPage falls back to the job panel on an Indeed search page', () => {
  const html = `
<h5 class="css-1" data-testid="vj-job-title" style="x">Senior Integration Engineer</h5>
<div class="c" data-testid="company-info-metadata"><div><a dir="ltr" href="http://eg.indeed.com/cmp/Valu" aria-label="valU (opens in a new tab)">valU<div><svg></svg></div></a></div></div>
<div class="react-native-html-content simple-job-description-html"><style>.x{padding:1px}</style><p>Remote role.</p><ul><li>Kafka</li></ul>
<div aria-hidden="true" data-testid="vj-rcv-flag-sentinel-jobDescriptionSeen"></div>`;
  const job = parseJobPage(html, 'https://eg.indeed.com/?r=us&vjk=99261dd22df76cc7');
  assert.equal(job.title, 'Senior Integration Engineer');
  assert.equal(job.company, 'valU');
  assert.equal(job.description, 'Remote role.\n\n• Kafka');
  assert.equal(job.workplace, 'remote');
});

test('parseJobPage reads a Wuzzuf job: place, workplace link, experience boxes, closed after validThrough', () => {
  const html = `${ld({ '@type': 'BreadcrumbList', itemListElement: [] })}${ld({
    '@type': 'JobPosting',
    title: 'Junior Software Engineer',
    description: '<section><h1>Job Description</h1><ul><li><p>Build things.</p></li></ul></section>',
    employmentType: ['FULL_TIME'],
    hiringOrganization: { name: 'MegaSoft' },
    jobLocation: { address: { addressRegion: 'Cairo', addressLocality: 'Heliopolis', addressCountry: 'EG' } },
    validThrough: '2026-11-04T07:18:59.000Z',
  })}
<a href="https://wuzzuf.net/a/Full-Time-Jobs-in-Egypt?f"><span>Full Time</span></a><a href="https://wuzzuf.net/a/On-Site-Jobs-in-Egypt?f"><span>On-site</span></a>
<div><span>Experience Needed:</span><span><span>0 to 2 years</span></span></div>
<div><span>Career Level:</span><span>Entry Level (Junior Level / Fresh Grad)</span></div>
<div><span>Salary:</span><span>Confidential</span></div>`;
  const url = 'https://wuzzuf.net/jobs/p/wcxjt9izxp3x-junior-software-engineer-megasoft-cairo-egypt';
  const job = parseJobPage(html, url, new Date('2026-10-26'));
  assert.equal(job.source, 'wuzzuf');
  assert.equal(job.company, 'MegaSoft');
  assert.equal(job.location, 'Heliopolis, Cairo, Egypt');
  assert.equal(job.workplace, 'onsite');
  assert.equal(job.description, 'Job Description\n\n• Build things.');
  assert.deepEqual(job.details, {
    'Employment type': 'Full-time',
    Location: 'Heliopolis, Cairo, Egypt',
    'Experience Needed': '0 to 2 years',
    'Career Level': 'Entry Level (Junior Level / Fresh Grad)',
    Salary: 'Confidential',
  });
  assert.equal(parseJobPage(html, url, new Date('2026-11-05')).closed, true);
});

test('a Wuzzuf job links the company Wuzzuf page', () => {
  const page = (extra: string, org: Record<string, unknown> = { name: 'RITEC' }) =>
    `${ld({ '@type': 'JobPosting', title: 'QA Engineer', description: '<p>Test.</p>', hiringOrganization: org })}${extra}`;
  const url = 'https://wuzzuf.net/jobs/p/abc123-qa-engineer-ritec-cairo-egypt';
  assert.equal(
    parseJobPage(page('<a href="https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595?o=1">RITEC</a>'), url).company_wuzzuf,
    'https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595',
  );
  assert.equal(
    parseJobPage(page('', { name: 'RITEC', sameAs: 'https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595' }), url).company_wuzzuf,
    'https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595',
  );
  assert.equal(parseJobPage(page(''), url).company_wuzzuf, null);
});

test('canonicalWuzzufCompany keeps only company pages', () => {
  assert.equal(canonicalWuzzufCompany('wuzzuf.net/jobs/careers/RITEC-Egypt-17595/'), 'https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595');
  assert.equal(canonicalWuzzufCompany('https://wuzzuf.net/jobs/p/abc-qa'), null);
  assert.equal(canonicalWuzzufCompany(null), null);
});

test('parseJobPage reads a jobs.workable.com job: remote, applicant country, requirements', () => {
  const html = ld({
    '@type': 'JobPosting',
    title: 'Backend Engineer-JAVA',
    description: '<p>Java backend.</p>',
    requirementsSection: '<ul><li>Spring Boot</li></ul>',
    employmentType: 'FULL_TIME',
    hiringOrganization: { name: '99brightminds' },
    jobLocation: { '@type': 'Place' },
    jobLocationType: 'TELECOMMUTE',
    applicantLocationRequirements: { '@type': 'Country', name: 'Jordan' },
  });
  const job = parseJobPage(html, 'https://jobs.workable.com/view/ukSbgzHeASb1FRkDgRAroo/remote-backend');
  assert.equal(job.source, 'workable');
  assert.equal(job.location, 'Jordan');
  assert.equal(job.workplace, 'remote');
  assert.equal(job.description, 'Java backend.\n\n• Spring Boot');
});

test('parseJobPage says so when the page has no job', () => {
  assert.throws(() => parseJobPage('<html>Just a moment...</html>', 'https://wuzzuf.net/jobs/p/x'), /Could not find the job on that Wuzzuf page/);
  assert.throws(() => parseJobPage('', 'https://example.com'), /not an Indeed, Wuzzuf or Workable/);
});

test('keepPage holds a page for 30 minutes', () => {
  const id = keepPage('https://wuzzuf.net/jobs/p/x', '<html/>', 1000);
  assert.deepEqual(keptPage(id, 1000 + 60_000), { url: 'https://wuzzuf.net/jobs/p/x', html: '<html/>', at: 1000 });
  assert.equal(keptPage(id, 1000 + 31 * 60_000), null);
  assert.equal(keptPage('nope'), null);
});
