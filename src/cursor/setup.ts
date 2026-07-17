import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_TELEGRAM_PROFILE,
  expandHomePath,
  normalizeWorkspaces,
  readTelegramConfig,
  sanitizeTelegramProfile,
} from '../telegram/config.js';
import {
  cursorConfigPath,
  readCursorConfig,
  redactToken,
  writeCursorConfig,
  type CursorConfig,
} from './config.js';
import { DEFAULT_AGENT_RUN_MODE } from './mode.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

/**
 * Onboarding for Cursor MCP host (API key + workspace allowlist).
 * Can import from an existing Telegram profile.
 */
export async function runCursorSetup(options: {
  home?: string;
  existingApiKey?: string;
  existingCwd?: string;
  existingTelegramProfile?: string;
} = {}): Promise<CursorConfig> {
  const home = options.home ?? defaultHome();
  const existing = readCursorConfig(home);

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep cursor setup');
    console.log('--------------------');
    console.log('This configures the local Cursor agent for MCP tools (cursor_run).');
    console.log(
      'For remote access: serve --http + any tunnel to :3921, with MEMGREP_MCP_TOKEN and MEMGREP_PUBLIC_URL.\n',
    );

    const defaultProfile =
      options.existingTelegramProfile ||
      existing?.telegramProfile ||
      DEFAULT_TELEGRAM_PROFILE;
    const profileAnswer = await prompt(
      rl,
      `Import from Telegram profile [${defaultProfile}] (or leave blank to skip import): `,
    );
    const profileName = sanitizeTelegramProfile(profileAnswer || defaultProfile);
    const telegram = readTelegramConfig(home, profileName);

    let apiKey = options.existingApiKey?.trim() || '';
    if (!apiKey && existing?.cursorApiKey) {
      const reuse = await prompt(
        rl,
        `API key already saved (${redactToken(existing.cursorApiKey)}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        apiKey = existing.cursorApiKey;
      }
    }
    if (!apiKey && telegram?.cursorApiKey) {
      const reuse = await prompt(
        rl,
        `Use Telegram profile "${profileName}" key (${redactToken(telegram.cursorApiKey)})? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        apiKey = telegram.cursorApiKey;
      }
    }
    if (!apiKey) {
      apiKey = await prompt(rl, 'Paste CURSOR_API_KEY: ');
    }
    if (!apiKey) {
      throw new Error('CURSOR_API_KEY is required.');
    }

    const defaultCwd =
      options.existingCwd || existing?.cwd || telegram?.cwd || process.cwd();
    const cwdAnswer = await prompt(rl, `Default cwd [${defaultCwd}]: `);
    const cwd = expandHomePath(cwdAnswer || defaultCwd);

    const workspaces = normalizeWorkspaces(
      existing?.workspaces?.length ? existing.workspaces : telegram?.workspaces,
      cwd,
    );

    const defaultModel = existing?.model || telegram?.model || DEFAULT_CURSOR_MODEL;
    const modelAnswer = await prompt(rl, `Model [${defaultModel}]: `);
    const model = modelAnswer || defaultModel;

    const config = writeCursorConfig(
      {
        cursorApiKey: apiKey,
        cwd,
        workspaces,
        model,
        agentMode: existing?.agentMode || telegram?.agentMode || DEFAULT_AGENT_RUN_MODE,
        telegramProfile: profileName,
      },
      home,
    );

    console.log(`\nSaved → ${cursorConfigPath(home)}`);
    console.log(`Default cwd: ${config.cwd}`);
    console.log(`Workspaces: ${config.workspaces?.length ?? 0}`);
    console.log(
      'Cursor tools appear on memgrep MCP after restart (serve / telegram).',
    );
    console.log('Tunnel: MEMGREP_MCP_TOKEN=… node dist/cli.js serve --http');
    console.log('        point any tunnel at 127.0.0.1:3921 and set MEMGREP_PUBLIC_URL');
    return config;
  } finally {
    rl.close();
  }
}
