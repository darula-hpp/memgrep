import { splitForTelegram } from '../memory/tools.js';
import { TelegramApi } from './api.js';
import { isAllowedUser } from './allowlist.js';
import { formatFetchError } from './errors.js';
import { helpText, parseTelegramCommand } from './router.js';
import type { MemoryAccess, TelegramBotConfig, TelegramCommand, TelegramUpdate } from './types.js';
import type { CursorAgentSession } from './cursor-agent.js';

export class TelegramBot {
  private offset = 0;
  private stopped = false;
  private readonly api: TelegramApi;

  constructor(private readonly config: TelegramBotConfig) {
    this.api = new TelegramApi(config.botToken);
  }

  async run(): Promise<void> {
    console.error(
      `memgrep telegram: polling (allowlist ${[...this.config.allowedUserIds].join(', ')})`,
    );
    while (!this.stopped) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error('Telegram poll error:', formatFetchError(error));
        await sleep(2000);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    return this.api.getUpdates(this.offset, 30);
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text) return;

    const userId = message.from?.id;
    if (!isAllowedUser(this.config.allowedUserIds, userId)) {
      console.error(`Ignored message from unauthorized user ${userId ?? 'unknown'}`);
      return;
    }

    const command = parseTelegramCommand(message.text);
    const needsCursor =
      command.kind === 'agent' ||
      command.kind === 'new' ||
      command.kind === 'cwd' ||
      command.kind === 'status';

    if (needsCursor && command.kind === 'agent') {
      await this.api.sendMessage(message.chat.id, 'Cursor is working…');
    }

    const reply = await dispatchCommand({
      access: this.config.access,
      cursor: this.config.cursor,
      userId: userId!,
      command,
      text: message.text,
    });

    for (const part of splitForTelegram(reply)) {
      await this.api.sendMessage(message.chat.id, part);
    }
  }
}

export type DispatchContext = {
  access: MemoryAccess;
  cursor?: TelegramBotConfig['cursor'];
  userId: number;
  command: TelegramCommand;
  text: string;
};

export async function dispatchCommand(
  accessOrCtx: MemoryAccess | DispatchContext,
  text?: string,
): Promise<string> {
  // Back-compat for tests: dispatchCommand(access, text)
  const ctx: DispatchContext =
    text !== undefined
      ? {
          access: accessOrCtx as MemoryAccess,
          userId: 0,
          command: parseTelegramCommand(text),
          text,
        }
      : (accessOrCtx as DispatchContext);

  const { access, command } = ctx;

  switch (command.kind) {
    case 'help':
      return helpText();
    case 'list': {
      const result = await access.listChats(command.project);
      return result.text;
    }
    case 'show': {
      const result = await access.getChat(command.chatId);
      return result.text;
    }
    case 'recall': {
      const result = await access.recall(command.query);
      return result.text;
    }
    case 'agent':
      return runAgent(ctx, command.text);
    case 'new': {
      const session = requireSession(ctx);
      await session.reset();
      return 'Started a fresh Cursor conversation.';
    }
    case 'cwd': {
      const session = requireSession(ctx);
      if (!command.path) {
        const s = session.status();
        return `cwd: ${s.cwd}\nmodel: ${s.model}${s.agentId ? `\nagent: ${s.agentId}` : ''}`;
      }
      const next = await session.setCwd(command.path);
      return `cwd set to ${next} (new Cursor conversation).`;
    }
    case 'status': {
      if (!ctx.cursor) {
        return 'Cursor agent is not configured. Set CURSOR_API_KEY and re-run setup.';
      }
      const pool = ctx.cursor.status();
      const session = ctx.cursor.sessionFor(ctx.userId);
      const s = session.status();
      return [
        `cwd: ${s.cwd || pool.cwd}`,
        `model: ${s.model || pool.model}`,
        s.agentId ? `agent: ${s.agentId}` : 'agent: (not started yet — send a message)',
      ].join('\n');
    }
    case 'ignored':
      return helpText();
  }
}

function requireSession(ctx: DispatchContext): CursorAgentSession {
  if (!ctx.cursor) {
    throw new Error('Cursor agent is not configured. Set CURSOR_API_KEY and run: memgrep telegram setup');
  }
  return ctx.cursor.sessionFor(ctx.userId);
}

async function runAgent(ctx: DispatchContext, prompt: string): Promise<string> {
  try {
    const session = requireSession(ctx);
    return await session.send(prompt);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
