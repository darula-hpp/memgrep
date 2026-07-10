import type { TelegramCommand } from './types.js';

const HELP_TEXT = `memgrep telegram — Cursor-first

Free text talks to Cursor on your Mac (uses your Cursor plan).
The agent can call memgrep memory tools via MCP.

Cursor:
  <message>          send to Cursor
  /ask <message>     same as free text
  /new               start a fresh Cursor conversation
  /cwd [path]        show or change the project directory
  /status            agent cwd + model

Memory shortcuts:
  /recall <query>    semantic search
  /list [project]    list remembered chats
  /show <id>         full transcript
  /help              this message
`;

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
