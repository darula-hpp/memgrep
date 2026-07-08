import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ChatInput } from '../store.js';
import { cleanUserText, extractText, makeTitle, type TranscriptSource } from './types.js';

interface ClaudeLine {
  type?: string;
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

/**
 * Claude Code stores per-session JSONL transcripts at:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 */
export function claudeSource(projectsDir?: string): TranscriptSource {
  const root = projectsDir ?? path.join(homedir(), '.claude', 'projects');
  return {
    name: 'claude',
    async *scan(): AsyncGenerator<ChatInput> {
      const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const files = await readdir(path.join(root, project.name)).catch(() => []);
        for (const name of files) {
          if (!name.endsWith('.jsonl')) continue;
          const file = path.join(root, project.name, name);
          const raw = await readFile(file, 'utf8').catch(() => null);
          if (!raw) continue;
          const parsed = parseClaudeTranscript(raw);
          if (!parsed) continue;
          const info = await stat(file);
          yield {
            title: parsed.title,
            project: parsed.project ?? project.name.replace(/^-/, '').replace(/-/g, '/'),
            content: parsed.content,
            source: file,
            tool: 'claude',
            createdAt: parsed.createdAt,
            modifiedAt: info.mtime.toISOString(),
          };
        }
      }
    },
  };
}

export function parseClaudeTranscript(
  raw: string,
): { title: string; content: string; project?: string; createdAt?: string } | null {
  const turns: string[] = [];
  let title = '';
  let project: string | undefined;
  let createdAt: string | undefined;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj: ClaudeLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if ((obj.type !== 'user' && obj.type !== 'assistant') || !obj.message) continue;
    if (obj.isSidechain) continue;

    const text = extractText(obj.message.content);
    if (!text) continue;

    if (obj.type === 'user') {
      const query = cleanUserText(text);
      // Skip synthetic messages (tool results echoed as user turns, caveats).
      if (!query || query.startsWith('Caveat:') || query.startsWith('[Request interrupted')) continue;
      if (!title) title = makeTitle(query);
      project ??= obj.cwd ? path.basename(obj.cwd) : undefined;
      createdAt ??= obj.timestamp;
      turns.push(`User: ${query}`);
    } else {
      turns.push(`Assistant: ${text.trim()}`);
    }
  }

  if (turns.length === 0) return null;
  return { title: title || makeTitle(turns[0]), content: turns.join('\n\n'), project, createdAt };
}
