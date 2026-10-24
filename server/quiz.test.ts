import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizFile, shuffle } from './quiz.js';

const FILE = {
  role: 'Backend Developer (Node.js)',
  topics: [
    {
      topic: 'Node.js',
      questions: [
        { id: 'node-1', type: 'mcq', question: 'Runs first?', options: ['setTimeout', 'process.nextTick'], answer: 'process.nextTick' },
        { id: 'node-2', type: 'card', question: 'nextTick vs setImmediate?', answer: 'nextTick runs before the loop continues.' },
      ],
    },
    { topic: 'Docker', questions: [{ type: 'card', question: 'What is an image?', answer: 'A read-only template.' }] },
  ],
};

test('parseQuizFile reads role, topics and both question types', () => {
  const r = parseQuizFile(JSON.stringify(FILE));
  assert.ok(typeof r !== 'string');
  assert.equal(r.role, 'Backend Developer (Node.js)');
  assert.deepEqual(
    r.questions.map((q) => [q.ext_id, q.topic, q.topic_order, q.sort_order, q.type]),
    [
      ['node-1', 'Node.js', 0, 0, 'mcq'],
      ['node-2', 'Node.js', 0, 1, 'card'],
      ['Docker#1', 'Docker', 1, 0, 'card'],
    ],
  );
  assert.deepEqual(r.questions[0].options, ['setTimeout', 'process.nextTick']);
  assert.equal(r.questions[1].options, null);
});

test('parseQuizFile explains what is wrong', () => {
  assert.equal(parseQuizFile('{nope'), "That file isn't valid JSON.");
  assert.match(String(parseQuizFile({ topics: [] })), /needs a "role"/);
  assert.match(String(parseQuizFile({ role: 'x', topics: [] })), /"topics" list/);
  const badAnswer = { role: 'x', topics: [{ topic: 'T', questions: [{ type: 'mcq', question: 'q', options: ['a', 'b'], answer: 'c' }] }] };
  assert.equal(parseQuizFile(badAnswer), "T, question 1: the answer isn't one of its options.");
  const dupe = { role: 'x', topics: [{ topic: 'T', questions: [{ id: 'a', question: 'q', answer: 'a' }, { id: 'a', question: 'q2', answer: 'b' }] }] };
  assert.equal(parseQuizFile(dupe), 'The id "a" is used twice.');
});

test('shuffle keeps every item', () => {
  const items = [1, 2, 3, 4, 5];
  const out = shuffle(items, () => 0);
  assert.deepEqual([...out].sort(), items);
  assert.notDeepEqual(out, items);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
});
