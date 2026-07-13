/**
 * Convert common Markdown (as Cursor agents emit) to Telegram HTML parse_mode.
 * Telegram's Markdown/MarkdownV2 do not accept GitHub-style **bold**.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Segment = { kind: 'raw' | 'protected'; text: string };

function protectSegments(md: string): Segment[] {
  const segments: Segment[] = [];
  const fenceRe = /```([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(md)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'raw', text: md.slice(last, match.index) });
    }
    const inner = match[1] ?? '';
    // Drop optional language tag on first line; trim fence newlines.
    const body = inner
      .replace(/^[a-zA-Z0-9_+-]+\r?\n/, '')
      .replace(/^\r?\n/, '')
      .replace(/\r?\n$/, '');
    segments.push({
      kind: 'protected',
      text: `<pre>${escapeHtml(body)}</pre>`,
    });
    last = match.index + match[0].length;
  }
  if (last < md.length) {
    segments.push({ kind: 'raw', text: md.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: 'raw', text: md }];
}

function protectInlineCode(raw: string): Segment[] {
  const segments: Segment[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'raw', text: raw.slice(last, match.index) });
    }
    segments.push({
      kind: 'protected',
      text: `<code>${escapeHtml(match[1] ?? '')}</code>`,
    });
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    segments.push({ kind: 'raw', text: raw.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: 'raw', text: raw }];
}

function formatInlineMarkdown(text: string): string {
  // Links: [label](url)
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '[') {
      const close = text.indexOf('](', i);
      if (close !== -1) {
        const end = text.indexOf(')', close + 2);
        if (end !== -1) {
          const label = text.slice(i + 1, close);
          const href = text.slice(close + 2, end);
          if (/^https?:\/\//i.test(href) || href.startsWith('tg://')) {
            out += `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
            i = end + 1;
            continue;
          }
        }
      }
    }
    out += text[i];
    i += 1;
  }

  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => `<b>${escapeHtml(inner)}</b>`);
  out = out.replace(/__([^_]+)__/g, (_, inner: string) => `<b>${escapeHtml(inner)}</b>`);

  // Italic: *text* or _text_ (avoid matching inside words for _)
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, inner: string) => `<i>${escapeHtml(inner)}</i>`);
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, (_, inner: string) => `<i>${escapeHtml(inner)}</i>`);

  // Escape leftover plain text while preserving tags we inserted.
  return escapeOutsideTags(out);
}

function escapeOutsideTags(htmlish: string): string {
  // Only preserve tags we emit; treat other <> as plain text to escape.
  const parts = htmlish.split(/(<\/?(?:b|i|a|code|pre)(?:\s[^>]*)?>)/i);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part; // known tag
      return part
        .replace(/&(?!(amp|lt|gt|quot|#\d+|#x[\da-f]+);)/gi, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    })
    .join('');
}

/** Convert Markdown-ish agent text into Telegram HTML. */
export function markdownToTelegramHtml(md: string): string {
  const fences = protectSegments(md);
  const rendered: string[] = [];
  for (const seg of fences) {
    if (seg.kind === 'protected') {
      rendered.push(seg.text);
      continue;
    }
    const inlines = protectInlineCode(seg.text);
    for (const piece of inlines) {
      if (piece.kind === 'protected') {
        rendered.push(piece.text);
      } else {
        rendered.push(formatInlineMarkdown(piece.text));
      }
    }
  }
  return rendered.join('');
}

export type TelegramParseMode = 'HTML';

export type FormattedTelegramMessage = {
  text: string;
  parseMode?: TelegramParseMode;
};

/**
 * Prefer HTML formatting; callers should fall back to plain text on API errors.
 */
export function formatTelegramMessage(text: string): FormattedTelegramMessage {
  const html = markdownToTelegramHtml(text);
  // If conversion produced no tags and matches escaped plain text, skip parse_mode.
  const plainEscaped = escapeHtml(text);
  if (html === plainEscaped) {
    return { text };
  }
  return { text: html, parseMode: 'HTML' };
}
