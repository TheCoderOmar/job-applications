import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, featuresMarkdown } from '../src/features.js';

test('FEATURES.md matches the Features page (run npm run features:export after changing src/features.ts)', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'FEATURES.md');
  assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), featuresMarkdown());
});

test('every feature has a title and a description', () => {
  for (const a of AREAS) for (const [t, d] of a.items) assert.ok(t.trim() && d.trim(), `${a.title}: ${t}`);
});
