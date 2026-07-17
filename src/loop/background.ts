import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHome } from '../memory/store.js';
import type { LoopArtifact } from './config.js';
import { resolveLoopConfig, resolveProfileName } from './config.js';
import {
  createLoopRun,
  loopRunDir,
  loopRunLogPath,
  loopRunMetaPath,
  openLoopRunLogFd,
  updateLoopRun,
  type LoopRunMeta,
} from './runs.js';

export type StartLoopBackgroundInput = {
  task: string;
  jiraKey?: string;
  profile?: string;
  inputs?: LoopArtifact[];
  exits?: LoopArtifact[];
  actions?: LoopArtifact[];
  cwd?: string;
  agentId?: string;
  maxIterations?: number;
  query?: string;
  telegramProfile?: string;
  notify?: boolean;
  home?: string;
  cliPath?: string;
  spawnFn?: typeof spawn;
};

export type StartLoopBackgroundResult = {
  meta: LoopRunMeta;
  child: ChildProcess;
};

export function resolveLoopCliPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../cli.js');
}

/**
 * Create a run record and detach `memgrep loop run …` so MCP can return immediately.
 */
export function startLoopBackground(input: StartLoopBackgroundInput): StartLoopBackgroundResult {
  const home = input.home ?? defaultHome();
  const profile =
    resolveProfileName({ home, profile: input.profile }) ??
    resolveLoopConfig({ home, profile: input.profile })?.profile;

  const meta = createLoopRun(
    {
      task: input.task,
      jiraKey: input.jiraKey,
      profile,
      inputs: input.inputs,
      exits: input.exits,
      actions: input.actions,
      cwd: input.cwd,
      agentId: input.agentId,
      maxIterations: input.maxIterations,
      query: input.query,
      telegramProfile: input.telegramProfile,
      notify: input.notify,
    },
    home,
  );

  // Persist task-specific artifacts for the CLI child (JSON sidecars).
  const runDir = loopRunDir(meta.runId, home);
  if (meta.inputs?.length) {
    writeFileSync(path.join(runDir, 'inputs.json'), `${JSON.stringify(meta.inputs, null, 2)}\n`);
  }
  if (meta.exits?.length) {
    writeFileSync(path.join(runDir, 'exits.json'), `${JSON.stringify(meta.exits, null, 2)}\n`);
  }
  if (meta.actions?.length) {
    writeFileSync(path.join(runDir, 'actions.json'), `${JSON.stringify(meta.actions, null, 2)}\n`);
  }

  const cliPath = input.cliPath ?? resolveLoopCliPath();
  const args = [cliPath, 'loop', 'run', '--task', meta.task, '--run-id', meta.runId];
  if (meta.profile) args.push('--profile', meta.profile);
  if (meta.jiraKey) args.push('--jira-key', meta.jiraKey);
  if (meta.cwd) args.push('--cwd', meta.cwd);
  if (meta.agentId) args.push('--agent-id', meta.agentId);
  if (meta.maxIterations != null) args.push('--max-iterations', String(meta.maxIterations));
  if (meta.query) args.push('--query', meta.query);
  if (meta.telegramProfile) args.push('--telegram-profile', meta.telegramProfile);
  if (!meta.notify) args.push('--no-notify');
  if (meta.inputs?.length) args.push('--inputs-file', path.join(runDir, 'inputs.json'));
  if (meta.exits?.length) args.push('--exits-file', path.join(runDir, 'exits.json'));
  if (meta.actions?.length) args.push('--actions-file', path.join(runDir, 'actions.json'));

  const logFd = openLoopRunLogFd(meta.runId, home);
  const spawnFn = input.spawnFn ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnFn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        MEMGREP_HOME: home,
        ...(meta.profile ? { MEMGREP_LOOP_PROFILE: meta.profile } : {}),
      },
    });
  } finally {
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
  }

  if (child.pid == null) {
    updateLoopRun(
      meta.runId,
      { status: 'fail', error: 'Failed to spawn loop run process (no pid)' },
      home,
    );
    throw new Error('Failed to spawn loop run process');
  }

  child.unref();
  const updated = updateLoopRun(meta.runId, { status: 'running', pid: child.pid }, home);
  return { meta: updated, child };
}

export function formatLoopStartedAck(meta: LoopRunMeta, home = defaultHome()): string {
  return [
    `loop started in background for: ${meta.task}`,
    `runId: ${meta.runId}`,
    `status: ${meta.status}`,
    `profile: ${meta.profile ?? '(default/active)'}`,
    `pid: ${meta.pid ?? '(unknown)'}`,
    `meta: ${loopRunMetaPath(meta.runId, home)}`,
    `log: ${loopRunLogPath(meta.runId, home)}`,
    '',
    'Completion is pushed via Telegram when the run finishes.',
    'Do not busy-poll. Use loop_run_status only for an on-demand snapshot.',
  ].join('\n');
}
