import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedUser, parseAllowedUserIds } from '../allowlist.js';
import { telegramMethodUrl } from '../api.js';
import {
  DEFAULT_CURSOR_MODEL,
  maybeMigrateEnvToConfig,
  readTelegramConfig,
  redactToken,
  resolveTelegramConfig,
  writeTelegramConfig,
} from '../config.js';
import { helpText, parseTelegramCommand } from '../router.js';
import { dispatchCommand } from '../bot.js';
import type { CursorAgentSession } from '../cursor-agent.js';
import type { MemoryAccess } from '../types.js';
import { splitForTelegram } from '../../memory/tools.js';

describe('parseAllowedUserIds', () => {
  it('parses comma-separated ids', () => {
    expect([...parseAllowedUserIds('123, 456')].sort()).toEqual([123, 456]);
  });

  it('rejects missing or invalid values', () => {
    expect(() => parseAllowedUserIds(undefined)).toThrow();
    expect(() => parseAllowedUserIds('')).toThrow();
    expect(() => parseAllowedUserIds('abc')).toThrow();
  });
});

describe('isAllowedUser', () => {
  const allowed = new Set([42, 99]);
  it('allows listed ids only', () => {
    expect(isAllowedUser(allowed, 42)).toBe(true);
    expect(isAllowedUser(allowed, 1)).toBe(false);
    expect(isAllowedUser(allowed, undefined)).toBe(false);
  });
});

describe('telegramMethodUrl', () => {
  it('keeps https scheme when the token contains a colon', () => {
    const url = telegramMethodUrl('123456:ABC-DEF', 'getUpdates');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('api.telegram.org');
    expect(url.pathname).toBe('/bot123456:ABC-DEF/getUpdates');
  });
});

describe('telegram config file', () => {
  let home: string;

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('writes and reads telegram.json', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-tg-'));
    writeTelegramConfig(
      {
        botToken: '123456:ABCDEF-secret',
        allowedUserIds: [1355870341],
        botUsername: 'memgrep_bot',
        cursorApiKey: 'cursor_test_key_abcdefgh',
        cwd: '/tmp/project',
        model: 'composer-2.5',
      },
      home,
    );
    const raw = await readFile(path.join(home, 'telegram.json'), 'utf8');
    expect(raw).toContain('1355870341');
    expect(raw).toContain('cursor_test_key');
    expect(raw).toContain('/tmp/project');

    const loaded = readTelegramConfig(home);
    expect(loaded?.botUsername).toBe('memgrep_bot');
    expect(loaded?.allowedUserIds).toEqual([1355870341]);
    expect(loaded?.cursorApiKey).toBe('cursor_test_key_abcdefgh');
    expect(loaded?.cwd).toBe('/tmp/project');
    expect(loaded?.model).toBe('composer-2.5');
  });

  it('resolves file config and env overrides', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-tg-'));
    writeTelegramConfig(
      {
        botToken: '111:filetoken',
        allowedUserIds: [1],
        cursorApiKey: 'cursor_file',
        cwd: '/from/file',
      },
      home,
    );

    const fromFile = resolveTelegramConfig({}, home);
    expect(fromFile?.source).toBe('file');
    expect([...fromFile!.allowedUserIds]).toEqual([1]);
    expect(fromFile?.cursorApiKey).toBe('cursor_file');
    expect(fromFile?.cwd).toBe('/from/file');
    expect(fromFile?.model).toBe(DEFAULT_CURSOR_MODEL);

    const mixed = resolveTelegramConfig(
      {
        TELEGRAM_ALLOWED_USER_IDS: '99',
        TELEGRAM_BOT_TOKEN: '222:envtoken',
        CURSOR_API_KEY: 'cursor_env',
        MEMGREP_TELEGRAM_CWD: '/from/env',
        MEMGREP_TELEGRAM_MODEL: 'composer-2',
      },
      home,
    );
    expect(mixed?.source).toBe('mixed');
    expect(mixed?.botToken).toBe('222:envtoken');
    expect([...mixed!.allowedUserIds]).toEqual([99]);
    expect(mixed?.cursorApiKey).toBe('cursor_env');
    expect(mixed?.cwd).toBe('/from/env');
    expect(mixed?.model).toBe('composer-2');
  });

  it('migrates env credentials into telegram.json once', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'memgrep-tg-'));
    const migrated = maybeMigrateEnvToConfig(
      {
        TELEGRAM_BOT_TOKEN: '333:migrated',
        TELEGRAM_ALLOWED_USER_IDS: '42',
        CURSOR_API_KEY: 'cursor_migrated_key',
      },
      home,
    );
    expect(migrated?.botToken).toBe('333:migrated');
    expect(migrated?.cursorApiKey).toBe('cursor_migrated_key');
    expect(readTelegramConfig(home)?.allowedUserIds).toEqual([42]);
    expect(
      maybeMigrateEnvToConfig(
        { TELEGRAM_BOT_TOKEN: '333:migrated', TELEGRAM_ALLOWED_USER_IDS: '42' },
        home,
      ),
    ).toBeNull();
  });

  it('redacts tokens for status output', () => {
    expect(redactToken('123456:ABCDEFGHIJKLMNOP')).toMatch(/^123456…/);
  });
});

