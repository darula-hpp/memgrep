import { extractFieldNames, fillPlaceholdersInText, processParagraphsXml } from './placeholders.js';

export type IterableSchema = {
  /** Collection path in context, e.g. attendees or meeting.attendees */
  name: string;
  /** Loop variable, e.g. item */
  itemVar: string;
  /** Fields referenced as item.field (without the item. prefix) */
  fields: string[];
};

const FOR_RE = /\{\%\s*for\s+([a-zA-Z_]\w*)\s+in\s+([a-zA-Z_][\w.]*)\s*\%\}/;
const ENDFOR_RE = /\{\%\s*endfor\s*\%\}/;
const TAG_STRIP_RE = /\{\%\s*for\s+[a-zA-Z_]\w*\s+in\s+[a-zA-Z_][\w.]*\s*\%\}|\{\%\s*endfor\s*\%\}/g;

export function joinRunText(xmlFragment: string): string {
  const parts: string[] = [];
  const runRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(xmlFragment)) !== null) {
    parts.push(match[1]!);
  }
  return parts.join('');
}

/** Rewrite all <w:t> text in a fragment to a single filled string in the first run. */
export function replaceFragmentText(xmlFragment: string, nextText: string): string {
  const runs: Array<{ open: string; close: string }> = [];
  const runRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(xmlFragment)) !== null) {
    runs.push({ open: match[1]!, close: match[3]! });
  }
  if (runs.length === 0) {
    return xmlFragment;
  }

  let i = 0;
  return xmlFragment.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    const run = runs[i++]!;
    if (i === 1) {
      const open = ensureXmlSpace(run.open, nextText);
      return `${open}${nextText}${run.close}`;
    }
    return `${run.open}${run.close}`;
  });
}

function ensureXmlSpace(openTag: string, text: string): string {
  if (!/^\s|\s$/.test(text)) return openTag;
  if (/\bxml:space=/.test(openTag)) return openTag;
  return openTag.replace(/<w:t\b/, '<w:t xml:space="preserve"');
}

function stripLoopTags(text: string): string {
  return text.replace(TAG_STRIP_RE, '');
}

function parseFor(text: string): { itemVar: string; collection: string } | null {
  const m = text.match(FOR_RE);
  if (!m) return null;
  return { itemVar: m[1]!, collection: m[2]! };
}

function itemFieldsFromText(text: string, itemVar: string): string[] {
  const fields = new Set<string>();
  const re = new RegExp(`\\{\\{\\s*${itemVar}\\.([a-zA-Z_][\\w.]*)\\s*\\}\\}`, 'g');
  for (const match of text.matchAll(re)) {
    fields.add(match[1]!);
  }
  // Also allow bare {{ item }} as a single value field "_"
  const bare = new RegExp(`\\{\\{\\s*${itemVar}\\s*\\}\\}`);
  if (bare.test(text)) {
    fields.add('_value');
  }
  return [...fields].sort();
}

type RowMatch = { full: string; index: number };

function listRows(xml: string): RowMatch[] {
  const rows: RowMatch[] = [];
  const re = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    rows.push({ full: match[0], index: match.index });
  }
  return rows;
}

function getByPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = data;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function fillRowXml(rowXml: string, data: Record<string, unknown>): string {
  // First strip loop tags from run text, then fill placeholders via paragraph processor.
  let next = rowXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const joined = joinRunText(paragraph);
    if (!TAG_STRIP_RE.test(joined) && !/\{\{/.test(joined)) {
      TAG_STRIP_RE.lastIndex = 0;
      return paragraph;
    }
    TAG_STRIP_RE.lastIndex = 0;
    const stripped = stripLoopTags(joined);
    return replaceFragmentText(paragraph, stripped);
  });
  return processParagraphsXml(next, 'fill', data).xml;
}

/**
 * Expand / extract Nunjucks-style table row loops:
 *   {% for item in attendees %} … {{ item.name }} … {% endfor %}
 * Markers may live in the same row or span consecutive rows.
 */
