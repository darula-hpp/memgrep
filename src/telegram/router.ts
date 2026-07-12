import type { TelegramCommand } from './types.js';

const HELP_TEXT = `memgrep telegram — Cursor-first

Free text talks to Cursor on your Mac (uses your Cursor plan).
The agent can call memgrep memory tools via MCP.

Cursor:
  <message>          send to Cursor
  /ask <message>     same as free text
  /new               start a fresh Cursor conversation
  /ws                list workspaces (* = current)
  /ws <n|name>       switch workspace
  /ws add <name> <path>
  /ws rm <name>      remove a saved workspace
  /cwd [path]        show or switch by full path
  /model             list models (* = current)
  /model <id>        switch model (new conversation)
  /mode              list Cursor modes (* = current)
  /mode <agent|plan> switch conversation mode
  /status            cwd + model + mode + workspaces

Memory shortcuts:
  /recall <query>    semantic search
  /list [project]    list remembered chats
  /show <id>         full transcript
  /open <id>         resume that chat (or inject into current)
  /help              this message
`;

/** Slash commands registered with Telegram for `/` autocomplete suggestions. */
export type TelegramBotCommand = {
  command: string;
  description: string;
};

/**
 * BotFather-style command menu. Telegram shows these when the user types `/`.
 * Keep descriptions short (API max 256 chars); command names lowercase 1–32.
 */
export const TELEGRAM_BOT_COMMANDS: readonly TelegramBotCommand[] = [
  { command: 'start', description: 'Show help and get started' },
  { command: 'help', description: 'List all commands' },
  { command: 'new', description: 'Start a fresh Cursor conversation' },
  { command: 'ask', description: 'Send a prompt to Cursor' },
  { command: 'status', description: 'Show cwd, model, and agent' },
  { command: 'model', description: 'List or switch Cursor model' },
  { command: 'mode', description: 'List or switch agent/plan mode' },
  { command: 'ws', description: 'List or switch workspaces' },
  { command: 'cwd', description: 'Show or set working directory' },
  { command: 'recall', description: 'Semantic search memory' },
  { command: 'list', description: 'List remembered chats' },
  { command: 'show', description: 'Show a chat transcript by id' },
  { command: 'open', description: 'Resume or continue a remembered chat' },
];

export function helpText(): string {
  return HELP_TEXT;
}

/**
 * Parse an inbound Telegram message into a typed command.
 * Free text defaults to Cursor agent (not memory recall).
 */
export function parseTelegramCommand(text: string | undefined): TelegramCommand {
  const raw = (text ?? '').trim();
  if (!raw) return { kind: 'ignored' };

  if (raw === '/help' || raw === '/start') {
    return { kind: 'help' };
  }

  if (raw === '/new' || raw === '/reset') {
    return { kind: 'new' };
  }

  if (raw === '/status') {
    return { kind: 'status' };
  }

  const modelMatch = raw.match(/^\/model(?:@\w+)?(?:\s+(.+))?$/i);
  if (modelMatch) {
    const model = modelMatch[1]?.trim();
    return { kind: 'model', model: model || undefined };
  }

  const modeMatch = raw.match(/^\/mode(?:@\w+)?(?:\s+(.+))?$/i);
  if (modeMatch) {
    const mode = modeMatch[1]?.trim();
    return { kind: 'mode', mode: mode || undefined };
  }

  const wsMatch = raw.match(/^\/(?:ws|workspace|workspaces)(?:@\w+)?(?:\s+(.+))?$/i);
  if (wsMatch) {
    return parseWorkspaceCommand(wsMatch[1]?.trim());
  }

  const cwdMatch = raw.match(/^\/cwd(?:@\w+)?(?:\s+(.+))?$/i);
  if (cwdMatch) {
    const path = cwdMatch[1]?.trim();
    return { kind: 'cwd', path: path || undefined };
  }

  const listMatch = raw.match(/^\/list(?:@\w+)?(?:\s+(.+))?$/i);
  if (listMatch) {
    const project = listMatch[1]?.trim();
    return { kind: 'list', project: project || undefined };
  }

  const showMatch = raw.match(/^\/show(?:@\w+)?\s+(\d+)\s*$/i);
  if (showMatch) {
    return { kind: 'show', chatId: Number(showMatch[1]) };
  }

  const openMatch = raw.match(/^\/open(?:@\w+)?\s+(\d+)\s*$/i);
  if (openMatch) {
    return { kind: 'open', chatId: Number(openMatch[1]) };
  }

  const recallMatch = raw.match(/^\/recall(?:@\w+)?\s+(.+)$/i);
  if (recallMatch) {
    return { kind: 'recall', query: recallMatch[1].trim() };
  }

  const askMatch = raw.match(/^\/ask(?:@\w+)?\s+(.+)$/i);
  if (askMatch) {
    return { kind: 'agent', text: askMatch[1].trim() };
  }

  if (raw.startsWith('/')) {
    return { kind: 'help' };
  }

  return { kind: 'agent', text: raw };
}

function parseWorkspaceCommand(args: string | undefined): TelegramCommand {
  if (!args) return { kind: 'ws', action: 'list' };

  const addMatch = args.match(/^add\s+(\S+)\s+(.+)$/i);
  if (addMatch) {
    return { kind: 'ws', action: 'add', name: addMatch[1], path: addMatch[2].trim() };
  }

  const rmMatch = args.match(/^(?:rm|remove|delete)\s+(\S+)$/i);
  if (rmMatch) {
    return { kind: 'ws', action: 'remove', name: rmMatch[1] };
  }

  return { kind: 'ws', action: 'switch', ref: args };
}
