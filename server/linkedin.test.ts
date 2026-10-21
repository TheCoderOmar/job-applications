import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCompanyUrl, parseCompanyPage } from './linkedin.js';

test('canonicalCompanyUrl accepts the usual link shapes', () => {
  const want = 'https://www.linkedin.com/company/acme';
  for (const u of [
    'https://www.linkedin.com/company/acme/',
    'linkedin.com/company/acme/about/?trk=x',
    'https://eg.linkedin.com/company/acme',
    'http://linkedin.com/company/acme/jobs',
  ])
    assert.equal(canonicalCompanyUrl(u), want, u);
  assert.equal(canonicalCompanyUrl('https://www.linkedin.com/in/someone'), null);
  assert.equal(canonicalCompanyUrl('https://example.com/company/acme'), null);
  assert.equal(canonicalCompanyUrl(''), null);
});

// Trimmed copy of the markup LinkedIn serves for a public company page.
const PAGE = `
<meta property="og:title" content="Acme &amp; Sons | LinkedIn">
<meta property="og:description" content="Acme | 1,234 followers on LinkedIn.">
<meta property="og:image" content="https://media.licdn.com/logo.png?e=1&amp;v=beta">
<p class="break-words" data-test-id="about-us__description">
  We build rockets &amp; roller skates.
</p>
<div data-test-id="about-us__website"><dt> Website </dt><dd>
  <a href="https://www.linkedin.com/redir/redirect?url=http%3A%2F%2Fwww%2Eacme%2Ecom&amp;urlhash=x">http://www.acme.com</a>
</dd></div>
<div data-test-id="about-us__industry"><dt> Industry </dt><dd> Aerospace </dd></div>
<div data-test-id="about-us__size"><dt> Company size </dt><dd> 51-200 employees </dd></div>
<div data-test-id="about-us__headquarters"><dt> Headquarters </dt><dd> Cairo, Egypt </dd></div>
<div data-test-id="about-us__foundedOn"><dt> Founded </dt><dd> 1999 </dd></div>`;

test('parseCompanyPage reads name, about list, website and logo', () => {
  assert.deepEqual(parseCompanyPage(PAGE, 'https://www.linkedin.com/company/acme'), {
    linkedin: 'https://www.linkedin.com/company/acme',
    name: 'Acme & Sons',
    description: 'We build rockets & roller skates.',
    website: 'http://www.acme.com',
    industry: 'Aerospace',
    company_size: '51-200 employees',
    headquarters: 'Cairo, Egypt',
    founded: '1999',
    logo_url: 'https://media.licdn.com/logo.png?e=1&v=beta',
  });
});

test('parseCompanyPage copes with a page missing the about list', () => {
  const d = parseCompanyPage('<meta property="og:title" content="Tiny Co | LinkedIn">', 'u');
  assert.equal(d.name, 'Tiny Co');
  assert.equal(d.website, null);
  assert.equal(d.logo_url, null);
});

test('parseCompanyPage decodes double-encoded names', () => {
  const d = parseCompanyPage('<meta property="og:title" content="SKY Distribution &amp;amp; Services | LinkedIn">', 'u');
  assert.equal(d.name, 'SKY Distribution & Services');
});

test('canonicalProfileUrl normalises profile links', async () => {
  const { canonicalProfileUrl } = await import('./linkedin.js');
  assert.equal(canonicalProfileUrl('https://eg.linkedin.com/in/Abdalla-Adel-ba77/?trk=x'), 'https://www.linkedin.com/in/abdalla-adel-ba77');
  assert.equal(canonicalProfileUrl('linkedin.com/in/someone'), 'https://www.linkedin.com/in/someone');
  assert.equal(canonicalProfileUrl('https://www.linkedin.com/company/acme'), null);
});

test('parseProfilePage reads name, company, role and place (and strips RTL marks)', async () => {
  const { parseProfilePage } = await import('./linkedin.js');
  const html = `<meta property="og:title" content="‏Sara Hassan‏ - ‏Acme‏ | LinkedIn">
<script type="application/ld+json">{"@graph":[{"@type":"DiscussionForumPosting","author":{"@type":"Person","name":"x"}},
{"@type":"Person","name":"Sara Hassan","jobTitle":["Integration Engineer"],"worksFor":[{"@type":"Organization","name":"Acme"}],
"address":{"addressLocality":"Cairo"}}]}</script>`;
  assert.deepEqual(parseProfilePage(html, 'u'), {
    linkedin_url: 'u',
    full_name: 'Sara Hassan',
    company: 'Acme',
    position: 'Integration Engineer',
    location: 'Cairo',
  });
  // Without structured data: name and company from the page title.
  const d = parseProfilePage('<meta property="og:title" content="Ali Omar - Valeo | LinkedIn">', 'u');
  assert.equal(d.full_name, 'Ali Omar');
  assert.equal(d.company, 'Valeo');
  assert.equal(d.position, null);
});

test('isLinkedInPost and parsePostPage', async () => {
  const { isLinkedInPost, parsePostPage } = await import('./linkedin.js');
  assert.ok(isLinkedInPost('https://www.linkedin.com/feed/update/urn:li:activity:7517875401915047950/'));
  assert.ok(isLinkedInPost('https://www.linkedin.com/posts/someone_hiring-wso2-activity-7517875401915047950-AbCd'));
  assert.ok(!isLinkedInPost('https://www.linkedin.com/jobs/view/4473208616/'));
  const html = `<script type="application/ld+json">{"@type":"SocialMediaPosting","articleBody":"Hiring a WSO2 engineer &amp; more\\nSend CV to hr@acme.com",
    "author":{"@type":"Person","name":"Sara Hassan"},"datePublished":"2026-10-01T10:00:00Z"}</script>`;
  assert.deepEqual(parsePostPage(html), {
    text: 'Hiring a WSO2 engineer & more\nSend CV to hr@acme.com',
    author: 'Sara Hassan',
    posted_at: '2026-10-01T10:00:00Z',
  });
});
