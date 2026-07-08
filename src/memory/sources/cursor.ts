import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ChatInput } from '../store.js';
import { cleanUserText, extractText, makeTitle, type TranscriptSource } from './types.js';

interface TranscriptLine {
  role?: 'user' | 'assistant';
  message?: { content?: unknown };
}

/**
 * Cursor stores per-chat JSONL transcripts at:
 *   ~/.cursor/projects/<project-slug>/agent-transcripts/<chat-id>/<chat-id>.jsonl
 */
export function cursorSource(projectsDir?: string): TranscriptSource {
  const root = projectsDir ?? path.join(homedir(), '.cursor', 'projects');
  return {
    name: 'cursor',
    async *scan(): AsyncGenerator<ChatInput> {
      const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const transcriptsDir = path.join(root, project.name, 'agent-transcripts');
        const chatDirs = await readdir(transcriptsDir, { withFileTypes: true }).catch(() => []);
        for (const chatDir of chatDirs) {
          if (!chatDir.isDirectory()) continue;
          const file = path.join(transcriptsDir, chatDir.name, `${chatDir.name}.jsonl`);
          const raw = await readFile(file, 'utf8').catch(() => null);
          if (!raw) continue;
          const parsed = parseCursorTranscript(raw);
          if (!parsed) continue;
          const info = await stat(file);
          yield {
            title: parsed.title,
            project: prettifyProject(project.name),
            content: parsed.content,
            source: file,
            tool: 'cursor',
            createdAt: info.birthtime.toISOString(),
            modifiedAt: info.mtime.toISOString(),
          };
        }
      }
    },
  };
}

/** Convert a Cursor transcript JSONL into clean "User:/Assistant:" text, or null if empty. */
export function parseCursorTranscript(raw: string): { title: string; content: string } | null {
  const turns: string[] = [];
  let title = '';

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj.role || !obj.message) continue;

    const text = extractText(obj.message.content);
    if (!text) continue;

    if (obj.role === 'user') {
      const query = cleanUserText(text);
      if (!query) continue;
      if (!title) title = makeTitle(query);
      turns.push(`User: ${query}`);
    } else {
      turns.push(`Assistant: ${text.trim()}`);
    }
  }

  if (turns.length === 0) return null;
  return { title: title || makeTitle(turns[0]), content: turns.join('\n\n') };
}

/** "Users-jane-dev-my-app" -> "dev-my-app" (drop the home-dir prefix). */
function prettifyProject(slug: string): string {
  return slug.replace(/^Users-[^-]+-/, '');
}
