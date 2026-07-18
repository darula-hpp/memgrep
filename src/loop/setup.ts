import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveCursorConfig } from '../cursor/config.js';
import { defaultHome } from '../memory/store.js';
import {
  DEFAULT_LOOP_BASE_BRANCH,
  DEFAULT_LOOP_BRANCH_PREFIX,
  DEFAULT_LOOP_MAX_ITERATIONS,
  DEFAULT_LOOP_PROFILE,
  getActiveLoopProfile,
  initLoopProfile,
  listLoopProfiles,
  migrateLegacyLoopIfNeeded,
  readLoopConfig,
  ensureDirectoryPath,
  resolveLoopConfig,
  resolveProfileName,
  setActiveLoopProfile,
  writeLoopConfig,
  type LoopConfig,
  type LoopConfigOptions,
} from './config.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

/**
 * Interactive onboarding for the agnostic loop (cwd + optional seed defaults).
 * Writes the active (or --profile) project profile under ~/.memgrep/loops/<name>/.
 */
export async function runLoopSetup(
  options: { home?: string; profile?: string } = {},
): Promise<LoopConfig> {
  const home = options.home ?? defaultHome();
  migrateLegacyLoopIfNeeded(home);

  const scope: LoopConfigOptions = { home, profile: options.profile };
  let profile = resolveProfileName(scope);
  const profiles = listLoopProfiles(home);
  const cursor = resolveCursorConfig(process.env, home);

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep loop setup');
    console.log('-----------------');
    console.log('Agnostic coding loop: task + inputs + exit conditions + exit actions.');
    console.log('Per-project profiles live under ~/.memgrep/loops/<name>/ (template: loop.base/).\n');

    if (!cursor) {
      console.log('Note: Cursor MCP is not configured yet. Run: node dist/cli.js cursor setup\n');
    }

    if (!profile && profiles.length === 0) {
      const nameAnswer = await prompt(
        rl,
        `New profile name [${DEFAULT_LOOP_PROFILE}]: `,
      );
      const name = nameAnswer || DEFAULT_LOOP_PROFILE;
      const cwdDefault = cursor?.cwd || process.cwd();
      const cwdAnswer = await prompt(
        rl,
        `Workspace cwd${cwdDefault ? ` [${cwdDefault}]` : ''}: `,
      );
      const cwd = ensureDirectoryPath(cwdAnswer || cwdDefault, 'cwd');
      const { config } = initLoopProfile(name, { home, cwd, setActive: true });
      profile = name;
      scope.profile = name;

      const baseDefault = config.git?.baseBranch || DEFAULT_LOOP_BASE_BRANCH;
      const baseAnswer = await prompt(rl, `Base branch for github_pr [${baseDefault}]: `);
      const prefixDefault = config.git?.branchPrefix || DEFAULT_LOOP_BRANCH_PREFIX;
      const prefixAnswer = await prompt(rl, `Branch prefix [${prefixDefault}]: `);
      const maxDefault = String(config.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS);
      const maxAnswer = await prompt(rl, `Max verify iterations [${maxDefault}]: `);
      const maxIterations = Number.parseInt(maxAnswer || maxDefault, 10);
      if (!Number.isFinite(maxIterations) || maxIterations < 1) {
        throw new Error('maxIterations must be a positive integer.');
      }

      const saved = writeLoopConfig(
        {
          ...config,
          cwd,
          git: {
            baseBranch: baseAnswer || baseDefault,
            branchPrefix: prefixAnswer || prefixDefault,
          },
          maxIterations,
        },
        scope,
      );
      printSaved(home, name, saved);
      return saved;
    }

    if (!profile) {
      console.log(`Existing profiles: ${profiles.join(', ') || '(none)'}`);
      const pick = await prompt(
        rl,
        `Profile to edit [${getActiveLoopProfile(home) || profiles[0] || DEFAULT_LOOP_PROFILE}]: `,
      );
      profile = pick || getActiveLoopProfile(home) || profiles[0] || DEFAULT_LOOP_PROFILE;
      setActiveLoopProfile(profile, home);
      scope.profile = profile;
    }

    const existing = readLoopConfig(scope);
    if (!existing) {
      throw new Error(
        `loop profile "${profile}" not found. Run: node dist/cli.js loop init ${profile}`,
      );
    }

    console.log(`Editing profile "${profile}"`);
    console.log(
      `  inputs=${existing.defaults.inputs.length} exits=${existing.defaults.exits.length} actions=${existing.defaults.actions.length}`,
    );
    const keep = await prompt(rl, 'Keep existing defaults and only update cwd/git? [Y/n]: ');
    if (keep.toLowerCase() !== 'n' && keep.toLowerCase() !== 'no') {
      const cwdDefault = existing.cwd || cursor?.cwd || '';
      const cwdAnswer = await prompt(
        rl,
        `Workspace cwd${cwdDefault ? ` [${cwdDefault}]` : ''}: `,
      );
      const cwd = ensureDirectoryPath(cwdAnswer || cwdDefault, 'cwd');
      const config = writeLoopConfig({ ...existing, cwd }, scope);
      printSaved(home, profile, config);
      return config;
    }

    const cwdDefault = existing.cwd || cursor?.cwd || '';
    const cwdAnswer = await prompt(
      rl,
      `Workspace cwd (git repo)${cwdDefault ? ` [${cwdDefault}]` : ''}: `,
    );
    const cwd = ensureDirectoryPath(cwdAnswer || cwdDefault, 'cwd');

    const baseDefault = existing.git?.baseBranch || DEFAULT_LOOP_BASE_BRANCH;
    const baseAnswer = await prompt(rl, `Base branch for github_pr [${baseDefault}]: `);
    const baseBranch = baseAnswer || baseDefault;

    const prefixDefault = existing.git?.branchPrefix || DEFAULT_LOOP_BRANCH_PREFIX;
    const prefixAnswer = await prompt(rl, `Branch prefix [${prefixDefault}]: `);
    const branchPrefix = prefixAnswer || prefixDefault;

    const maxDefault = String(existing.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS);
    const maxAnswer = await prompt(rl, `Max verify iterations [${maxDefault}]: `);
    const maxIterations = Number.parseInt(maxAnswer || maxDefault, 10);
    if (!Number.isFinite(maxIterations) || maxIterations < 1) {
      throw new Error('maxIterations must be a positive integer.');
    }

    console.log(
      '\nSeed defaults are optional. Add inputs/exits/actions later via MCP ' +
        '(loop_upsert_*) or `loop input|exit|action set --profile …`.\n',
    );

    const config = writeLoopConfig(
      {
        cwd,
        defaults: existing.defaults,
        git: { baseBranch, branchPrefix },
        maxIterations,
        telegramProfile: existing.telegramProfile,
        agentTimeoutMs: existing.agentTimeoutMs,
      },
      scope,
    );

    printSaved(home, profile, config);
    return config;
  } finally {
    rl.close();
  }
}

function printSaved(home: string, profile: string, config: LoopConfig): void {
  const resolved = resolveLoopConfig({ home, profile });
  console.log(`\nSaved profile "${profile}"`);
  console.log(`  config: ${resolved?.configPath ?? `${config.cwd}/.memgrep/loop.json`}`);
  if (resolved?.projectRoot) {
    console.log(`  project: ${resolved.projectRoot}`);
  }
  console.log(`  cwd:    ${config.cwd}`);
  console.log('Requires: Cursor MCP. Jira is optional (only if you pass jiraKey on loop_run).');
  console.log('Tools appear after MCP restart (npm start / serve).');
}
