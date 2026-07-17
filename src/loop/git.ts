import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPullRequest, defaultGhRunner, type GhRunner } from './pr.js';

const execFileAsync = promisify(execFile);

export type GitRunner = (
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export const defaultGitRunner: GitRunner = async (args, options) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/** Real secret files — allow committed templates like `.env.meeting-minutes.example`. */
const SECRET_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..+)?|.*credentials.*|.*secret.*|id_rsa.*|.*\.(?:pem|p12|pfx|key))$/i;
const ENV_EXAMPLE_RE = /(?:^|\/)\.env(?:\..+)?\.example$/i;

/** Parse `git status --porcelain -uall` into repo-relative paths (forward slashes). */
export function parseGitPorcelain(stdout: string): string[] {
  const paths: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let filePath: string;
    if (raw.startsWith('?? ')) {
      filePath = raw.slice(3);
    } else if (raw.length >= 3 && raw[2] === ' ') {
      const rest = raw.slice(3);
      filePath = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest;
    } else {
      continue;
    }
    filePath = unquoteGitPath(filePath.trim());
    if (filePath) paths.push(normalizeRepoPath(filePath));
  }
  return [...new Set(paths)];
}

function unquoteGitPath(p: string): string {
  if (!(p.startsWith('"') && p.endsWith('"'))) return p;
  return p
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Paths listed in LOOP_CHANGED_FILES (one per line; bullets/commas tolerated). */
export function parseChangedFilesList(text: string): string[] {
  const raw = text.trim();
  if (!raw || /^(none|<none>|n\/a|null|-)$/i.test(raw)) return [];
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith('#')) continue;
    s = s.replace(/^[-*•]\s+/, '').replace(/^[\d]+\.\s+/, '');
    s = s.replace(/^[`'"]|[`'"]$/g, '');
    s = normalizeRepoPath(s);
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

export function isDeniedTaskPath(relPath: string): boolean {
  const n = normalizeRepoPath(relPath);
  if (!n || n.startsWith('..') || path.isAbsolute(n)) return true;
  if (n.split('/').includes('.git')) return true;
  if (n.split('/').includes('node_modules')) return true;
  if (ENV_EXAMPLE_RE.test(n)) return false;
  if (SECRET_PATH_RE.test(n)) return true;
  return false;
}

/** Fetch origin/base; if SSH/auth fails but the remote-tracking ref exists, continue. */
export async function ensureRemoteBaseRef(
  cwd: string,
  baseBranch: string,
  git: GitRunner = defaultGitRunner,
): Promise<{ ref: string; fetched: boolean; warning?: string }> {
  const ref = `origin/${baseBranch}`;
  try {
    await git(['fetch', 'origin', baseBranch], { cwd });
    return { ref, fetched: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    try {
      await git(['rev-parse', '--verify', ref], { cwd });
      return {
        ref,
        fetched: false,
        warning: `git fetch origin ${baseBranch} failed (${msg.split('\n')[0]}); using existing ${ref}`,
      };
    } catch {
      throw new Error(
        `git fetch origin ${baseBranch} failed and ${ref} is missing locally.\n${msg}`,
      );
    }
  }
}

/** Resolve HTTPS clone URL via `gh` (works when origin is SSH but gh uses HTTPS). */
export async function resolveHttpsRemoteUrl(
  cwd: string,
  gh: GhRunner,
): Promise<string | undefined> {
  try {
    const { stdout } = await gh(
      ['repo', 'view', '--json', 'url', '-q', '.url'],
      { cwd },
    );
    const url = stdout.trim().replace(/\/$/, '');
    if (url.startsWith('https://github.com/')) return `${url}.git`;
  } catch {
    // ignore
  }
  return undefined;
}

export async function pushBranch(
  opts: {
    cwd: string;
    branch: string;
    git?: GitRunner;
    gh?: GhRunner;
    /** Repo cwd for `gh repo view` (main tree, not worktree). */
    repoCwd?: string;
  },
): Promise<{ remote: string; warning?: string }> {
  const git = opts.git ?? defaultGitRunner;
  const refspec = `HEAD:refs/heads/${opts.branch}`;
  try {
    await git(['push', '-u', 'origin', refspec], { cwd: opts.cwd });
    return { remote: 'origin' };
  } catch (sshError) {
    const sshMsg = sshError instanceof Error ? sshError.message : String(sshError);
    const gh = opts.gh ?? defaultGhRunner;
    const httpsUrl = await resolveHttpsRemoteUrl(opts.repoCwd ?? opts.cwd, gh);
    if (!httpsUrl) throw sshError;
    await git(['push', '-u', httpsUrl, refspec], { cwd: opts.cwd });
    return {
      remote: httpsUrl,
      warning: `git push origin failed (${sshMsg.split('\n')[0]}); pushed via HTTPS ${httpsUrl}`,
    };
  }
}

/**
 * Resolve which paths to commit for the task:
 * - Prefer LOOP_CHANGED_FILES from the agent trailer
 * - Else fall back to git paths that became dirty after the run baseline
 * Never includes baseline-dirty paths unless the trailer lists them.
 */
export function resolveTaskFiles(opts: {
  trailerFiles: string;
  baseline: Set<string>;
  currentDirty: Set<string>;
  cwd: string;
}): { files: string[]; source: 'trailer' | 'delta'; warnings: string[] } {
  const warnings: string[] = [];
  const fromTrailer = parseChangedFilesList(opts.trailerFiles);
  const delta = [...opts.currentDirty].filter((p) => !opts.baseline.has(p));
  const source: 'trailer' | 'delta' = fromTrailer.length > 0 ? 'trailer' : 'delta';
  const candidates = source === 'trailer' ? fromTrailer : delta;

  const files: string[] = [];
  for (const rel of candidates) {
    if (isDeniedTaskPath(rel)) {
      warnings.push(`skipped denied path: ${rel}`);
      continue;
    }
    const abs = path.resolve(opts.cwd, rel);
    const root = path.resolve(opts.cwd);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      warnings.push(`skipped path outside repo: ${rel}`);
      continue;
    }
    if (!existsSync(abs)) {
      warnings.push(`skipped missing path: ${rel}`);
      continue;
    }
    files.push(normalizeRepoPath(rel));
  }

  return { files: [...new Set(files)], source, warnings };
}

export async function snapshotGitDirtyPaths(
  cwd: string,
  git: GitRunner = defaultGitRunner,
): Promise<Set<string>> {
  const { stdout } = await git(['status', '--porcelain', '-uall'], { cwd });
  return new Set(parseGitPorcelain(stdout));
}

function copyPathIntoWorktree(repoCwd: string, worktree: string, relPath: string): void {
  const src = path.resolve(repoCwd, relPath);
  const dest = path.resolve(worktree, relPath);
  const st = statSync(src);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (st.isDirectory()) {
    cpSync(src, dest, { recursive: true });
  } else {
    copyFileSync(src, dest);
  }
}

export type CommitPushPrResult = {
  prUrl: string;
  branch: string;
  files: string[];
  source: 'trailer' | 'delta';
  warnings: string[];
};

/**
 * Commit only task files on a branch cut from origin/baseBranch (via worktree),
 * push, and open a PR. Leaves the main dirty working tree untouched.
 */
export async function commitPushAndOpenPr(opts: {
  cwd: string;
  task: string;
  branchPrefix: string;
  baseBranch: string;
  title: string;
  body: string;
  commitMessage: string;
  trailerFiles: string;
  baseline: Set<string>;
  git?: GitRunner;
  gh?: GhRunner;
}): Promise<CommitPushPrResult> {
  const git = opts.git ?? defaultGitRunner;
  const currentDirty = await snapshotGitDirtyPaths(opts.cwd, git);
  const resolved = resolveTaskFiles({
    trailerFiles: opts.trailerFiles,
    baseline: opts.baseline,
    currentDirty,
    cwd: opts.cwd,
  });

  if (resolved.files.length === 0) {
    throw new Error(
      'No task files to commit. Agent must list repo-relative paths in LOOP_CHANGED_FILES ' +
        '(only files created/changed for this task). ' +
        (resolved.warnings.length ? `Notes: ${resolved.warnings.join('; ')}` : ''),
    );
  }

  const branch = `${opts.branchPrefix}${opts.task}`.replace(/\s+/g, '-');
  const base = await ensureRemoteBaseRef(opts.cwd, opts.baseBranch, git);
  if (base.warning) resolved.warnings.push(base.warning);

  const worktree = mkdtempSync(path.join(tmpdir(), `loop-${opts.task}-`));
  try {
    // -B resets local branch to origin/base if it already exists.
    await git(['worktree', 'add', '-B', branch, worktree, base.ref], { cwd: opts.cwd });

    for (const rel of resolved.files) {
      copyPathIntoWorktree(opts.cwd, worktree, rel);
    }

    await git(['add', '--', ...resolved.files], { cwd: worktree });
    const { stdout: staged } = await git(['diff', '--cached', '--name-only'], { cwd: worktree });
    if (!staged.trim()) {
      throw new Error(
        `Nothing staged for commit after copying task files: ${resolved.files.join(', ')}`,
      );
    }

    await git(['commit', '-m', opts.commitMessage], { cwd: worktree });
    const pushed = await pushBranch({
      cwd: worktree,
      branch,
      git,
      gh: opts.gh,
      repoCwd: opts.cwd,
    });
    if (pushed.warning) resolved.warnings.push(pushed.warning);

    const prUrl = await createPullRequest({
      // Prefer main repo cwd — worktree may lack a recognizable upstream after HTTPS push.
      cwd: opts.cwd,
      title: opts.title,
      baseBranch: opts.baseBranch,
      headBranch: branch,
      body: opts.body,
      gh: opts.gh,
    });

    return {
      prUrl,
      branch,
      files: resolved.files,
      source: resolved.source,
      warnings: resolved.warnings,
    };
  } finally {
    try {
      await git(['worktree', 'remove', '--force', worktree], { cwd: opts.cwd });
    } catch {
      try {
        rmSync(worktree, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        await git(['worktree', 'prune'], { cwd: opts.cwd });
      } catch {
        // ignore
      }
    }
  }
}
