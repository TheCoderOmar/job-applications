import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careersLinks, careersRoot, findHiring, hiringEmail, systemOf } from './hiring.js';

/** A fake web: url → html (missing urls answer 404); `redirects` sends a url elsewhere. */
function web(pages: Record<string, string>, redirects: Record<string, string> = {}) {
  const asked: string[] = [];
  const fetchPage = async (url: string) => {
    asked.push(url);
    const to = redirects[url] ?? url;
    const html = pages[to];
    return { ok: html !== undefined, url: to, text: async () => html ?? '' };
  };
  return { fetchPage, asked };
}

test('systemOf knows hiring systems and job sites by their address', () => {
  assert.equal(systemOf('https://vodafone.wd3.myworkdayjobs.com/en-US/Vodafone_Careers'), 'Workday');
  assert.equal(systemOf('https://boards.greenhouse.io/instabug'), 'Greenhouse');
  assert.equal(systemOf('https://fa-exxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1'), 'Oracle Cloud');
  assert.equal(systemOf('https://career5.successfactors.eu/career?company=X'), 'SuccessFactors');
  assert.equal(systemOf('https://wuzzuf.net/jobs/careers/RITEC-Egypt-17595'), 'Wuzzuf');
  assert.equal(systemOf('https://wuzzuf.net/search/jobs'), null);
  assert.equal(systemOf('https://docs.google.com/forms/d/e/abc/viewform'), 'Google Form');
  assert.equal(systemOf('https://docs.google.com/document/d/abc'), null);
  assert.equal(systemOf('https://www.acme.com/careers'), null);
});

test('hiringEmail picks careers addresses, not sales ones', () => {
  assert.equal(hiringEmail('<a href="mailto:info@acme.com">Info</a> <a href="mailto:Careers@Acme.com?subject=CV">Careers</a>'), 'careers@acme.com');
  assert.equal(hiringEmail('Send your CV to hr@acme.com.eg today'), 'hr@acme.com.eg');
  assert.equal(hiringEmail('<a href="mailto:sales@acme.com">x</a>'), null);
});

test('careersLinks keeps careers links on their own site and hiring systems, not LinkedIn', () => {
  const html = `<a href="/en/careers/">Careers</a> <a href="https://careers.acme.com/jobs">Jobs</a>
    <a href="https://www.linkedin.com/company/acme/jobs">LinkedIn jobs</a> <a href="/about">About us</a>
    <a href="https://acme.wd3.myworkdayjobs.com/Acme">Open roles</a> <a href="/products">انضم إلينا</a>`;
  const links = careersLinks(html, 'https://www.acme.com/');
  assert.deepEqual([...links].sort(), [
    'https://acme.wd3.myworkdayjobs.com/Acme',
    'https://careers.acme.com/jobs',
    'https://www.acme.com/en/careers',
    'https://www.acme.com/products',
  ]);
  assert.equal(links.at(-1), 'https://www.acme.com/products', 'a vague link comes last');
});

test('careersLinks puts the main careers page before side pages and drops tracking', () => {
  const html = `<a href="/careers/students-and-graduates">Students</a> <a href="/newsroom/careers-fair">News</a>
    <a href="/careers?utm_source=home&icid=x">Careers</a>`;
  assert.deepEqual(careersLinks(html, 'https://www.big.com/'), ['https://www.big.com/careers']);
});

test('findHiring follows the homepage careers link to an embedded hiring system', async () => {
  const { fetchPage } = web({
    'https://acme.com': '<title>Acme</title><a href="/careers">Join us</a> <a href="mailto:info@acme.com">info</a>',
    'https://acme.com/careers': '<title>Careers at Acme</title><iframe src="https://acme.wd3.myworkdayjobs.com/en-US/External"></iframe>',
  });
  const r = await findHiring({ website: 'acme.com' }, fetchPage);
  assert.deepEqual(r, { careers_url: 'https://acme.com/careers', via: 'Workday', email: null, note: 'Hires through Workday.' });
});

test('findHiring tries the usual careers addresses when the homepage links none', async () => {
  const { fetchPage, asked } = web(
    {
      'https://www.acme.com.eg': '<title>Acme</title><p>Welcome</p>',
      'https://www.acme.com.eg/jobs': '<title>Jobs</title><p>Send your CV to careers@acme.com.eg</p>',
      'https://www.acme.com.eg/careers': '<title>Acme</title>',
    },
    { 'https://www.acme.com.eg/careers': 'https://www.acme.com.eg/' },
  );
  const r = await findHiring({ website: 'https://www.acme.com.eg/' }, fetchPage);
  assert.equal(r.careers_url, 'https://www.acme.com.eg/jobs');
  assert.equal(r.via, 'Careers page');
  assert.equal(r.email, 'careers@acme.com.eg');
  assert.ok(asked.includes('https://www.acme.com.eg/careers'), 'tried /careers first');
});

test('findHiring falls back to the Wuzzuf page, then says LinkedIn only', async () => {
  const site = { 'https://quiet.com': '<title>Quiet</title><a href="https://www.linkedin.com/company/quiet/jobs">Jobs</a>' };
  const w = await findHiring({ website: 'https://quiet.com', wuzzuf: 'https://wuzzuf.net/jobs/careers/Quiet-Egypt-1' }, web(site).fetchPage);
  assert.equal(w.via, 'Wuzzuf');
  assert.equal(w.careers_url, 'https://wuzzuf.net/jobs/careers/Quiet-Egypt-1');
  const none = await findHiring({ website: 'https://quiet.com' }, web(site).fetchPage);
  assert.equal(none.via, null);
  assert.match(none.note, /LinkedIn only/);
  assert.equal((await findHiring({ website: 'https://down.com' }, web({}).fetchPage)).note, 'The website did not answer.');
});

test('findHiring uses a careers page you saved and never fetches more than its budget', async () => {
  const { fetchPage, asked } = web({ 'https://jobs.acme.com': '<title>Acme jobs</title><a href="https://jobs.lever.co/acme">Apply</a>' });
  const r = await findHiring({ website: 'https://acme.com', careers_url: 'https://jobs.acme.com' }, fetchPage, 3);
  assert.equal(r.via, 'Lever');
  assert.equal(r.careers_url, 'https://jobs.acme.com');
  assert.ok(asked.length <= 3);
});

test('careersRoot climbs from a page inside the careers section to its top', () => {
  assert.equal(careersRoot('https://www.ey.com/en_eg/careers/technology'), 'https://www.ey.com/en_eg/careers');
  assert.equal(careersRoot('http://tafaseltech.com/careers/bpm-developer.html'), 'http://tafaseltech.com/careers');
  assert.equal(careersRoot('https://www.acme.com/careers'), null);
  assert.equal(careersRoot('https://careers.acme.com/'), null);
});

test('findHiring uses the careers section page instead of a deep page inside it', async () => {
  const { fetchPage } = web({
    'https://acme.com': '<a href="/careers/technology">Join us</a>',
    'https://acme.com/careers/technology': '<title>Tech careers</title>',
    'https://acme.com/careers': '<title>Careers</title>',
  });
  assert.equal((await findHiring({ website: 'https://acme.com' }, fetchPage)).careers_url, 'https://acme.com/careers');
});
