import { Lexer, type Token, type Tokens } from 'marked';
import { escapeXml } from './xml.js';

/** Matches {{ field | rich }} (optional spaces). */
export const RICH_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}/g;

const TWIPS_PER_INDENT = 720; // 0.5" per indent level

/** Forced face/size for all `| rich` output (Word half-points: 24 = 12pt). */
export const RICH_FONT = 'Arial';
export const RICH_FONT_SIZE_HALF_POINTS = 24;

const RICH_RFONTS =
  `<w:rFonts w:ascii="${RICH_FONT}" w:hAnsi="${RICH_FONT}" w:cs="${RICH_FONT}" w:eastAsia="${RICH_FONT}"/>`;
const RICH_SZ = `<w:sz w:val="${RICH_FONT_SIZE_HALF_POINTS}"/><w:szCs w:val="${RICH_FONT_SIZE_HALF_POINTS}"/>`;

export function extractRichFieldNames(text: string): string[] {
  const fields = new Set<string>();
  const re = /\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}/g;
  for (const match of text.matchAll(re)) {
    fields.add(match[1]!);
  }
  return [...fields];
}

export type RichSegment =
  | { type: 'text'; text: string }
  | { type: 'rich'; name: string };

/** Split coalesced paragraph text into text / rich segments. */
export function splitRichSegments(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  const re = /\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'rich', name: match[1]! });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }
  if (segments.length === 0 && text.length > 0) {
    segments.push({ type: 'text', text });
  }
  return segments;
}

/** True when the paragraph is only a single `{{ field | rich }}` (optional surrounding whitespace). */
export function findSoleRichPlaceholder(text: string): string | null {
  const segments = splitRichSegments(text);
  const rich = segments.filter((s): s is { type: 'rich'; name: string } => s.type === 'rich');
  if (rich.length !== 1) return null;
  for (const seg of segments) {
    if (seg.type === 'text' && seg.text.trim() !== '') return null;
  }
  return rich[0]!.name;
}

type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type InlineRun = { text: string; style: RunStyle };

