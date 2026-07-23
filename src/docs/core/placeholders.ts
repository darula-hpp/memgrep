import nunjucks from 'nunjucks';
import {
  extractRichFieldNames,
  findSoleRichPlaceholder,
  markdownToOoxmlParagraphs,
  splitRichSegments,
} from './rich.js';
import { escapeXml } from './xml.js';

const nunjucksEnv = nunjucks.configure({ autoescape: false, throwOnUndefined: false });

export function extractFieldNames(text: string): string[] {
  const fields = new Set<string>();
  const re = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;
  for (const match of text.matchAll(re)) {
    fields.add(match[1]!);
  }
  return [...fields];
}

export function resolvePlaceholder(expression: string, data: Record<string, unknown>): string {
  const rendered = nunjucksEnv.renderString(`{{ ${expression} }}`, data);
  return rendered == null ? '' : String(rendered);
}

export function fillPlaceholdersInText(text: string, data: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_full, expression: string) => {
    return escapeXml(resolvePlaceholder(expression, data));
  });
}

function hasPlaceholders(text: string): boolean {
  return /\{\{\s*[a-zA-Z_][\w.]*\s*\}\}/.test(text);
}

function extractPPr(paragraph: string): string {
  const m = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
  return m?.[0] ?? '';
}

function labelParagraphXml(text: string, pPr: string): string {
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:p>${pPr}<w:r><w:t${space}>${text}</w:t></w:r></w:p>`;
}

function expandMixedRichParagraph(
  joined: string,
  paragraph: string,
  data: Record<string, unknown>,
): string {
  const sole = findSoleRichPlaceholder(joined);
  if (sole) {
    const value = resolvePlaceholder(sole, data);
    return markdownToOoxmlParagraphs(value == null ? '' : String(value));
  }

  const pPr = extractPPr(paragraph);
  const segments = splitRichSegments(joined);
  let out = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      const filled = fillPlaceholdersInText(seg.text, data);
      if (filled === '') continue;
      out += labelParagraphXml(filled, pPr);
      continue;
    }
    const value = resolvePlaceholder(seg.name, data);
    out += markdownToOoxmlParagraphs(value == null ? '' : String(value));
  }
  return out || '<w:p><w:r><w:t></w:t></w:r></w:p>';
}

/**
 * Within each paragraph, coalesce <w:t> run text so split placeholders become
 * contiguous, then optionally fill them. Non-placeholder XML is left intact.
 *
 * `{{ field | rich }}` expands to Markdown→OOXML paragraphs even when labels or
 * other text share the same paragraph. Sole-paragraph rich keeps the previous
 * whole-`<w:p>` replacement behaviour.
 */
export function processParagraphsXml(
  xml: string,
  mode: 'extract' | 'fill',
  data: Record<string, unknown> = {},
): { xml: string; fields: string[]; richFields: string[] } {
  const fields = new Set<string>();
  const richFields = new Set<string>();

  const nextXml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const runs: Array<{ open: string; text: string; close: string }> = [];
    const runRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    let match: RegExpExecArray | null;
    while ((match = runRe.exec(paragraph)) !== null) {
      runs.push({
        open: match[1]!,
        text: match[2]!,
        close: match[3]!,
      });
    }

    if (runs.length === 0) {
      return paragraph;
    }

    const joined = runs.map((r) => r.text).join('');
    for (const name of extractRichFieldNames(joined)) {
      richFields.add(name);
    }
    for (const name of extractFieldNames(joined)) {
      fields.add(name);
    }

    const segments = splitRichSegments(joined);
    const hasRich = segments.some((s) => s.type === 'rich');
    if (hasRich) {
      if (mode === 'extract') {
        return paragraph;
      }
      return expandMixedRichParagraph(joined, paragraph, data);
    }

    if (mode === 'extract' || !hasPlaceholders(joined)) {
      return paragraph;
    }

    const filled = fillPlaceholdersInText(joined, data);

    let replacedIndex = 0;
    return paragraph.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
      const run = runs[replacedIndex++]!;
      if (replacedIndex === 1) {
        const open = ensureXmlSpace(run.open, filled);
        return `${open}${filled}${run.close}`;
      }
      return `${run.open}${run.close}`;
    });
  });

  // Rich fields are never scalars
  for (const f of richFields) {
    fields.delete(f);
  }

  return {
    xml: nextXml,
    fields: [...fields].sort(),
    richFields: [...richFields].sort(),
  };
}

function ensureXmlSpace(openTag: string, text: string): string {
  if (!/^\s|\s$/.test(text)) {
    return openTag;
  }
  if (/\bxml:space=/.test(openTag)) {
    return openTag;
  }
  return openTag.replace(/<w:t\b/, '<w:t xml:space="preserve"');
}

/** Turn flat {"meeting.date": "x"} into { meeting: { date: "x" } } for Nunjucks. */
export function nestDottedKeys(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!key.includes('.')) {
      output[key] = value;
      continue;
    }

    const parts = key.split('.');
    let cursor: Record<string, unknown> = output;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const existing = cursor[part];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]!] = value;
  }

  return output;
}
