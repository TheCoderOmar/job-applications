import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyUpdate, blockedReason, checkForUpdate, needsInstallFlag } from './update.js';

/** A throwaway "GitHub" (bare repo), the user's clone, and a second clone to publish new commits from. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-update-'));
  const g = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  const origin = path.join(root, 'origin.git');
  const dev = path.join(root, 'dev');
  const user = path.join(root, 'user');
  g(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  g(root, 'clone', '--quiet', origin, dev);
  for (const r of [dev]) (g(r, 'config', 'user.email', 't@t'), g(r, 'config', 'user.name', 't'));
  const commit = (repo: string, file: string, text: string, msg: string) => {
    fs.writeFileSync(path.join(repo, file), text);
    g(repo, 'add', file);
    g(repo, 'commit', '--quiet', '-m', msg);
  };
  commit(dev, 'app.txt', 'v1', 'First version');
  g(dev, 'push', '--quiet', 'origin', 'HEAD:main');
  g(root, 'clone', '--quiet', origin, user);
  g(user, 'config', 'user.email', 'u@u');
  g(user, 'config', 'user.name', 'u');
  return { root, dev, user, g, commit, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('no update when GitHub has nothing new', async () => {
  const t = setup();
  try {
    const s = await checkForUpdate(t.user);
    assert.equal(s.supported, true);
    assert.equal(s.behind, 0);
    assert.equal(blockedReason(s), 'You already have the latest version.');
  } finally {
    t.cleanup();
  }
});

test('finds new commits and fast-forwards to them', async () => {
  const t = setup();
  try {
    t.commit(t.dev, 'app.txt', 'v2', 'Second version');
    t.commit(t.dev, 'package.json', '{}', 'Add a package');
    t.g(t.dev, 'push', '--quiet', 'origin', 'HEAD:main');
    const s = await checkForUpdate(t.user);
    assert.equal(s.behind, 2);
    assert.deepEqual(s.commits, ['Add a package', 'Second version']);
    assert.equal(blockedReason(s), null);
    const r = await applyUpdate(t.user);
    assert.deepEqual(r, { updated: 2, needs_restart: true });
    assert.equal(fs.readFileSync(path.join(t.user, 'app.txt'), 'utf8'), 'v2');
    assert.ok(fs.existsSync(needsInstallFlag(t.user)));
  } finally {
    t.cleanup();
  }
});

test('waits when files were changed by hand or there are local commits', async () => {
  const t = setup();
  try {
    t.commit(t.dev, 'app.txt', 'v2', 'Second version');
    t.g(t.dev, 'push', '--quiet', 'origin', 'HEAD:main');
    fs.writeFileSync(path.join(t.user, 'app.txt'), 'my edit');
    let s = await checkForUpdate(t.user);
    assert.match(blockedReason(s)!, /changed on this computer/);
    await assert.rejects(applyUpdate(t.user), /changed on this computer/);
    t.g(t.user, 'checkout', '--quiet', '--', 'app.txt');
    t.commit(t.user, 'mine.txt', 'x', 'My own change');
    s = await checkForUpdate(t.user);
    assert.equal(s.ahead, 1);
    assert.match(blockedReason(s)!, /own commits/);
  } finally {
    t.cleanup();
  }
});

test('a folder that is not a git clone cannot update', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-nogit-'));
  try {
    const s = await checkForUpdate(dir);
    assert.equal(s.supported, false);
    assert.match(blockedReason(s)!, /not installed with git clone/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
