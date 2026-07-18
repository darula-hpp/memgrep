import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail } from '../lib/errors.js';
import type { LoopArtifact, LoopConfigOptions } from '../../loop/config.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

function readArtifactsFile(filePath: string | undefined): LoopArtifact[] | undefined {
  if (!filePath?.trim()) return undefined;
  const raw = JSON.parse(readFileSync(filePath.trim(), 'utf8')) as LoopArtifact[];
  if (!Array.isArray(raw)) throw new Error(`Expected JSON array in ${filePath}`);
  return raw;
}

function scopeFromOpts(opts: { profile?: string }): LoopConfigOptions {
  return { profile: opts.profile?.trim() || undefined };
}

function registerArtifactMutators(parent: Command, kind: 'input' | 'exit' | 'action'): void {
  const cmd = parent.command(kind).description(`Manage default loop ${kind}s`);

  cmd
    .command('set')
    .description(`Upsert a default ${kind} (rewrites manifest)`)
    .requiredOption('--id <id>', 'Stable id')
    .requiredOption('--kind <kind>', 'path|url|text|builtin')
    .requiredOption('--value <value>', 'Path, URL, text, or builtin name')
    .option('--label <label>', 'Short label')
    .option('--description <text>', 'What the agent should do with it')
    .option('--profile <name>', 'Loop profile (default: active / MEMGREP_LOOP_PROFILE)')
    .action(async (opts) => {
      await loadDotenv();
      try {
        const {
          upsertLoopInput,
          upsertLoopExit,
          upsertLoopAction,
          getLoopStore,
        } = await import('../../loop/config.js');
        const scope = scopeFromOpts(opts);
        const artifact: LoopArtifact = {
          id: opts.id,
          kind: opts.kind as LoopArtifact['kind'],
          value: opts.value,
          label: opts.label || opts.id,
          description: opts.description,
        };
        if (kind === 'input') {
          upsertLoopInput(artifact, scope);
        } else if (kind === 'exit') {
          upsertLoopExit(artifact, scope);
        } else {
          upsertLoopAction(artifact, scope);
        }
        const store = getLoopStore(scope);
        const manifest =
          kind === 'input'
            ? store.inputsManifestPath
            : kind === 'exit'
              ? store.exitsManifestPath
              : store.actionsManifestPath;
        console.log(
          `Saved ${kind} ${opts.id} → ${manifest}` +
            (store.profile ? ` (profile ${store.profile})` : ''),
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  cmd
    .command('rm')
    .description(`Remove a default ${kind} by id`)
    .argument('<id>', 'Artifact id')
    .option('--profile <name>', 'Loop profile (default: active / MEMGREP_LOOP_PROFILE)')
    .action(async (id: string, opts: { profile?: string }) => {
      await loadDotenv();
      try {
        const { removeLoopInput, removeLoopExit, removeLoopAction } = await import(
          '../../loop/config.js'
        );
        const scope = scopeFromOpts(opts);
        if (kind === 'input') removeLoopInput(id, scope);
        else if (kind === 'exit') removeLoopExit(id, scope);
        else removeLoopAction(id, scope);
        console.log(`Removed ${kind} ${id}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
}

export function registerLoopCommand(program: Command): void {
  const loop = program
    .command('loop')
    .description('Agnostic coding loop (inputs, exit conditions, exit actions)');

  loop
    .command('init')
    .description('Copy loop.base into a new project profile under ~/.memgrep/loops/<name>/')
    .argument('<name>', 'Profile name (e.g. launchpad)')
    .option('--cwd <path>', 'Workspace cwd for this profile (created if missing)')
    .option('--force', 'Overwrite existing profile from base')
    .option('--no-activate', 'Do not set this profile as active')
    .action(async (name: string, opts: { cwd?: string; force?: boolean; activate?: boolean }) => {
      await loadDotenv();
      try {
        const { initLoopProfile } = await import('../../loop/config.js');
        const { profile, store, config } = initLoopProfile(name, {
          cwd: opts.cwd,
          force: !!opts.force,
          setActive: opts.activate !== false,
        });
        console.log(`Initialized loop profile "${profile}"`);
        console.log(`  config: ${store.configPath}`);
        console.log(`  cwd:    ${config.cwd}`);
        if (opts.activate !== false) console.log('  active: yes');
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  loop
    .command('use')
    .description('Set the active loop profile (~/.memgrep/loop.active)')
    .argument('<name>', 'Profile name')
    .action(async (name: string) => {
      await loadDotenv();
      try {
        const { setActiveLoopProfile, loopProfileDir } = await import('../../loop/config.js');
        const profile = setActiveLoopProfile(name);
        console.log(`Active loop profile: ${profile}`);
        console.log(`  dir: ${loopProfileDir(profile)}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  loop
    .command('setup')
    .description('Setup / edit a loop profile (cwd + git defaults)')
    .option('--profile <name>', 'Profile to edit (default: active)')
    .action(async (opts: { profile?: string }) => {
      await loadDotenv();
      try {
        const { runLoopSetup } = await import('../../loop/setup.js');
        await runLoopSetup({ profile: opts.profile });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  loop
    .command('status')
    .description('Show loop profile status')
    .option('--profile <name>', 'Profile to show (default: active / MEMGREP_LOOP_PROFILE)')
    .action(async (opts: { profile?: string }) => {
      await loadDotenv();
      const {
        resolveLoopConfig,
        listLoopProfiles,
        getActiveLoopProfile,
        migrateLegacyLoopIfNeeded,
        legacyLoopConfigPath,
      } = await import('../../loop/config.js');
      const { resolveCursorConfig } = await import('../../cursor/config.js');
      const { resolveJiraConfig } = await import('../../jira/config.js');
      const { defaultHome } = await import('../../memory/store.js');

      const home = defaultHome();
      migrateLegacyLoopIfNeeded(home);
      const scope = scopeFromOpts(opts);
      const resolved = resolveLoopConfig(scope);
      const profiles = listLoopProfiles(home);
      const active = getActiveLoopProfile(home);

      if (!resolved) {
        console.log('loop: not configured');
        console.log(`Profiles: ${profiles.join(', ') || '(none)'}`);
        console.log('Run: node dist/cli.js loop init <name>');
        console.log('  or: node dist/cli.js loop setup');
        return;
      }

      const cursor = !!resolveCursorConfig();
      const jira = !!resolveJiraConfig();
      const d = resolved.defaults;
      console.log('loop: configured');
      console.log(`  profile:          ${resolved.profile ?? '(legacy)'}`);
      console.log(`  active:           ${active ?? '(none)'}`);
      console.log(`  profiles:         ${profiles.join(', ') || '(none)'}`);
      console.log(`  cwd:              ${resolved.cwd}`);
      console.log(`  inputs:           ${d.inputs.length}`);
      console.log(`  exit conditions:  ${d.exits.length}`);
      console.log(`  exit actions:     ${d.actions.length}`);
      console.log(`  inputsManifest:   ${resolved.inputsManifestPath}`);
      console.log(`  exitsManifest:    ${resolved.exitsManifestPath}`);
      console.log(`  actionsManifest:  ${resolved.actionsManifestPath}`);
      console.log(`  git.baseBranch:   ${resolved.git.baseBranch}`);
      console.log(`  git.branchPrefix: ${resolved.git.branchPrefix}`);
      console.log(`  maxIterations:    ${resolved.maxIterations}`);
      console.log(`  agentTimeoutMs:   ${resolved.agentTimeoutMs}`);
      console.log(`  cursorReady:      ${cursor}`);
      console.log(`  jiraReady:        ${jira}`);
      console.log(`  path:             ${resolved.configPath}`);
      if (resolved.usingLegacy) {
        console.log(
          `\nWarning: using legacy ${legacyLoopConfigPath(home)}. Prefer: loop init <name>`,
        );
      }
      if (!cursor) console.log('\nMissing: node dist/cli.js cursor setup');
    });

  registerArtifactMutators(loop, 'input');
  registerArtifactMutators(loop, 'exit');
  registerArtifactMutators(loop, 'action');

  loop
    .command('run')
    .description('Run the loop in-process (detached MCP starts / terminal)')
    .requiredOption('--task <text>', 'Free-text task description')
    .option('--profile <name>', 'Loop profile (default: active / MEMGREP_LOOP_PROFILE)')
    .option('--jira-key <key>', 'Optional Jira key to enrich the task')
    .option('--cwd <path>', 'Workspace override (Cursor-allowlisted)')
    .option('--agent-id <id>', 'Resume Cursor agent id')
    .option('--max-iterations <n>', 'Max implement/verify iterations', (v) => Number(v))
    .option('--query <text>', 'Optional memgrep recall query')
    .option('--run-id <id>', 'Existing or new run id (~/.memgrep/loop-runs)')
    .option('--telegram-profile <name>', 'Telegram profile for completion notify')
    .option('--no-notify', 'Skip Telegram completion push')
    .option('--inputs-file <path>', 'JSON array of task-specific inputs')
    .option('--exits-file <path>', 'JSON array of task-specific exit conditions')
    .option('--actions-file <path>', 'JSON array of task-specific exit actions')
    .action(async (opts) => {
      await loadDotenv();
      try {
        await runLoopCli(opts);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  loop
    .command('runs')
    .description('List loop runs or show one run snapshot')
    .argument('[runId]', 'Optional run id')
    .option('--task <text>', 'Show latest run for this task / jira key')
    .option('--profile <name>', 'Filter list by loop profile')
    .option('--limit <n>', 'Max runs to list', (v) => Number(v), 20)
    .action(
      async (
        runId: string | undefined,
        opts: { task?: string; limit?: number; profile?: string },
      ) => {
        await loadDotenv();
        try {
          const { formatLoopRunSnapshot, listLoopRuns, readLoopRun } = await import(
            '../../loop/runs.js'
          );
          if (runId?.trim()) {
            const meta = readLoopRun(runId.trim());
            if (!meta) fail(`loop run not found: ${runId}`);
            console.log(formatLoopRunSnapshot(meta!));
            return;
          }
          const runs = listLoopRuns(undefined, opts.limit ?? 20);
          const task = opts.task?.trim();
          const profile = opts.profile?.trim();
          let filtered = task
            ? runs.filter((r) => r.task === task || r.jiraKey === task)
            : runs;
          if (profile) filtered = filtered.filter((r) => r.profile === profile);
          if (filtered.length === 0) {
            console.log(task ? `No loop runs for ${task}.` : 'No loop runs.');
            return;
          }
          if (task && filtered[0]) {
            console.log(formatLoopRunSnapshot(filtered[0]));
            return;
          }
          for (const r of filtered) {
            console.log(
              `${r.runId}  ${r.status.padEnd(7)}  ${r.profile ?? '-'}  ${r.task}  updated=${r.updatedAt}` +
                (r.prUrl ? `  ${r.prUrl}` : ''),
            );
          }
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      },
    );
}

async function runLoopCli(opts: {
  task: string;
  profile?: string;
  jiraKey?: string;
  cwd?: string;
  agentId?: string;
  maxIterations?: number;
  query?: string;
  runId?: string;
  telegramProfile?: string;
  notify?: boolean;
  inputsFile?: string;
  exitsFile?: string;
  actionsFile?: string;
}): Promise<void> {
  const { resolveLoopConfig } = await import('../../loop/config.js');
  const { resolveCursorConfig } = await import('../../cursor/config.js');
  const { CursorAgentService } = await import('../../cursor/service.js');
  const { resolveJiraConfig } = await import('../../jira/config.js');
  const { JiraClient } = await import('../../jira/client.js');
  const { JiraService } = await import('../../jira/service.js');
  const { MemoryStore } = await import('../../memory/store.js');
  const { MemoryTools } = await import('../../memory/tools.js');
  const { LoopService } = await import('../../loop/service.js');
  const { notifyLoopComplete } = await import('../../loop/notify.js');
  const {
    appendLoopRunLog,
    createLoopRun,
    readLoopRun,
    updateLoopRun,
  } = await import('../../loop/runs.js');

  const scope = scopeFromOpts(opts);
  const loopConfig = resolveLoopConfig(scope);
  const cursorConfig = resolveCursorConfig();
  const jiraConfig = resolveJiraConfig();
  if (!loopConfig) {
    throw new Error(
      'loop not configured. Run: node dist/cli.js loop init <name>  (or loop setup)',
    );
  }
  if (!cursorConfig) throw new Error('Cursor not configured. Run: node dist/cli.js cursor setup');

  const task = opts.task.trim();
  const jiraKey = opts.jiraKey?.trim();
  if (jiraKey && !jiraConfig) {
    throw new Error('jiraKey provided but Jira not configured. Run: node dist/cli.js jira setup');
  }

  const inputs = readArtifactsFile(opts.inputsFile);
  const exits = readArtifactsFile(opts.exitsFile);
  const actions = readArtifactsFile(opts.actionsFile);
  const notify = opts.notify !== false;
  const telegramProfile = opts.telegramProfile?.trim() || loopConfig.telegramProfile;
  const profile = loopConfig.profile;

  let meta =
    opts.runId?.trim() && readLoopRun(opts.runId.trim())
      ? updateLoopRun(opts.runId.trim(), {
          status: 'running',
          pid: process.pid,
          telegramProfile,
          notify,
          profile,
        })
      : createLoopRun({
          task,
          jiraKey,
          inputs,
          exits,
          actions,
          cwd: opts.cwd,
          agentId: opts.agentId,
          maxIterations: opts.maxIterations,
          query: opts.query,
          telegramProfile,
          notify,
          runId: opts.runId,
          profile,
        });

  if (meta.status !== 'running') {
    meta = updateLoopRun(meta.runId, { status: 'running', pid: process.pid, profile });
  }

  const log = (line: string) => {
    const stamp = new Date().toISOString();
    const text = `[${stamp}] ${line}\n`;
    process.stdout.write(text);
    appendLoopRunLog(meta.runId, text);
  };

  log(
    `running task=${task} runId=${meta.runId} pid=${process.pid}` +
      (profile ? ` profile=${profile}` : ''),
  );

  let finalized = false;
  const markFailed = (error: string) => {
    if (finalized) return;
    finalized = true;
    try {
      updateLoopRun(meta.runId, { status: 'fail', error });
      appendLoopRunLog(meta.runId, `[${new Date().toISOString()}] fatal: ${error}\n`);
    } catch {
      // Best-effort — process may already be dying.
    }
  };

  process.on('uncaughtException', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    markFailed(`uncaughtException: ${msg}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    markFailed(`unhandledRejection: ${msg}`);
    process.exit(1);
  });

  const store = await MemoryStore.open(undefined, { heal: false });
  const memory = new MemoryTools(store);
  const service = new LoopService(
    loopConfig,
    new CursorAgentService(cursorConfig),
    memory,
    jiraConfig ? new JiraService(new JiraClient(jiraConfig)) : undefined,
  );

  try {
    const result = await service.run({
      task,
      jiraKey,
      inputs: inputs ?? meta.inputs,
      exits: exits ?? meta.exits,
      actions: actions ?? meta.actions,
      cwd: opts.cwd,
      agentId: opts.agentId || meta.agentId,
      maxIterations: opts.maxIterations,
      query: opts.query,
      onProgress: (p) => {
        updateLoopRun(meta.runId, {
          agentId: p.agentId,
          iterations: p.iteration,
        });
        log(
          `iteration ${p.iteration}/${p.maxIterations} status=${p.status} agentId=${p.agentId ?? ''}`,
        );
      },
    });

    finalized = true;
    meta = updateLoopRun(meta.runId, {
      status: result.ok ? 'pass' : 'fail',
      agentId: result.agentId,
      prUrl: result.prUrl,
      iterations: result.iterations,
      error: result.ok ? undefined : result.lastTrailer.failures || 'loop did not PASS',
    });

    log(result.ok ? `PASS pr=${result.prUrl ?? ''}` : `FAIL ${meta.error ?? ''}`);
    process.stdout.write(`${result.text}\n`);
    appendLoopRunLog(meta.runId, `${result.text}\n`);

    if (notify) {
      const sent = await notifyLoopComplete({
        run: meta,
        ok: result.ok,
        summary: result.prUrl
          ? `${result.lastTrailer.prSummary || result.text.slice(0, 800)}\n\nPR: ${result.prUrl}`
          : result.lastTrailer.failures || result.text.slice(0, 1500),
        prUrl: result.prUrl,
        profile: telegramProfile,
      });
      if (sent) {
        meta = updateLoopRun(meta.runId, { notifiedAt: new Date().toISOString() });
        log('telegram notify sent');
      } else {
        log('telegram notify skipped (not configured)');
      }
    }

    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    markFailed(msg);
    log(`error: ${msg}`);
    if (notify) {
      await notifyLoopComplete({
        run: readLoopRun(meta.runId)!,
        ok: false,
        summary: msg,
        profile: telegramProfile,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    try {
      store.close();
    } catch {
      // ignore
    }
  }
}
