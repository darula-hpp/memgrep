import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramApi } from './api.js';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_TELEGRAM_PROFILE,
  expandHomePath,
  findSharedCursorApiKey,
  readTelegramConfig,
  sanitizeTelegramProfile,
  telegramConfigPath,
  writeTelegramConfig,
  type TelegramConfig,
} from './config.js';
import { formatFetchError } from './errors.js';
import { defaultHome } from '../memory/store.js';

function redactHint(token: string): string {
  if (token.length < 12) return '***';
  return `${token.slice(0, 6)}…`;
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function promptCursorFields(
  rl: ReturnType<typeof createInterface>,
  options: {
    home: string;
    profile: string;
    existingCursorApiKey?: string;
    existingCwd?: string;
    existingModel?: string;
    existing?: TelegramConfig | null;
  },
): Promise<{ cursorApiKey: string; cwd: string; model: string }> {
  console.log('\nCursor agent (billed against your Cursor plan)');
  console.log('Get a key: https://cursor.com/dashboard/integrations\n');

  const sharedKey = findSharedCursorApiKey(options.home, options.profile);
  let cursorApiKey =
    options.existing?.cursorApiKey ||
    options.existingCursorApiKey?.trim() ||
    process.env.CURSOR_API_KEY?.trim() ||
    sharedKey ||
    '';
  if (!cursorApiKey) {
    cursorApiKey = await prompt(rl, 'Paste CURSOR_API_KEY: ');
  } else if (options.existing?.cursorApiKey) {
    const reuse = await prompt(
      rl,
      `CURSOR_API_KEY already saved (${redactHint(cursorApiKey)}). Keep it? [Y/n]: `,
    );
    if (reuse.toLowerCase() === 'n' || reuse.toLowerCase() === 'no') {
      cursorApiKey = await prompt(rl, 'Paste CURSOR_API_KEY: ');
    } else {
      console.log('Keeping existing Cursor API key.');
    }
  } else if (sharedKey && cursorApiKey === sharedKey && !options.existingCursorApiKey) {
    console.log(`Reusing CURSOR_API_KEY from another profile (${redactHint(cursorApiKey)}).`);
  } else {
    console.log(`Using CURSOR_API_KEY from environment (${redactHint(cursorApiKey)}).`);
  }
  if (!cursorApiKey) {
    throw new Error('CURSOR_API_KEY is required for Cursor-first Telegram.');
  }

  const defaultCwd = options.existingCwd?.trim() || options.existing?.cwd || process.cwd();
  const cwdAnswer = await prompt(rl, `Project directory [${defaultCwd}]: `);
  const cwd = expandHomePath(cwdAnswer || defaultCwd);
  if (!existsSync(cwd)) {
    throw new Error(`Directory does not exist: ${cwd}`);
  }

  const defaultModel =
    options.existingModel?.trim() || options.existing?.model || DEFAULT_CURSOR_MODEL;
  const modelAnswer = await prompt(rl, `Model [${defaultModel}]: `);
  const model = modelAnswer || defaultModel;

  return { cursorApiKey, cwd, model };
}

/**
 * Only configure Cursor fields when Telegram is already linked.
 */
export async function runCursorSetup(options: {
  home?: string;
  profile?: string;
  existingCursorApiKey?: string;
  existingCwd?: string;
  existingModel?: string;
} = {}): Promise<TelegramConfig> {
  const home = options.home ?? defaultHome();
  const profile = sanitizeTelegramProfile(options.profile ?? DEFAULT_TELEGRAM_PROFILE);
  const existing = readTelegramConfig(home, profile);
  if (!existing?.botToken || existing.allowedUserIds.length === 0) {
    throw new Error(`Telegram profile "${profile}" is not linked yet. Run: memgrep telegram setup ${profile}`);
  }

  const rl = createInterface({ input, output });
  try {
    console.log(`memgrep telegram — Cursor setup [${profile}]`);
    console.log('--------------------------------');
    console.log(`Bot already linked${existing.botUsername ? ` (@${existing.botUsername})` : ''}.`);
    console.log(`Allowlist: ${existing.allowedUserIds.join(', ')}\n`);

    const { cursorApiKey, cwd, model } = await promptCursorFields(rl, {
      home,
      profile,
      existingCursorApiKey: options.existingCursorApiKey,
      existingCwd: options.existingCwd,
      existingModel: options.existingModel,
      existing,
    });

    const config = writeTelegramConfig(
      {
        botToken: existing.botToken,
        allowedUserIds: existing.allowedUserIds,
        botUsername: existing.botUsername,
        cursorApiKey,
        cwd,
        model,
      },
      home,
      profile,
    );

    console.log(`\nSaved → ${telegramConfigPath(home, profile)}`);
    console.log(`Cursor cwd : ${cwd}`);
    console.log(`Model      : ${model}`);
    console.log(
      profile === DEFAULT_TELEGRAM_PROFILE
        ? 'Run: memgrep telegram'
        : `Run: memgrep telegram --profile ${profile}`,
    );
    return config;
  } finally {
    rl.close();
  }
}

/**
 * Interactive onboarding: BotFather token → /start allowlist → Cursor API key + cwd.
 * If Telegram is already linked, skips Bot API calls and only configures Cursor.
 */
export async function runTelegramSetup(options: {
  home?: string;
  profile?: string;
  existingToken?: string;
  existingCursorApiKey?: string;
  existingCwd?: string;
  existingModel?: string;
  /** Force full BotFather re-link even when config exists. */
  forceRelink?: boolean;
} = {}): Promise<TelegramConfig> {
  const home = options.home ?? defaultHome();
  const profile = sanitizeTelegramProfile(options.profile ?? DEFAULT_TELEGRAM_PROFILE);
  const existing = readTelegramConfig(home, profile);

  // Already linked: only collect Cursor fields (no Telegram network required).
  if (!options.forceRelink && existing?.botToken && existing.allowedUserIds.length > 0) {
    return runCursorSetup({
      home,
      profile,
      existingCursorApiKey: options.existingCursorApiKey,
      existingCwd: options.existingCwd,
      existingModel: options.existingModel,
    });
  }

  const rl = createInterface({ input, output });

  try {
    console.log(`memgrep telegram setup [${profile}]`);
    console.log('----------------------');
    console.log('1. Open Telegram and talk to @BotFather');
    console.log('2. Create a bot with /newbot (or reuse an existing one)');
    console.log('3. Copy the HTTP API token\n');

    let botToken = options.existingToken?.trim() || existing?.botToken || '';
    if (!botToken) {
      botToken = await prompt(rl, 'Paste bot token: ');
    } else {
      console.log('Using bot token from environment / existing config.');
    }
    if (!botToken.includes(':')) {
      throw new Error('That does not look like a BotFather token (expected digits:secret).');
    }

    const api = new TelegramApi(botToken);
    console.log('Validating token...');
    let me;
    try {
      me = await api.getMe();
    } catch (error) {
      throw new Error(
        `Could not reach Telegram API: ${formatFetchError(error)}\n` +
          `Check network/DNS, then retry. If the bot is already linked, run: memgrep telegram setup ${profile}`,
      );
    }
    const username = me.username ? `@${me.username}` : me.first_name ?? 'your bot';
    console.log(`Connected as ${username}\n`);

    let userId = existing?.allowedUserIds[0];
    let chatId: number | undefined;
    if (userId) {
      console.log(`Keeping allowlist user ${userId} from existing config.`);
    } else {
      console.log(
        `On your phone, open ${me.username ? `https://t.me/${me.username}` : 'your bot'} and send:`,
      );
      console.log('  /start\n');
      console.log('Waiting for /start (Ctrl-C to cancel)...');

      let offset = 0;
      const backlog = await api.getUpdates(0, 0);
      if (backlog.length > 0) {
        offset = backlog[backlog.length - 1].update_id + 1;
      }

      while (userId === undefined) {
        const updates = await api.getUpdates(offset, 30);
        for (const update of updates) {
          offset = update.update_id + 1;
          const message = update.message;
          const text = message?.text?.trim();
          const fromId = message?.from?.id;
          if (!message || !fromId) continue;
          if (text === '/start' || text?.startsWith('/start ')) {
            userId = fromId;
            chatId = message.chat.id;
            break;
          }
        }
      }
    }

    const { cursorApiKey, cwd, model } = await promptCursorFields(rl, {
      home,
      profile,
      existingCursorApiKey: options.existingCursorApiKey,
      existingCwd: options.existingCwd,
      existingModel: options.existingModel,
      existing,
    });

    const config = writeTelegramConfig(
      {
        botToken,
        allowedUserIds: [userId],
        botUsername: me.username,
        cursorApiKey,
        cwd,
        model,
      },
      home,
      profile,
    );

    if (chatId !== undefined) {
      await api.sendMessage(
        chatId,
        'memgrep telegram is linked. Free text talks to Cursor on your Mac; use /recall /list /show for memory shortcuts.\n\nTry: fix the failing test\nOr /help',
      );
    }

    console.log(`\nSaved → ${telegramConfigPath(home, profile)}`);
    console.log(`Cursor cwd : ${cwd}`);
    console.log(`Model      : ${model}`);
    console.log(
      profile === DEFAULT_TELEGRAM_PROFILE
        ? 'Run: memgrep telegram'
        : `Run: memgrep telegram --profile ${profile}`,
    );
    return config;
  } finally {
    rl.close();
  }
}
