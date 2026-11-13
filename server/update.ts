// Updates from GitHub: check whether origin/main has new commits, and fast-forward to them on request.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'main';

export interface UpdateStatus {
  /** False when this copy isn't a git clone (downloaded as a zip) or git isn't installed. */
  supported: boolean;
  checked_at: string | null;
  /** New commits on GitHub you don't have. */
  behind: number;
  /** Their subjects, newest first (at most 20). */
  commits: string[];
  /** What's new for the person using the app: the CHANGELOG lines those commits add. */
  notes: string[];
  /** Local commits not on GitHub (then updating would need a merge, so it isn't offered). */
  ahead: number;
  /** Code files changed by hand (updating would overwrite them, so it waits). */
  dirty: boolean;
  branch: string | null;
  /** Set after an update that changed the packages: restart the app to install them. */
  needs_restart: boolean;
  error: string | null;
}

export const needsInstallFlag = (repo = REPO) => path.join(repo, 'data', '.needs-install');

function git(repo: string, args: string[], timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd: repo, timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(String(stdout).trim()),
    ),
  );
}

const blank = (repo: string): UpdateStatus => ({
  supported: false,
  checked_at: null,
  behind: 0,
  commits: [],
  notes: [],
  ahead: 0,
  dirty: false,
  branch: null,
  needs_restart: fs.existsSync(needsInstallFlag(repo)),
  error: null,
});

/** The changelog entries ("- Something new") added between two versions, without markdown bold. */
export async function changelogNotes(repo: string, from: string, to: string): Promise<string[]> {
  try {
    const diff = await git(repo, ['diff', from, to, '--', 'CHANGELOG.md']);
    return diff
      .split('\n')
      .filter((l) => /^\+\s*- /.test(l))
      .map((l) => l.replace(/^\+\s*- /, '').replace(/\*\*/g, '').trim())
      .filter(Boolean)
      .slice(0, 30);
  } catch {
    return [];
  }
}

/** Fetches origin and compares it with what you have. Never changes your files. */
export async function checkForUpdate(repo = REPO, fetch = true): Promise<UpdateStatus> {
  const s = blank(repo);
  if (!fs.existsSync(path.join(repo, '.git'))) return s;
  try {
    s.branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    s.supported = true;
    if (fetch) await git(repo, ['fetch', '--quiet', 'origin', BRANCH], 30000);
    const upstream = `origin/${BRANCH}`;
    s.behind = Number(await git(repo, ['rev-list', '--count', `HEAD..${upstream}`]));
    s.ahead = Number(await git(repo, ['rev-list', '--count', `${upstream}..HEAD`]));
    s.commits = s.behind ? (await git(repo, ['log', '--format=%s', '-n', '20', `HEAD..${upstream}`])).split('\n').filter(Boolean) : [];
    s.notes = s.behind ? await changelogNotes(repo, 'HEAD', upstream) : [];
    s.dirty = !!(await git(repo, ['status', '--porcelain', '--untracked-files=no']));
    s.checked_at = new Date().toISOString();
  } catch (e) {
    // No network, no git, or no "origin": just no update this time.
    s.error = (e as Error).message;
  }
  return s;
}

/** Why an update can't be applied right now, or null when it can. */
export function blockedReason(s: UpdateStatus): string | null {
  if (!s.supported) return 'This copy of the app was not installed with git clone, so it cannot update itself.';
  if (s.branch !== BRANCH) return `You are on the "${s.branch}" branch. Switch to ${BRANCH} to update.`;
  if (s.dirty) return 'Some app files were changed on this computer. Commit or undo those changes, then update.';
  if (s.ahead) return 'This computer has its own commits that are not on GitHub. Update with git pull instead.';
  if (!s.behind) return 'You already have the latest version.';
  return null;
}

/**
 * Fast-forwards to origin/main. When package.json or package-lock.json changed, leaves a flag so the next start
 * runs npm install first (packages can't be replaced while the app is running).
 */
export async function applyUpdate(repo = REPO): Promise<{ updated: number; needs_restart: boolean; notes: string[] }> {
  const s = await checkForUpdate(repo);
  const reason = blockedReason(s);
  if (reason) throw new Error(reason);
  const before = await git(repo, ['rev-parse', 'HEAD']);
  await git(repo, ['merge', '--ff-only', '--quiet', `origin/${BRANCH}`], 60000);
  const changed = (await git(repo, ['diff', '--name-only', before, 'HEAD'])).split('\n');
  const needs_restart = changed.some((f) => /^package(-lock)?\.json$/.test(f.trim()));
  if (needs_restart) {
    fs.mkdirSync(path.dirname(needsInstallFlag(repo)), { recursive: true });
    fs.writeFileSync(needsInstallFlag(repo), `${new Date().toISOString()}\n`);
  }
  return { updated: s.behind, needs_restart, notes: await changelogNotes(repo, before, 'HEAD') };
}
