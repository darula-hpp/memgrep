import nunjucks from 'nunjucks';
import {
  extractRichFieldNames,
  findSoleRichPlaceholder,
  markdownToOoxmlParagraphs,
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

/**
 * Within each paragraph, coalesce <w:t> run text so split placeholders become
 * contiguous, then optionally fill them. Non-placeholder XML is left intact.
 *
 * `{{ field | rich }}` alone in a paragraph is replaced with Markdown→OOXML
 * paragraphs (bold/italic/headings/lists/indent).
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

    const richName = findSoleRichPlaceholder(joined);
    if (richName) {
      if (mode === 'extract') {
        return paragraph;
      }
      const value = resolvePlaceholder(richName, data);
      return markdownToOoxmlParagraphs(value == null ? '' : String(value));
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
