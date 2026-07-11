import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

async function ensureConfig(forceSetup: boolean, profile: string) {
  const {
    maybeMigrateEnvToConfig,
    migrateLegacyTelegramConfig,
    resolveTelegramConfig,
    redactToken,
    readTelegramConfig,
    sanitizeTelegramProfile,
  } = await import('../../telegram/config.js');
  const { runTelegramSetup } = await import('../../telegram/setup.js');

  migrateLegacyTelegramConfig();
  maybeMigrateEnvToConfig();

  const name = sanitizeTelegramProfile(profile);
  let resolved = resolveTelegramConfig(process.env, undefined, name);
  const needsSetup =
    forceSetup || !resolved || !resolved.cursorApiKey || !resolved.cwd;

  if (needsSetup) {
    const existing = readTelegramConfig(undefined, name);
    await runTelegramSetup({
      profile: name,
      existingToken:
        name === 'default'
          ? process.env.TELEGRAM_BOT_TOKEN?.trim() || existing?.botToken
          : existing?.botToken,
      existingCursorApiKey: process.env.CURSOR_API_KEY?.trim() || existing?.cursorApiKey,
      existingCwd: process.env.MEMGREP_TELEGRAM_CWD?.trim() || existing?.cwd,
      existingModel: process.env.MEMGREP_TELEGRAM_MODEL?.trim() || existing?.model,
    });
    resolved = resolveTelegramConfig(process.env, undefined, name);
  }
  if (!resolved) {
    fail(`Telegram profile "${name}" is not configured. Run: memgrep telegram setup ${name}`);
  }
  if (!resolved.cursorApiKey) {
    fail(`CURSOR_API_KEY is required. Run: memgrep telegram setup ${name}`);
  }
  return { resolved, redactToken, profile: name };
}

type StartOpts = {
  noServer?: boolean;
  mcpUrl?: string;
  profiles: string[];
};

