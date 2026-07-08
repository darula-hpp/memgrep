import type { ChatInput } from '../store.js';

/** A tool whose local chat history can be ingested into memory. */
export interface TranscriptSource {
  /** Stable identifier, e.g. "cursor", "claude", "kiro". */
  name: string;
  /** Yield all chats found on disk. Must yield nothing (not throw) when the tool is absent. */
  scan(): AsyncGenerator<ChatInput>;
}

/** Concatenate text parts of an Anthropic-style content value; ignore tool parts. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text',
    )
    .map((part) => part.text)
    .join('\n');
}

/**
 * User messages often arrive wrapped in system context (attached files, search
 * results, reminders). Prefer the explicit <user_query> block; otherwise
 * strip known metadata blocks and keep what remains.
 */
export function cleanUserText(text: string): string {
  const queries = [...text.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)].map((m) =>
    m[1].trim(),
  );
  if (queries.length > 0) return queries.join('\n');

  return text
    .replace(/<(external_links|open_and_recently_viewed_files|system_reminder|system_notification|attached_files|user_info|agent_transcripts|agent_skills|timestamp|command-name|command-message|command-args|local-command-stdout)>[\s\S]*?<\/\1>/g, '')
    .trim();
}

export function makeTitle(text: string): string {
  const firstLine = text.replace(/^User:\s*/, '').split('\n')[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
