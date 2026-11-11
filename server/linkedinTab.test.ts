import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTab, companyFromHeadline, guessPostCompany, linkedInKind } from './linkedinTab.js';

const COMPANIES = [
  { id: 1, name: 'Sumerge', linkedin: 'https://www.linkedin.com/company/sumerge' },
  { id: 2, name: 'Valeo', linkedin: null },
  { id: 3, name: 'Fawry', linkedin: null },
  { id: 4, name: 'AI', linkedin: null },
];

test('linkedInKind tells company pages, profiles and posts apart', () => {
  assert.equal(linkedInKind('https://www.linkedin.com/company/santechture/'), 'company');
  assert.equal(linkedInKind('https://www.linkedin.com/company/santechture/about/'), 'company');
  assert.equal(linkedInKind('https://eg.linkedin.com/in/some-one'), 'profile');
  assert.equal(linkedInKind('https://www.linkedin.com/posts/jane_hiring-activity-123'), 'post');
  assert.equal(linkedInKind('https://www.linkedin.com/feed/update/urn:li:activity:7123/'), 'post');
  assert.equal(linkedInKind('https://www.linkedin.com/jobs/view/123'), null);
  assert.equal(linkedInKind('https://www.linkedin.com/company/x/jobs/?currentJobId=5'), null);
  assert.equal(linkedInKind('https://example.com/company/x'), null);
});

test('companyFromHeadline finds the employer', () => {
  assert.equal(companyFromHeadline('Talent Acquisition Specialist at Valeo'), 'Valeo');
  assert.equal(companyFromHeadline('HR Manager @ Sumerge | Hiring Java devs'), 'Sumerge');
  assert.equal(companyFromHeadline('Senior Recruiter - Fawry'), 'Fawry');
  assert.equal(companyFromHeadline('Helping people grow'), null);
  assert.equal(companyFromHeadline(null), null);
});

test('guessPostCompany: a company page that posted', () => {
  assert.deepEqual(
    guessPostCompany({ author: 'Sumerge', author_url: 'https://www.linkedin.com/company/sumerge/posts' }, COMPANIES),
    { id: 1, name: 'Sumerge', linkedin: 'https://www.linkedin.com/company/sumerge', why: 'author' },
  );
  assert.deepEqual(guessPostCompany({ author: 'New Co', author_url: 'https://www.linkedin.com/company/newco' }, COMPANIES), {
    id: null,
    name: 'New Co',
    linkedin: 'https://www.linkedin.com/company/newco',
    why: 'author',
  });
});

test('guessPostCompany: a company you have, named in the headline or the post', () => {
  const g = guessPostCompany(
    { author: 'Jane', author_url: 'https://www.linkedin.com/in/jane', headline: 'Recruiter', text: 'We at Fawry are hiring! Not Valeo.' },
    COMPANIES,
  );
  assert.equal(g?.id, 3);
  assert.equal(g?.why, 'mentioned');
  // "AI" is too short to count as a mention.
  assert.equal(guessPostCompany({ author: 'Jane', text: 'Hiring AI engineers' }, COMPANIES), null);
});

test('guessPostCompany: the employer in the headline, new or known', () => {
  assert.deepEqual(guessPostCompany({ author: 'Jane', headline: 'Talent partner at Contoso', text: 'Hiring!' }, COMPANIES), {
    id: null,
    name: 'Contoso',
    linkedin: null,
    why: 'headline',
  });
  assert.equal(guessPostCompany({ author: 'Jane', headline: 'HR at Sumerge Egypt', text: 'Hiring' }, COMPANIES)?.id, 1);
});

test('cleanTab keeps trimmed strings and arrays only', () => {
  assert.deepEqual(cleanTab({ name: '  Acme \n Co ', n: 5, cards: [{ lines: ['x'] }], empty: '  ' }), {
    name: 'Acme Co',
    cards: [{ lines: ['x'] }],
    empty: null,
  });
  assert.deepEqual(cleanTab(null), {});
});
