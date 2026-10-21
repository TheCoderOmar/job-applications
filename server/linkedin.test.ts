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
