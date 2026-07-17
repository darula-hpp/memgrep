import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import type { LoopArtifact } from './config.js';

export const LOOP_RUNS_DIR = 'loop-runs';

export type LoopRunStatus = 'queued' | 'running' | 'pass' | 'fail';

export type LoopRunMeta = {
  runId: string;
  task: string;
  status: LoopRunStatus;
  pid?: number;
  agentId?: string;
  prUrl?: string;
  iterations?: number;
  jiraKey?: string;
  /** Loop project profile under ~/.memgrep/loops/<profile>/ */
  profile?: string;
  inputs?: LoopArtifact[];
  exits?: LoopArtifact[];
  actions?: LoopArtifact[];
  cwd?: string;
  query?: string;
  maxIterations?: number;
  telegramProfile?: string;
  notify: boolean;
  startedAt: string;
  updatedAt: string;
  notifiedAt?: string;
  error?: string;
};

export function loopRunsRoot(home = defaultHome()): string {
  return path.join(home, LOOP_RUNS_DIR);
}

export function loopRunDir(runId: string, home = defaultHome()): string {
  return path.join(loopRunsRoot(home), runId);
}

export function loopRunMetaPath(runId: string, home = defaultHome()): string {
  return path.join(loopRunDir(runId, home), 'meta.json');
}

export function loopRunLogPath(runId: string, home = defaultHome()): string {
  return path.join(loopRunDir(runId, home), 'stdout.log');
}

export function newLoopRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export function createLoopRun(
  input: {
    task: string;
    jiraKey?: string;
    profile?: string;
    inputs?: LoopArtifact[];
    exits?: LoopArtifact[];
    actions?: LoopArtifact[];
    cwd?: string;
    query?: string;
    maxIterations?: number;
    agentId?: string;
    telegramProfile?: string;
    notify?: boolean;
    runId?: string;
  },
  home = defaultHome(),
): LoopRunMeta {
  const runId = input.runId?.trim() || newLoopRunId();
  const now = new Date().toISOString();
  const meta: LoopRunMeta = {
    runId,
    task: input.task.trim(),
    status: 'queued',
    jiraKey: input.jiraKey?.trim() || undefined,
    profile: input.profile?.trim() || undefined,
    inputs: input.inputs,
    exits: input.exits,
    actions: input.actions,
    cwd: input.cwd?.trim() || undefined,
    query: input.query?.trim() || undefined,
    maxIterations: input.maxIterations,
    agentId: input.agentId?.trim() || undefined,
    telegramProfile: input.telegramProfile?.trim() || undefined,
    notify: input.notify !== false,
    startedAt: now,
    updatedAt: now,
  };
  mkdirSync(loopRunDir(runId, home), { recursive: true });
  writeLoopRunMeta(meta, home);
  appendLoopRunLog(runId, `[${now}] queued task=${meta.task}\n`, home);
  return meta;
}

export function writeLoopRunMeta(meta: LoopRunMeta, home = defaultHome()): void {
  writeFileAtomic(loopRunMetaPath(meta.runId, home), `${JSON.stringify(meta, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function updateLoopRun(
  runId: string,
  patch: Partial<Omit<LoopRunMeta, 'runId' | 'startedAt'>>,
  home = defaultHome(),
): LoopRunMeta {
  const current = readLoopRun(runId, home);
  if (!current) {
    throw new Error(`loop run not found: ${runId}`);
  }
  const next: LoopRunMeta = {
    ...current,
    ...patch,
    runId: current.runId,
    startedAt: current.startedAt,
    updatedAt: new Date().toISOString(),
  };
  writeLoopRunMeta(next, home);
  return next;
}

export function readLoopRun(runId: string, home = defaultHome()): LoopRunMeta | null {
  const filePath = loopRunMetaPath(runId, home);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as LoopRunMeta;
  } catch (error) {
    throw new Error(
      `Invalid loop run meta at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** True if a process with this pid exists (signal 0). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * If meta still says running/queued but the child pid is gone, mark fail.
 * Hard crashes (native abort) often skip the CLI's normal catch path.
 */
export function reconcileLoopRunIfStale(meta: LoopRunMeta, home = defaultHome()): LoopRunMeta {
  if (meta.status !== 'running' && meta.status !== 'queued') return meta;
  if (meta.pid == null) return meta;
  if (isPidAlive(meta.pid)) return meta;
  return updateLoopRun(
    meta.runId,
    {
      status: 'fail',
      error:
        meta.error ??
        `loop process pid ${meta.pid} exited without updating status (likely crash)`,
    },
    home,
  );
}

export function listLoopRuns(home = defaultHome(), limit = 20): LoopRunMeta[] {
  const root = loopRunsRoot(home);
  if (!existsSync(root)) return [];
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  const out: LoopRunMeta[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const meta = readLoopRun(id, home);
    if (meta) out.push(reconcileLoopRunIfStale(meta, home));
  }
  return out;
}

export function appendLoopRunLog(runId: string, chunk: string, home = defaultHome()): void {
  const logPath = loopRunLogPath(runId, home);
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, chunk, 'utf8');
}

export function tailLoopRunLog(runId: string, maxLines = 40, home = defaultHome()): string {
  const logPath = loopRunLogPath(runId, home);
  if (!existsSync(logPath)) return '';
  const text = readFileSync(logPath, 'utf8');
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

export function openLoopRunLogFd(runId: string, home = defaultHome()): number {
  const logPath = loopRunLogPath(runId, home);
  mkdirSync(path.dirname(logPath), { recursive: true });
  return openSync(logPath, 'a');
}

export function formatLoopRunSnapshot(
  meta: LoopRunMeta,
  home = defaultHome(),
  logLines = 40,
): string {
  const current = reconcileLoopRunIfStale(meta, home);
  const lines = [
    `loop run ${current.runId}`,
    `  task:        ${current.task}`,
    `  jiraKey:     ${current.jiraKey ?? '(none)'}`,
    `  profile:     ${current.profile ?? '(none)'}`,
    `  status:      ${current.status}`,
    `  startedAt:   ${current.startedAt}`,
    `  updatedAt:   ${current.updatedAt}`,
    `  pid:         ${current.pid ?? '(none)'}`,
    `  agentId:     ${current.agentId ?? '(none)'}`,
    `  iterations:  ${current.iterations ?? '(none)'}`,
    `  prUrl:       ${current.prUrl ?? '(none)'}`,
    `  notifiedAt:  ${current.notifiedAt ?? '(none)'}`,
    `  notify:      ${current.notify}`,
    `  meta:        ${loopRunMetaPath(current.runId, home)}`,
    `  log:         ${loopRunLogPath(current.runId, home)}`,
  ];
  if (current.error) lines.push(`  error:       ${current.error}`);
  const tail = tailLoopRunLog(current.runId, logLines, home).trim();
  if (tail) {
    lines.push('', '--- log (tail) ---', tail);
  }
  return lines.join('\n');
}