async function startBots(opts: StartOpts): Promise<void> {
  const { installTelegramProcessGuards } = await import('../../telegram/process-guards.js');
  installTelegramProcessGuards();

  const { TelegramBot } = await import('../../telegram/bot.js');
  const { CursorAgentPool } = await import('../../telegram/cursor-agent.js');
  const { resolveTelegramConfig, sanitizeTelegramProfile } = await import('../../telegram/config.js');

  const profiles = opts.profiles.map((p) => sanitizeTelegramProfile(p));
  const resolvedList = [];
  for (const profile of profiles) {
    const { resolved } = await ensureConfig(false, profile);
    resolvedList.push(resolved);
  }

  // Shared memory MCP for all bots in this process.
  let access;
  let httpHandle: { url: string; close: () => Promise<void> } | undefined;
  let mcpUrl = opts.mcpUrl ?? resolvedList[0]!.mcpUrl;
  const mcpToken = resolvedList[0]!.mcpToken;

  if (!opts.noServer) {
    const { startHttpMcpServer } = await import('../../memory/mcp.js');
    const { LocalMemoryAccess } = await import('../../telegram/local-access.js');
    httpHandle = await startHttpMcpServer({
      host: '127.0.0.1',
      authToken: mcpToken,
    });
    mcpUrl = httpHandle.url;
    access = await LocalMemoryAccess.open();
    console.error(`MCP HTTP also available at ${mcpUrl}`);
  } else {
    const { McpMemoryAccess } = await import('../../telegram/mcp-access.js');
    try {
      access = await McpMemoryAccess.connect(mcpUrl, mcpToken);
    } catch (error) {
      fail(
        `Cannot reach MCP at ${mcpUrl}. Omit --no-server to start one in-process, or run "memgrep serve --http". (${error instanceof Error ? error.message : error})`,
      );
    }
  }

  const pools: InstanceType<typeof CursorAgentPool>[] = [];
  const bots: InstanceType<typeof TelegramBot>[] = [];

  for (const resolved of resolvedList) {
    // Re-resolve in case ensureConfig wrote during setup for another profile.
    const fresh = resolveTelegramConfig(process.env, undefined, resolved.profile) ?? resolved;
    const cursorPool = new CursorAgentPool({
      apiKey: fresh.cursorApiKey!,
      cwd: fresh.cwd,
      model: fresh.model,
      mcpUrl,
      mcpToken: fresh.mcpToken,
      workspaces: fresh.workspaces,
      profile: fresh.profile,
    });
    pools.push(cursorPool);

    const label = fresh.botUsername ? `@${fresh.botUsername}` : fresh.profile;
    console.error(
      `memgrep telegram [${fresh.profile}] ${label} cwd=${fresh.cwd} model=${fresh.model}`,
    );

    bots.push(
      new TelegramBot({
        botToken: fresh.botToken,
        allowedUserIds: fresh.allowedUserIds,
        access,
        cursor: cursorPool,
      }),
    );
  }

  const shutdown = async () => {
    for (const bot of bots) bot.stop();
    await Promise.all(pools.map((p) => p.close()));
    await access.close?.();
    await httpHandle?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await Promise.all(bots.map((bot) => bot.run()));
}

function printStatus(profile: string): Promise<void> {
  return (async () => {
    const {
      resolveTelegramConfig,
      readTelegramConfig,
      redactToken,
      telegramConfigPath,
      sanitizeTelegramProfile,
      migrateLegacyTelegramConfig,
    } = await import('../../telegram/config.js');

    migrateLegacyTelegramConfig();
    const name = sanitizeTelegramProfile(profile);
    const file = readTelegramConfig(undefined, name);
    const resolved = resolveTelegramConfig(process.env, undefined, name);
    if (!file && !resolved) {
      console.log(`Telegram profile "${name}" is not configured.`);
      console.log(`Run: memgrep telegram setup ${name}`);
      return;
    }
    console.log(`Profile     : ${name}`);
    console.log(`Config file : ${telegramConfigPath(undefined, name)}`);
    if (file) {
      console.log(`Bot         : ${file.botUsername ? `@${file.botUsername}` : '(unknown)'}`);
      console.log(`Token       : ${redactToken(file.botToken)}`);
      console.log(`Allowlist   : ${file.allowedUserIds.join(', ')}`);
      if (file.cursorApiKey) {
        console.log(`Cursor key  : ${redactToken(file.cursorApiKey)}`);
      } else {
        console.log('Cursor key  : (missing — run setup or set CURSOR_API_KEY)');
      }
      console.log(`cwd         : ${file.cwd ?? '(unset)'}`);
      console.log(`model       : ${file.model ?? '(default)'}`);
      if (file.workspaces?.length) {
        console.log(`workspaces  : ${file.workspaces.map((w) => w.name).join(', ')}`);
      }
      console.log(`Updated     : ${file.updatedAt}`);
    }
    if (resolved) {
      console.log(`Runtime src : ${resolved.source}`);
      console.log(`Runtime cwd : ${resolved.cwd}`);
      console.log(`Runtime mdl : ${resolved.model}`);
      if (resolved.cursorApiKey) {
        console.log(`Runtime key : ${redactToken(resolved.cursorApiKey)}`);
      }
      if (resolved.source !== 'file') {
        console.log(`Runtime ids : ${[...resolved.allowedUserIds].join(', ')}`);
        console.log(`Runtime tok : ${redactToken(resolved.botToken)}`);
      }
    }
  })();
}

export function registerTelegramCommand(program: Command): void {
  const telegram = program
    .command('telegram')
    .description('Telegram bot: Cursor agent on your phone (memgrep memory via MCP + slash shortcuts)')
    .option('-p, --profile <name>', 'bot profile (default: default, or sole profile)')
    .option('--all', 'run every configured profile in this process')
    .option('--no-server', 'do not start embedded HTTP MCP; connect to --mcp-url instead')
    .option('--mcp-url <url>', 'MCP HTTP URL when using --no-server')
    .action(async (opts: { profile?: string; all?: boolean; server?: boolean; mcpUrl?: string }) => {
      await loadDotenv();
      const {
        listTelegramProfiles,
        migrateLegacyTelegramConfig,
        resolveDefaultProfileName,
        sanitizeTelegramProfile,
      } = await import('../../telegram/config.js');

      migrateLegacyTelegramConfig();

      if (opts.all && opts.profile) {
        fail('Use either --all or --profile, not both.');
      }

      let profiles: string[];
      if (opts.all) {
        profiles = listTelegramProfiles();
        if (profiles.length === 0) {
          fail('No telegram profiles configured. Run: memgrep telegram setup');
        }
      } else if (opts.profile) {
        profiles = [sanitizeTelegramProfile(opts.profile)];
      } else {
        const envProfile = process.env.MEMGREP_TELEGRAM_PROFILE?.trim();
        if (envProfile) {
          profiles = [sanitizeTelegramProfile(envProfile)];
        } else {
          const picked = resolveDefaultProfileName();
          if (!picked) {
            const all = listTelegramProfiles();
            if (all.length === 0) {
              fail('Telegram is not configured. Run: memgrep telegram setup');
            }
            fail(
              `Multiple profiles (${all.join(', ')}). Pick one: memgrep telegram --profile <name>\n` +
                'Or run all: memgrep telegram --all',
            );
          }
          profiles = [picked];
        }
      }

      await startBots({
        profiles,
        noServer: opts.server === false,
        mcpUrl: opts.mcpUrl,
      });
    });

  telegram
    .command('setup')
    .description('Onboarding: link a BotFather bot and Cursor cwd/model for a profile')
    .argument('[profile]', 'profile name', 'default')
    .action(async (profile: string) => {
      await loadDotenv();
      await ensureConfig(true, profile);
    });

  telegram
    .command('status')
    .description('Show Telegram + Cursor link status (secrets redacted)')
    .argument('[profile]', 'profile name (omit to list all)')
    .action(async (profile?: string) => {
      await loadDotenv();
      const {
        listTelegramProfiles,
        migrateLegacyTelegramConfig,
        resolveDefaultProfileName,
      } = await import('../../telegram/config.js');
      migrateLegacyTelegramConfig();

      if (profile) {
        await printStatus(profile);
        return;
      }

      const profiles = listTelegramProfiles();
      if (profiles.length === 0) {
        console.log('Telegram is not configured.');
        console.log('Run: memgrep telegram setup');
        return;
      }
      if (profiles.length === 1) {
        await printStatus(profiles[0]!);
        return;
      }

      console.log(`Profiles (${profiles.length}):\n`);
      for (const name of profiles) {
        await printStatus(name);
        console.log('');
      }
      const def = resolveDefaultProfileName();
      if (def) {
        console.log(`Default when no --profile: ${def}`);
      } else {
        console.log('No default — pass --profile <name> or --all');
      }
    });

  telegram
    .command('list')
    .description('List configured bot profiles')
    .action(async () => {
      await loadDotenv();
      const {
        listTelegramProfiles,
        migrateLegacyTelegramConfig,
        readTelegramConfig,
        telegramConfigPath,
      } = await import('../../telegram/config.js');
      migrateLegacyTelegramConfig();
      const profiles = listTelegramProfiles();
      if (profiles.length === 0) {
        console.log('No profiles. Run: memgrep telegram setup [name]');
        return;
      }
      for (const name of profiles) {
        const file = readTelegramConfig(undefined, name);
        const bot = file?.botUsername ? `@${file.botUsername}` : '(no bot)';
        const cwd = file?.cwd ?? '(unset)';
        const model = file?.model ?? '(default)';
        console.log(`${name}\t${bot}\t${model}\t${cwd}`);
        console.log(`  ${telegramConfigPath(undefined, name)}`);
      }
    });

  telegram
    .command('install')
    .description('Install a macOS LaunchAgent so the bot stays running (survives logout/reboot)')
    .option('-p, --profile <name>', 'run this profile under launchd')
    .option('--all', 'run every configured profile under launchd')
    .action(async (opts: { profile?: string; all?: boolean }, command) => {
      await loadDotenv();
      if (process.platform !== 'darwin') {
        fail('LaunchAgent install is only supported on macOS.');
      }
      // Parent `telegram` also defines --all/--profile; Commander may park them on globals.
      const merged = {
        ...(typeof command.optsWithGlobals === 'function' ? command.optsWithGlobals() : {}),
        ...opts,
      } as { profile?: string; all?: boolean };
      if (merged.all && merged.profile) {
        fail('Use either --all or --profile, not both.');
      }

      const {
        listTelegramProfiles,
        migrateLegacyTelegramConfig,
        resolveTelegramConfig,
        sanitizeTelegramProfile,
      } = await import('../../telegram/config.js');
      const { installLaunchdService } = await import('../../telegram/launchd.js');

      migrateLegacyTelegramConfig();

      let mode: { kind: 'default' } | { kind: 'all' } | { kind: 'profile'; profile: string };
      if (merged.all) {
        const profiles = listTelegramProfiles();
        if (profiles.length === 0) {
          fail('No telegram profiles configured. Run: memgrep telegram setup');
        }
        for (const name of profiles) {
          const resolved = resolveTelegramConfig(process.env, undefined, name);
          if (!resolved?.cursorApiKey) {
            fail(`Profile "${name}" is incomplete. Run: memgrep telegram setup ${name}`);
          }
        }
        mode = { kind: 'all' };
      } else if (merged.profile) {
        const name = sanitizeTelegramProfile(merged.profile);
        const resolved = resolveTelegramConfig(process.env, undefined, name);
        if (!resolved?.cursorApiKey) {
          fail(`Profile "${name}" is incomplete. Run: memgrep telegram setup ${name}`);
        }
        mode = { kind: 'profile', profile: name };
      } else {
        const profiles = listTelegramProfiles();
        if (profiles.length === 0) {
          fail('Telegram is not configured. Run: memgrep telegram setup');
        }
        if (profiles.length > 1) {
          fail(
            `Multiple profiles (${profiles.join(', ')}). Pick one:\n` +
              '  memgrep telegram install --profile <name>\n' +
              '  memgrep telegram install --all',
          );
        }
        const only = profiles[0]!;
        const resolved = resolveTelegramConfig(process.env, undefined, only);
        if (!resolved?.cursorApiKey) {
          fail(`Profile "${only}" is incomplete. Run: memgrep telegram setup ${only}`);
        }
        mode = only === 'default' ? { kind: 'default' } : { kind: 'profile', profile: only };
      }

      console.error(
        'Stop any foreground "memgrep telegram" first (Ctrl-C) - only one poller can use the bot token.',
      );
      const status = installLaunchdService({ mode });
      console.log(`Installed LaunchAgent: ${status.label}`);
      console.log(`Plist : ${status.plistPath}`);
      console.log(`Loaded: ${status.loaded ? 'yes' : 'no (check logs)'}`);
      console.log(`Logs  : ${status.logPath}`);
      if (status.programArgs) {
        console.log(`Run   : ${status.programArgs.join(' ')}`);
      }
      console.log('');
      console.log('The bot restarts on logout/reboot. It still pauses while this Mac is asleep or offline.');
      console.log('Unload later with: memgrep telegram uninstall');
    });

  telegram
    .command('uninstall')
    .description('Remove the macOS LaunchAgent installed by "telegram install"')
    .action(async () => {
      await loadDotenv();
      if (process.platform !== 'darwin') {
        fail('LaunchAgent uninstall is only supported on macOS.');
      }
      const { uninstallLaunchdService, getLaunchdStatus } = await import('../../telegram/launchd.js');
      const before = getLaunchdStatus();
      if (!before.installed) {
        console.log('No memgrep Telegram LaunchAgent is installed.');
        return;
      }
      const status = uninstallLaunchdService();
      console.log(`Removed LaunchAgent: ${status.label}`);
      console.log(`Plist gone: ${status.plistPath}`);
    });

  telegram
    .command('service')
    .description('Show macOS LaunchAgent status for the Telegram bot')
    .action(async () => {
      await loadDotenv();
      const { getLaunchdStatus } = await import('../../telegram/launchd.js');
      const status = getLaunchdStatus();
      console.log(`Label    : ${status.label}`);
      console.log(`Installed: ${status.installed ? 'yes' : 'no'}`);
      console.log(`Loaded   : ${status.loaded ? 'yes' : 'no'}`);
      console.log(`Plist    : ${status.plistPath}`);
      console.log(`Logs     : ${status.logPath}`);
      if (status.programArgs) {
        console.log(`Run      : ${status.programArgs.join(' ')}`);
      }
      if (!status.installed) {
        console.log('');
        console.log('Install with: memgrep telegram install');
      }
    });
}
