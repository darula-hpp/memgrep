import { splitForTelegram } from '../memory/tools.js';
import { rebuildTelegramTransport, TelegramApi } from './api.js';
import { isAllowedUser } from './allowlist.js';
import { formatFetchError, isAbortError, isNetworkTimeoutError } from './errors.js';
import {
  clampPollingStallThresholdMs,
  isPollingStalled,
  POLLING_STALL_THRESHOLD_MS,
  POLLING_WATCHDOG_INTERVAL_MS,
} from './polling.js';
import { helpText, parseTelegramCommand, TELEGRAM_BOT_COMMANDS } from './router.js';
import type { AgentSession } from './agent/types.js';
import type { MemoryAccess, TelegramBotConfig, TelegramCommand, TelegramUpdate } from './types.js';

export type TelegramBotRunOptions = {
  /** Stall threshold before soft-restarting the poll transport (default 120s). */
  stallThresholdMs?: number;
  /** Watchdog tick interval (default 10s). */
  watchdogIntervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export class TelegramBot {
  private offset = 0;
  private stopped = false;
  private readonly api: TelegramApi;
  /** Serialize message handling so Cursor runs don't stack, without blocking long-poll. */
  private handling: Promise<void> = Promise.resolve();
  private lastPollCompletedAt = 0;
  private recoveringStall = false;
  private readonly stallThresholdMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly config: TelegramBotConfig,
    options: TelegramBotRunOptions = {},
  ) {
    this.api = new TelegramApi(config.botToken);
    this.stallThresholdMs = clampPollingStallThresholdMs(
      options.stallThresholdMs ?? POLLING_STALL_THRESHOLD_MS,
    );
    this.watchdogIntervalMs = Math.max(1_000, options.watchdogIntervalMs ?? POLLING_WATCHDOG_INTERVAL_MS);
    this.now = options.now ?? Date.now;
  }

  async run(): Promise<void> {
    console.error(
      `memgrep telegram: polling (allowlist ${[...this.config.allowedUserIds].join(', ')})`,
    );
    try {
      await this.api.setMyCommands([...TELEGRAM_BOT_COMMANDS]);
    } catch (error) {
      console.error(
        'memgrep telegram: setMyCommands failed (slash suggestions may be missing):',
        formatFetchError(error),
      );
    }
    this.lastPollCompletedAt = this.now();
    const watchdog = setInterval(() => {
      void this.checkPollingStall();
    }, this.watchdogIntervalMs);
    // Allow the process to exit naturally in tests / clean shutdown.
    watchdog.unref?.();

    let backoffMs = 2000;
    try {
      while (!this.stopped) {
        try {
          const updates = await this.api.getUpdates(this.offset);
          this.lastPollCompletedAt = this.now();
          backoffMs = 2000;
          for (const update of updates) {
            this.offset = update.update_id + 1;
            // Keep long-polling alive while Cursor (or memory) work runs.
            this.handling = this.handling
              .then(() => this.handleUpdate(update))
              .catch((error) => {
                console.error('Telegram handler error:', formatFetchError(error));
              });
          }
        } catch (error) {
          if (this.stopped || isAbortError(error)) continue;
          const detail = formatFetchError(error);
          console.error('Telegram poll error:', detail);
          if (isNetworkTimeoutError(error)) {
            console.error(
              'Hint: cannot reach api.telegram.org (ETIMEDOUT). Check VPN/firewall, or try: curl -4 -I https://api.telegram.org',
            );
          }
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      }
    } finally {
      clearInterval(watchdog);
    }
    this.api.abortPoll();
    await this.handling;
  }

  stop(): void {
    this.stopped = true;
    this.api.abortPoll();
  }

  /** @internal exposed for tests */
  getLastPollCompletedAt(): number {
    return this.lastPollCompletedAt;
  }

  private async checkPollingStall(): Promise<void> {
    if (this.stopped || this.recoveringStall) return;
    const now = this.now();
    if (!isPollingStalled(this.lastPollCompletedAt, now, this.stallThresholdMs)) return;

    this.recoveringStall = true;
    const idleSec = ((now - this.lastPollCompletedAt) / 1000).toFixed(1);
    console.error(
      `memgrep telegram: Polling stall detected (no getUpdates for ${idleSec}s); forcing restart.`,
    );
    try {
      this.api.abortPoll();
      await rebuildTelegramTransport();
      // Avoid immediate re-trigger while the next getUpdates is in flight.
      this.lastPollCompletedAt = this.now();
    } catch (error) {
      console.error('memgrep telegram: poll transport rebuild failed:', formatFetchError(error));
    } finally {
      this.recoveringStall = false;
    }
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

    if (command.kind === 'agent') {
      await this.api.sendMessage(message.chat.id, 'Cursor is working…');
    }

    const reply = await dispatchCommand({
      access: this.config.access,
      agent: this.config.agent,
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
  agent?: TelegramBotConfig['agent'];
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
        return session.listWorkspaces();
      }
      const next = await session.setCwd(command.path);
      return `cwd set to ${next} (new Cursor conversation).`;
    }
    case 'ws': {
      const session = requireSession(ctx);
      try {
        if (command.action === 'list') return session.listWorkspaces();
        if (command.action === 'switch') return await session.switchWorkspace(command.ref);
        if (command.action === 'add') return await session.addWorkspace(command.name, command.path);
        return await session.removeWorkspace(command.name);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    case 'status': {
      if (!ctx.agent) {
        return 'Coding agent is not configured. Set CURSOR_API_KEY and re-run setup.';
      }
      const pool = ctx.agent.status();
      const session = ctx.agent.sessionFor(ctx.userId);
      const s = session.status();
      return [
        `cwd: ${s.cwd || pool.cwd}`,
        `model: ${s.model || pool.model}`,
        s.agentId ? `agent: ${s.agentId}` : 'agent: (not started yet — send a message)',
        '',
        session.listWorkspaces(),
      ].join('\n');
    }
    case 'model': {
      const session = requireSession(ctx);
      try {
        if (!command.model) return await session.listModels();
        return await session.setModel(command.model);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    case 'ignored':
      return helpText();
  }
}

function requireSession(ctx: DispatchContext): AgentSession {
  if (!ctx.agent) {
    throw new Error('Coding agent is not configured. Set CURSOR_API_KEY and run: memgrep telegram setup');
  }
  return ctx.agent.sessionFor(ctx.userId);
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