describe('parseTelegramCommand', () => {
  it('routes slash commands', () => {
    expect(parseTelegramCommand('/help')).toEqual({ kind: 'help' });
    expect(parseTelegramCommand('/start')).toEqual({ kind: 'help' });
    expect(parseTelegramCommand('/list')).toEqual({ kind: 'list', project: undefined });
    expect(parseTelegramCommand('/list api')).toEqual({ kind: 'list', project: 'api' });
    expect(parseTelegramCommand('/show 12')).toEqual({ kind: 'show', chatId: 12 });
    expect(parseTelegramCommand('/recall auth race')).toEqual({
      kind: 'recall',
      query: 'auth race',
    });
    expect(parseTelegramCommand('/ask fix the bug')).toEqual({
      kind: 'agent',
      text: 'fix the bug',
    });
    expect(parseTelegramCommand('/new')).toEqual({ kind: 'new' });
    expect(parseTelegramCommand('/reset')).toEqual({ kind: 'new' });
    expect(parseTelegramCommand('/cwd')).toEqual({ kind: 'cwd', path: undefined });
    expect(parseTelegramCommand('/cwd ~/dev/app')).toEqual({ kind: 'cwd', path: '~/dev/app' });
    expect(parseTelegramCommand('/status')).toEqual({ kind: 'status' });
  });

  it('treats free text as Cursor agent', () => {
    expect(parseTelegramCommand('how did we fix auth?')).toEqual({
      kind: 'agent',
      text: 'how did we fix auth?',
    });
  });

  it('ignores empty messages', () => {
    expect(parseTelegramCommand('')).toEqual({ kind: 'ignored' });
    expect(parseTelegramCommand(undefined)).toEqual({ kind: 'ignored' });
  });
});

describe('dispatchCommand', () => {
  const access: MemoryAccess = {
    async recall(query) {
      return { text: `recall:${query}` };
    },
    async getChat(chatId) {
      return { text: `chat:${chatId}` };
    },
    async listChats(project) {
      return { text: `list:${project ?? 'all'}` };
    },
  };

  it('dispatches memory slash commands', async () => {
    expect(await dispatchCommand(access, '/recall fix auth')).toBe('recall:fix auth');
    expect(await dispatchCommand(access, '/show 7')).toBe('chat:7');
    expect(await dispatchCommand(access, '/list web')).toBe('list:web');
    expect(await dispatchCommand(access, '/help')).toContain('Cursor-first');
  });

  it('routes free text to a mocked Cursor session', async () => {
    const sent: string[] = [];
    let cwd = '/tmp/demo';
    const session: CursorAgentSession = {
      async send(text) {
        sent.push(text);
        return `agent:${text}`;
      },
      async reset() {
        sent.push('RESET');
      },
      async setCwd(next) {
        cwd = next;
        return cwd;
      },
      status() {
        return { agentId: 'agent-test', cwd, model: 'composer-2.5' };
      },
      async close() {},
    };

    const cursor = {
      sessionFor: () => session,
      status: () => ({ cwd, model: 'composer-2.5' }),
    };

    expect(
      await dispatchCommand({
        access,
        cursor,
        userId: 1,
        command: { kind: 'agent', text: 'fix the flaky test' },
        text: 'fix the flaky test',
      }),
    ).toBe('agent:fix the flaky test');
    expect(sent).toEqual(['fix the flaky test']);

    expect(
      await dispatchCommand({
        access,
        cursor,
        userId: 1,
        command: { kind: 'new' },
        text: '/new',
      }),
    ).toContain('fresh Cursor');
    expect(sent).toContain('RESET');

    const project = await mkdtemp(path.join(tmpdir(), 'memgrep-cwd-'));
    try {
      expect(
        await dispatchCommand({
          access,
          cursor,
          userId: 1,
          command: { kind: 'cwd', path: project },
          text: `/cwd ${project}`,
        }),
      ).toContain(project);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe('splitForTelegram', () => {
  it('keeps short messages intact', () => {
    expect(splitForTelegram('hello')).toEqual(['hello']);
  });

  it('splits long messages near newlines', () => {
    const block = 'line\n'.repeat(1000);
    const parts = splitForTelegram(block, 100);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('\n').replace(/\n+/g, '\n')).toContain('line');
  });
});

describe('helpText', () => {
  it('mentions Cursor and memory commands', () => {
    const text = helpText();
    expect(text).toContain('/ask');
    expect(text).toContain('/new');
    expect(text).toContain('/list');
    expect(text).toContain('/show');
    expect(text).toContain('/recall');
  });
});
