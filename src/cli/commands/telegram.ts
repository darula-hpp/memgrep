import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

async function ensureConfig(forceSetup: boolean) {
  const {
    maybeMigrateEnvToConfig,
    resolveTelegramConfig,
    redactToken,
    readTelegramConfig,
  } = await import('../../telegram/config.js');
  const { runTelegramSetup } = await import('../../telegram/setup.js');

  maybeMigrateEnvToConfig();

  let resolved = resolveTelegramConfig();
  const needsSetup =
    forceSetup || !resolved || !resolved.cursorApiKey || !resolved.cwd;

  if (needsSetup) {
    const existing = readTelegramConfig();
    await runTelegramSetup({
      existingToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || existing?.botToken,
      existingCursorApiKey: process.env.CURSOR_API_KEY?.trim() || existing?.cursorApiKey,
      existingCwd: process.env.MEMGREP_TELEGRAM_CWD?.trim() || existing?.cwd,
      existingModel: process.env.MEMGREP_TELEGRAM_MODEL?.trim() || existing?.model,
    });
    resolved = resolveTelegramConfig();
  }
  if (!resolved) {
    fail('Telegram is not configured. Run: memgrep telegram setup');
  }
  if (!resolved.cursorApiKey) {
    fail('CURSOR_API_KEY is required. Run: memgrep telegram setup');
  }
  return { resolved, redactToken };
}

async function startBot(opts: { noServer?: boolean; mcpUrl?: string }): Promise<void> {
  const { resolved } = await ensureConfig(false);
  const { TelegramBot } = await import('../../telegram/bot.js');
  const { CursorAgentPool } = await import('../../telegram/cursor-agent.js');

  let access;
  let httpHandle: { url: string; close: () => Promise<void> } | undefined;
  let mcpUrl = opts.mcpUrl ?? resolved.mcpUrl;

  // Default: embed HTTP MCP so Cursor can call memgrep tools. --no-server uses an existing one.
  if (!opts.noServer) {
    const { startHttpMcpServer } = await import('../../memory/mcp.js');
    const { LocalMemoryAccess } = await import('../../telegram/local-access.js');
    httpHandle = await startHttpMcpServer({
      host: '127.0.0.1',
      authToken: resolved.mcpToken,
    });
    mcpUrl = httpHandle.url;
    access = await LocalMemoryAccess.open();
    console.error(`MCP HTTP also available at ${mcpUrl}`);
  } else {
    const { McpMemoryAccess } = await import('../../telegram/mcp-access.js');
    try {
      access = await McpMemoryAccess.connect(mcpUrl, resolved.mcpToken);
    } catch (error) {
      fail(
        `Cannot reach MCP at ${mcpUrl}. Omit --no-server to start one in-process, or run "memgrep serve --http". (${error instanceof Error ? error.message : error})`,
      );
    }
  }

  const cursorPool = new CursorAgentPool({
    apiKey: resolved.cursorApiKey!,
    cwd: resolved.cwd,
    model: resolved.model,
    mcpUrl,
    mcpToken: resolved.mcpToken,
  });

  console.error(`Cursor agent cwd: ${resolved.cwd} (model ${resolved.model})`);

  const bot = new TelegramBot({
    botToken: resolved.botToken,
    allowedUserIds: resolved.allowedUserIds,
    access,
    cursor: cursorPool,
  });

  const shutdown = async () => {
    bot.stop();
    await cursorPool.close();
    await access.close?.();
    await httpHandle?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await bot.run();
}

export function registerTelegramCommand(program: Command): void {
  const telegram = program
    .command('telegram')
    .description('Telegram bot: Cursor agent on your phone (memgrep memory via MCP + slash shortcuts)')
    .option('--no-server', 'do not start embedded HTTP MCP; connect to --mcp-url instead')
    .option('--mcp-url <url>', 'MCP HTTP URL when using --no-server')
    .action(async (opts: { server?: boolean; mcpUrl?: string }) => {
      await loadDotenv();
      // Commander maps --no-server → server: false (default server: true).
      await startBot({ noServer: opts.server === false, mcpUrl: opts.mcpUrl });
    });

  telegram
    .command('setup')
    .description('Onboarding: link Telegram (once) and/or add CURSOR_API_KEY + project cwd')
    .action(async () => {
      await loadDotenv();
      await ensureConfig(true);
    });

  telegram
    .command('status')
    .description('Show Telegram + Cursor link status (secrets redacted)')
    .action(async () => {
      await loadDotenv();
      const {
        resolveTelegramConfig,
        readTelegramConfig,
        redactToken,
        telegramConfigPath,
      } = await import('../../telegram/config.js');
      const file = readTelegramConfig();
      const resolved = resolveTelegramConfig();
      if (!file && !resolved) {
        console.log('Telegram is not configured.');
        console.log('Run: memgrep telegram setup');
        return;
      }
      console.log(`Config file : ${telegramConfigPath()}`);
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
    });
}
