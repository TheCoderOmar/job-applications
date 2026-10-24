import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, defaultCvLabel, parseCvFile } from './cvs.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('parseCvFile reads a PDF and keeps its name', () => {
  const r = parseCvFile(`data:application/pdf;base64,${b64('%PDF-1.7')}`, 'C:\\fakepath\\Omar Ali Omar Elsayed.pdf');
  assert.ok(typeof r !== 'string');
  assert.equal(r.file_name, 'Omar Ali Omar Elsayed.pdf');
  assert.equal(r.mime, 'application/pdf');
  assert.equal(r.data.toString(), '%PDF-1.7');
});

test('parseCvFile takes the type from the extension when the browser gives none', () => {
  const r = parseCvFile(`data:;base64,${b64('x')}`, 'cv.DOCX');
  assert.ok(typeof r !== 'string');
  assert.equal(r.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('parseCvFile refuses other files, empty files and missing data', () => {
  assert.equal(parseCvFile(`data:image/png;base64,${b64('x')}`, 'photo.png'), 'Pick a PDF or Word file.');
  assert.equal(parseCvFile('data:application/pdf;base64,', 'cv.pdf'), 'That file is empty.');
  assert.equal(parseCvFile('nope', 'cv.pdf'), 'Pick a CV file.');
  assert.equal(parseCvFile(`data:application/pdf;base64,${b64('x')}`, ''), 'Pick a CV file.');
});

test('defaultCvLabel uses the day and avoids taken labels', () => {
  assert.equal(defaultCvLabel('2026-10-24', []), 'CV 24/10/2026');
  assert.equal(defaultCvLabel('2026-10-24', ['cv 24/10/2026']), 'CV 24/10/2026 (2)');
  assert.equal(defaultCvLabel('2026-10-24', ['CV 24/10/2026', 'CV 24/10/2026 (2)']), 'CV 24/10/2026 (3)');
});

test('contentDisposition keeps the file name', () => {
  assert.equal(
    contentDisposition('attachment', 'Omar Ali Omar Elsayed.pdf'),
    `attachment; filename="Omar Ali Omar Elsayed.pdf"; filename*=UTF-8''Omar%20Ali%20Omar%20Elsayed.pdf`,
  );
  assert.match(contentDisposition('inline', 'سيرة.pdf'), /^inline; filename="____\.pdf"; filename\*=UTF-8''%D8/);
});
