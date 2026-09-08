import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLinkedInLogo, findLinkedInCompanyUrl } from '../src/discover-linkedin.mjs';
import { rankCandidates } from '../src/rank.mjs';

test('discovers only canonical LinkedIn company links', () => {
  const html = '<a href="https://www.linkedin.com/in/person">Person</a><a href="https://www.linkedin.com/company/acme/?trk=site">Acme</a>';
  assert.equal(findLinkedInCompanyUrl(html, 'https://acme.test/'), 'https://www.linkedin.com/company/acme/');
  assert.equal(findLinkedInCompanyUrl('', 'https://acme.test/', 'https://evil.test/company/acme'), null);
});

test('LinkedIn fallback accepts a logo only with first-party identity evidence', async () => {
  const result = await discoverLinkedInLogo({
    domain: 'acme.test',
    homepage: 'https://acme.test/',
    homepageHtml: '<footer><a href="https://www.linkedin.com/company/acme/">LinkedIn</a></footer>',
  }, {
    validateUrl: async () => {},
    fetchImpl: async () => new Response('<meta property="og:image" content="https://media.example/acme.png"><meta property="og:image:type" content="image/png">'),
  });
  assert.equal(result.diagnostics.status, 'candidate_found');
  assert.equal(result.candidates[0].source, 'linkedin');
  assert.equal(result.candidates[0].evidence.linkedin_identity_verified, true);
  assert.deepEqual(result.candidates[0].evidence.eligible_roles, ['icon']);
});

test('an explicit LinkedIn page must mention the exact target domain', async () => {
  const options = { validateUrl: async () => {}, fetchImpl: async () => new Response('<meta property="og:image" content="https://media.example/other.png">') };
  const result = await discoverLinkedInLogo({ domain: 'acme.test', homepage: 'https://acme.test/', homepageHtml: '', companyUrl: 'https://linkedin.com/company/other/' }, options);
  assert.equal(result.diagnostics.status, 'identity_mismatch');
  assert.deepEqual(result.candidates, []);
});

test('a verified LinkedIn image can fill only the icon role', () => {
  const candidate = {
    source: 'linkedin', url: 'https://media.example/acme.png', width: 300, height: 300,
    highResolution: true, scalable: false, bytes: 1000,
    evidence: { linkedin_identity_verified: true, eligible_roles: ['icon'] },
  };
  const result = rankCandidates([candidate], { companyName: 'Acme' });
  assert.equal(result.assets.icon.source, 'linkedin');
  assert.equal(result.assets.logo, null);
});