export function processTableLoops(
  xml: string,
  mode: 'extract' | 'fill',
  data: Record<string, unknown> = {},
): { xml: string; iterables: IterableSchema[]; scalarFields: string[] } {
  const iterables = new Map<string, IterableSchema>();
  const scalarFields = new Set<string>();
  const rows = listRows(xml);
  if (rows.length === 0) {
    const paras = processParagraphsXml(xml, mode, data);
    for (const f of paras.fields) scalarFields.add(f);
    return { xml: paras.xml, iterables: [], scalarFields: [...scalarFields].sort() };
  }

  type LoopRange = {
    start: number;
    end: number;
    itemVar: string;
    collection: string;
  };
  const ranges: LoopRange[] = [];
  let open: { start: number; itemVar: string; collection: string } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const text = joinRunText(rows[i]!.full);
    const forInfo = parseFor(text);
    const hasEnd = ENDFOR_RE.test(text);
    ENDFOR_RE.lastIndex = 0;

    if (forInfo && hasEnd) {
      ranges.push({
        start: i,
        end: i,
        itemVar: forInfo.itemVar,
        collection: forInfo.collection,
      });
      open = null;
      continue;
    }
    if (forInfo) {
      open = { start: i, itemVar: forInfo.itemVar, collection: forInfo.collection };
      continue;
    }
    if (hasEnd && open) {
      ranges.push({
        start: open.start,
        end: i,
        itemVar: open.itemVar,
        collection: open.collection,
      });
      open = null;
    }
  }

  // Collect schema from loop bodies; collect scalar fields from non-loop rows.
  const loopRowIndexes = new Set<number>();
  for (const range of ranges) {
    let bodyText = '';
    for (let i = range.start; i <= range.end; i++) {
      loopRowIndexes.add(i);
      bodyText += joinRunText(rows[i]!.full);
    }
    const fields = itemFieldsFromText(bodyText, range.itemVar);
    const existing = iterables.get(range.collection);
    if (existing) {
      for (const f of fields) {
        if (!existing.fields.includes(f)) existing.fields.push(f);
      }
      existing.fields.sort();
    } else {
      iterables.set(range.collection, {
        name: range.collection,
        itemVar: range.itemVar,
        fields,
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    if (loopRowIndexes.has(i)) continue;
    const text = joinRunText(rows[i]!.full);
    for (const f of extractFieldNames(text)) scalarFields.add(f);
  }

  if (mode === 'extract') {
    // Also scan non-table paragraphs later via caller; here just return schema + unchanged xml.
    return {
      xml,
      iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
      scalarFields: [...scalarFields].sort(),
    };
  }

  // Fill: rebuild XML replacing each loop range with expanded rows (process from end).
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let nextXml = xml;

  for (const range of sorted) {
    const startIndex = rows[range.start]!.index;
    const endRow = rows[range.end]!;
    const endIndex = endRow.index + endRow.full.length;

    // Single-row loop: clone that row (tags stripped). Multi-row: clone interior rows only
    // (marker rows with {% for %} / {% endfor %} are discarded).
    let templateRows: string[];
    if (range.start === range.end) {
      templateRows = [rows[range.start]!.full];
    } else {
      const interior = rows.slice(range.start + 1, range.end).map((r) => r.full);
      templateRows =
        interior.length > 0
          ? interior
          : rows.slice(range.start, range.end + 1).map((r) => r.full);
    }

    const collectionVal = getByPath(data, range.collection);
    const items = Array.isArray(collectionVal) ? collectionVal : [];

    const expanded: string[] = [];
    for (const rawItem of items) {
      const itemIsObj = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
      const item = itemIsObj
        ? (rawItem as Record<string, unknown>)
        : { _value: rawItem };
      const scoped: Record<string, unknown> = {
        ...data,
        [range.itemVar]: itemIsObj ? item : rawItem,
      };

      let filledBlock = '';
      for (const rowXml of templateRows) {
        filledBlock += fillRowXml(rowXml, scoped);
      }
      expanded.push(filledBlock);
    }

    nextXml = nextXml.slice(0, startIndex) + expanded.join('') + nextXml.slice(endIndex);
  }

  // Re-process from original ranges was against original xml with descending order — good.
  // Now fill remaining scalar placeholders in the expanded document.
  const filled = processParagraphsXml(nextXml, 'fill', data);
  for (const f of filled.fields) {
    // Skip item.* style that leaked; scalars only for reporting
    if (!f.includes('.')) scalarFields.add(f);
    else {
      // keep dotted scalars like meeting.date that aren't loop item fields
      const isItemRef = [...iterables.values()].some(
        (it) => f === it.itemVar || f.startsWith(`${it.itemVar}.`),
      );
      if (!isItemRef) scalarFields.add(f);
    }
  }

  return {
    xml: filled.xml,
    iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    scalarFields: [...scalarFields].sort(),
  };
}

/** Extract iterable + scalar + rich schema from Word XML (document/header/footer). */
export function extractLoopSchema(xml: string): {
  iterables: IterableSchema[];
  fields: string[];
  richFields: string[];
} {
  const looped = processTableLoops(xml, 'extract');
  const paras = processParagraphsXml(xml, 'extract');
  const fields = new Set<string>([...looped.scalarFields, ...paras.fields]);
  const richFields = new Set<string>(paras.richFields);

  // Remove item.field refs that belong to iterables from scalar list
  for (const it of looped.iterables) {
    fields.delete(it.itemVar);
    for (const f of it.fields) {
      fields.delete(`${it.itemVar}.${f}`);
      if (f === '_value') fields.delete(it.itemVar);
    }
  }

  // Filter paragraph fields that are clearly loop item refs
  for (const f of [...fields]) {
    for (const it of looped.iterables) {
      if (f === it.itemVar || f.startsWith(`${it.itemVar}.`)) {
        fields.delete(f);
      }
    }
  }

  // Rich fields are not plain scalars
  for (const f of richFields) {
    fields.delete(f);
  }

  return {
    iterables: looped.iterables,
    fields: [...fields].sort(),
    richFields: [...richFields].sort(),
  };
}
