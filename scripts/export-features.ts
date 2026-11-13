// Writes FEATURES.md (for GitHub) from src/features.ts, the same list the Features page shows.
// Usage: npm run features:export
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featuresMarkdown } from '../src/features.js';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'FEATURES.md');
fs.writeFileSync(file, featuresMarkdown());
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
