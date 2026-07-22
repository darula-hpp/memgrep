import { Lexer, type Token, type Tokens } from 'marked';
import { escapeXml } from './xml.js';

/** Matches {{ field | rich }} (optional spaces). */
export const RICH_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}/g;

const TWIPS_PER_INDENT = 720; // 0.5" per indent level

export function extractRichFieldNames(text: string): string[] {
  const fields = new Set<string>();
  const re = /\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}/g;
  for (const match of text.matchAll(re)) {
    fields.add(match[1]!);
  }
  return [...fields];
}

export function findSoleRichPlaceholder(text: string): string | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^\{\{\s*([a-zA-Z_][\w.]*)\s*\|\s*rich\s*\}\}$/);
  return m?.[1] ?? null;
}

type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type InlineRun = { text: string; style: RunStyle };

function runXml(text: string, style: RunStyle = {}): string {
  if (!text) return '';
  const rPr: string[] = [];
  if (style.bold) rPr.push('<w:b/><w:bCs/>');
  if (style.italic) rPr.push('<w:i/><w:iCs/>');
  if (style.underline) rPr.push('<w:u w:val="single"/>');
  const props = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
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
  if (opts.headingLevel) {
    const sz = opts.headingLevel === 1 ? 32 : opts.headingLevel === 2 ? 28 : 24;
    pPrParts.push(
      `<w:rPr><w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`,
    );
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
