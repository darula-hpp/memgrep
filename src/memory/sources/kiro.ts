import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import type { ChatInput } from '../store.js';
import { cleanUserText, extractText, makeTitle, type TranscriptSource } from './types.js';

interface KiroSession {
  title?: string;
  workspacePath?: string;
  history?: { message?: { role?: string; content?: unknown } }[];
}

function defaultKiroDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent', 'workspace-sessions');
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent', 'workspace-sessions');
    default:
      return path.join(home, '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent', 'workspace-sessions');
  }
}

/**
 * Kiro IDE stores session shells as JSON per workspace:
 *   <globalStorage>/kiro.kiroagent/workspace-sessions/<b64url-workspace-path>/<sessionId>.json
 * Session files contain user messages and titles; full assistant output lives in
 * separate opaque execution records, so Kiro chats are ingested user-side only.
 */
export function kiroSource(sessionsDir?: string): TranscriptSource {
  const root = sessionsDir ?? defaultKiroDir();
  return {
    name: 'kiro',
    async *scan(): AsyncGenerator<ChatInput> {
      const workspaces = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const workspace of workspaces) {
        if (!workspace.isDirectory()) continue;
        const dir = path.join(root, workspace.name);
        const files = await readdir(dir).catch(() => []);
        for (const name of files) {
          if (!name.endsWith('.json') || name === 'sessions.json') continue;
          const file = path.join(dir, name);
          const raw = await readFile(file, 'utf8').catch(() => null);
          if (!raw) continue;
          let session: KiroSession;
          try {
            session = JSON.parse(raw);
          } catch {
            continue;
          }
          const parsed = parseKiroSession(session);
          if (!parsed) continue;
          const info = await stat(file);
          yield {
            title: parsed.title,
            project: parsed.project ?? decodeWorkspace(workspace.name),
            content: parsed.content,
            source: file,
            tool: 'kiro',
            createdAt: info.birthtime.toISOString(),
            modifiedAt: info.mtime.toISOString(),
          };
        }
      }
    },
  };
}

export function parseKiroSession(
  session: KiroSession,
): { title: string; content: string; project?: string } | null {
  if (!Array.isArray(session.history)) return null;
  const turns: string[] = [];

  for (const turn of session.history) {
    const role = turn.message?.role;
    const text = extractText(turn.message?.content);
    if (!text) continue;
    if (role === 'user') {
      const query = cleanUserText(text);
      if (query) turns.push(`User: ${query}`);
    } else if (role === 'assistant') {
      const reply = text.trim();
      // Kiro session shells hold placeholder assistant stubs; keep only real content.
      if (reply && reply !== 'On it.') turns.push(`Assistant: ${reply}`);
    }
  }

  if (turns.length === 0) return null;
  const title = session.title?.trim() || makeTitle(turns[0]);
  const project = session.workspacePath ? path.basename(session.workspacePath) : undefined;
  return { title, content: turns.join('\n\n'), project };
}

/** Workspace dirs are base64url-encoded absolute paths. */
function decodeWorkspace(name: string): string {
  try {
    const padded = name + '='.repeat((4 - (name.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64url').toString('utf8');
    return path.basename(decoded);
  } catch {
    return name;
  }
}
