import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PrTemplateSection = {
  heading: string;
  /** Body text under the heading before the next ## */
  placeholder: string;
};

/** Extract `##` sections from a GitHub PR template file. */
export function parsePrTemplateSections(templateText: string): PrTemplateSection[] {
  const lines = templateText.split(/\r?\n/);
  const sections: PrTemplateSection[] = [];
  let current: PrTemplateSection | null = null;

  for (const line of lines) {
    const h = line.match(/^##\s+(.+)\s*$/);
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1].trim(), placeholder: '' };
      continue;
    }
    if (current) {
      current.placeholder += (current.placeholder ? '\n' : '') + line;
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ ...s, placeholder: s.placeholder.trimEnd() }));
}

export function buildPrBodyFromTemplate(opts: {
  templatePath: string;
  task: string;
  prSummary: string;
  deployNotes: string;
}): string {
  const raw = readFileSync(opts.templatePath, 'utf8');
  const sections = parsePrTemplateSections(raw);
  if (sections.length === 0) {
    return [
      `## Summary`,
      '',
      opts.prSummary || `(${opts.task})`,
      '',
      `## Deployment`,
      '',
      opts.deployNotes || 'None',
    ].join('\n');
  }

  const summary = opts.prSummary.trim() || `Implements ${opts.task}.`;
  const deploy = opts.deployNotes.trim() || 'None';
  const screencast =
    'Screencast: N/A — LOOP automated PR; requires manual verification of happy path and sad paths.';

  return sections
    .map((s) => {
      const lower = s.heading.toLowerCase();
      let body = s.placeholder.trim();
      if (/screencast|video|happy path|sad/.test(lower)) {
        body = screencast;
      } else if (/deploy|consideration|database|env|cron|secret/.test(lower)) {
        body = deploy;
      } else if (/describe|change|summary|thorough/.test(lower) || !body.trim()) {
        body = summary;
      } else if (!body.trim()) {
        body = summary;
      }
      return `## ${s.heading}\n\n${body}\n`;
    })
    .join('\n');
}

export type GhRunner = (
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export const defaultGhRunner: GhRunner = async (args, options) => {
  const { stdout, stderr } = await execFileAsync('gh', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/**
 * Create a PR with gh using the filled template body.
 * Always pass `--head` so create works after HTTPS push (worktree may lack upstream).
 * Returns the PR URL from stdout.
 */
export async function createPullRequest(opts: {
  cwd: string;
  title: string;
  baseBranch: string;
  body: string;
  /** Remote head branch, e.g. cursor/TASK-852 */
  headBranch?: string;
  gh?: GhRunner;
}): Promise<string> {
  const gh = opts.gh ?? defaultGhRunner;
  const bodyDir = mkdtempSync(path.join(tmpdir(), 'loop-pr-body-'));
  const bodyFile = path.join(bodyDir, 'body.md');
  writeFileSync(bodyFile, opts.body.endsWith('\n') ? opts.body : `${opts.body}\n`, 'utf8');
  try {
    const args = [
      'pr',
      'create',
      '--base',
      opts.baseBranch,
      '--title',
      opts.title,
      '--body-file',
      bodyFile,
    ];
    if (opts.headBranch?.trim()) {
      args.push('--head', opts.headBranch.trim());
    }
    const { stdout, stderr } = await gh(args, { cwd: opts.cwd });
    const combined = `${stdout}\n${stderr}`;
    const urlMatch = combined.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    if (urlMatch) return urlMatch[0];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('http')) return trimmed.split(/\s/)[0]!;
    throw new Error(`gh pr create did not return a PR URL.\nstdout: ${stdout}\nstderr: ${stderr}`);
  } finally {
    try {
      rmSync(bodyDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