function runXml(text: string, style: RunStyle = {}): string {
  if (!text) return '';
  // Always Arial 12pt so rich blocks don't fall back to Calibri / theme defaults.
  const rPr: string[] = [RICH_RFONTS, RICH_SZ];
  if (style.bold) rPr.push('<w:b/><w:bCs/>');
  if (style.italic) rPr.push('<w:i/><w:iCs/>');
  if (style.underline) rPr.push('<w:u w:val="single"/>');
  const props = `<w:rPr>${rPr.join('')}</w:rPr>`;
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r>${props}<w:t${space}>${escapeXml(text)}</w:t></w:r>`;
}

function inlineTokensToRuns(tokens: Token[] | undefined, base: RunStyle = {}): InlineRun[] {
  if (!tokens?.length) return [];
  const out: InlineRun[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          out.push(...inlineTokensToRuns(t.tokens, base));
        } else {
          out.push({ text: t.text, style: { ...base } });
        }
        break;
      }
      case 'strong': {
        const t = token as Tokens.Strong;
        out.push(...inlineTokensToRuns(t.tokens, { ...base, bold: true }));
        break;
      }
      case 'em': {
        const t = token as Tokens.Em;
        out.push(...inlineTokensToRuns(t.tokens, { ...base, italic: true }));
        break;
      }
      case 'codespan': {
        const t = token as Tokens.Codespan;
        out.push({ text: t.text, style: { ...base } });
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        out.push(...inlineTokensToRuns(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Tokens.Text], base));
        break;
      }
      case 'br':
        out.push({ text: '\n', style: { ...base } });
        break;
      case 'escape': {
        const t = token as Tokens.Escape;
        out.push({ text: t.text, style: { ...base } });
        break;
      }
      default: {
        const any = token as { text?: string; tokens?: Token[] };
        if (any.tokens?.length) out.push(...inlineTokensToRuns(any.tokens, base));
        else if (any.text) out.push({ text: any.text, style: { ...base } });
      }
    }
  }
  return out;
}

function paragraphXml(opts: {
  runs: InlineRun[];
  indentLevel?: number;
  headingLevel?: number;
  /** List indent level (0-based); adds left+hanging indent. */
  listLevel?: number;
}): string {
  const pPrParts: string[] = [];
  const indentLevel = opts.indentLevel ?? 0;
  // Headings stay Arial 12 (bold via runs); do not bump size so minutes stay uniform.
  if (opts.headingLevel) {
    pPrParts.push(`<w:rPr>${RICH_RFONTS}${RICH_SZ}<w:b/><w:bCs/></w:rPr>`);
  }
  if (opts.listLevel != null) {
    const hanging = 360;
    const listLeft = (opts.listLevel + 1) * TWIPS_PER_INDENT;
    pPrParts.push(`<w:ind w:left="${listLeft}" w:hanging="${hanging}"/>`);
  } else if (indentLevel > 0) {
    pPrParts.push(`<w:ind w:left="${indentLevel * TWIPS_PER_INDENT}"/>`);
  }
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';

  const headingStyle = opts.headingLevel ? { bold: true } : {};
  let runs = '';
  for (const r of opts.runs) {
    runs += runXml(r.text, { ...headingStyle, ...r.style });
  }
  if (!runs) {
    runs = '<w:r><w:t></w:t></w:r>';
  }
  return `<w:p>${pPr}${runs}</w:p>`;
}

function listItemToParagraphs(
  item: Tokens.ListItem,
  kind: 'bullet' | 'number',
  level: number,
  index: number,
): string {
  const parts: string[] = [];
  const inline: Token[] = [];
  const nested: Tokens.List[] = [];
  for (const t of item.tokens ?? []) {
    if (t.type === 'list') nested.push(t as Tokens.List);
    else inline.push(t);
  }

  let runs: InlineRun[] = [];
  for (const t of inline) {
    if (t.type === 'paragraph' || t.type === 'text') {
      const p = t as Tokens.Paragraph | Tokens.Text;
      runs.push(
        ...inlineTokensToRuns(
          p.tokens ?? [{ type: 'text', raw: p.text, text: p.text } as Tokens.Text],
        ),
      );
    } else if (t.type === 'space') {
      // skip
    } else {
      const any = t as { tokens?: Token[]; text?: string };
      if (any.tokens) runs.push(...inlineTokensToRuns(any.tokens));
      else if (any.text) runs.push({ text: any.text, style: {} });
    }
  }

  const prefix = kind === 'number' ? `${index + 1}. ` : '• ';
  runs = [{ text: prefix, style: {} }, ...runs];

  parts.push(
    paragraphXml({
      runs,
      listLevel: level,
    }),
  );

  for (const list of nested) {
    parts.push(listToParagraphs(list, level + 1));
  }
  return parts.join('');
}

function listToParagraphs(list: Tokens.List, level = 0): string {
  const kind = list.ordered ? 'number' : 'bullet';
  return (list.items ?? [])
    .map((item, i) => listItemToParagraphs(item, kind, level, i))
    .join('');
}

function blockTokensToOoxml(tokens: Token[], indentLevel = 0): string {
  const parts: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading;
        const level = Math.min(3, Math.max(1, t.depth));
        parts.push(
          paragraphXml({
            runs: inlineTokensToRuns(t.tokens),
            headingLevel: level,
            indentLevel,
          }),
        );
        break;
      }
      case 'paragraph': {
        const t = token as Tokens.Paragraph;
        parts.push(
          paragraphXml({
            runs: inlineTokensToRuns(t.tokens),
            indentLevel,
          }),
        );
        break;
      }
      case 'list': {
        parts.push(listToParagraphs(token as Tokens.List, indentLevel));
        break;
      }
      case 'blockquote': {
        const t = token as Tokens.Blockquote;
        parts.push(blockTokensToOoxml(t.tokens ?? [], indentLevel + 1));
        break;
      }
      case 'space':
        break;
      case 'code': {
        const t = token as Tokens.Code;
        for (const line of t.text.split('\n')) {
          parts.push(
            paragraphXml({
              runs: [{ text: line, style: {} }],
              indentLevel: indentLevel + 1,
            }),
          );
        }
        break;
      }
      case 'hr':
        parts.push(paragraphXml({ runs: [{ text: '─'.repeat(20), style: {} }], indentLevel }));
        break;
      case 'text': {
        const t = token as Tokens.Text;
        parts.push(
          paragraphXml({
            runs: inlineTokensToRuns(t.tokens ?? [{ type: 'text', raw: t.text, text: t.text } as Tokens.Text]),
            indentLevel,
          }),
        );
        break;
      }
      default:
        break;
    }
  }
  return parts.join('');
}

/**
 * Convert Markdown to one or more OOXML paragraphs.
 * Supports: headings (#–###), **bold**, *italic*, lists (nested = indent),
 * blockquotes (indent), paragraphs.
 */
export function markdownToOoxmlParagraphs(markdown: string): string {
  const src = markdown?.toString?.() ?? '';
  if (!src.trim()) {
    return '<w:p><w:r><w:t></w:t></w:r></w:p>';
  }
  const tokens = Lexer.lex(src, { gfm: true, breaks: false });
  const xml = blockTokensToOoxml(tokens);
  return xml || '<w:p><w:r><w:t></w:t></w:r></w:p>';
}
