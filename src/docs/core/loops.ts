import { extractFieldNames, processParagraphsXml } from './placeholders.js';

export type IterableSchema = {
  /** Collection path in context, e.g. attendees or meeting.attendees */
  name: string;
  /** Loop variable, e.g. item */
  itemVar: string;
  /** Fields referenced as item.field (without the item. prefix) */
  fields: string[];
  /** `| rich` fields on the item (without the item. prefix) */
  richFields?: string[];
  /** Nested iterables (e.g. steps under test_cases) */
  iterables?: IterableSchema[];
  /** Row loop inside a table vs whole-table/block loop */
  kind?: 'rows' | 'block';
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
  const bare = new RegExp(`\\{\\{\\s*${itemVar}\\s*\\}\\}`);
  if (bare.test(text)) {
    fields.add('_value');
  }
  return [...fields].sort();
}

function itemRichFieldsFromText(text: string, itemVar: string): string[] {
  const fields = new Set<string>();
  const re = new RegExp(
    `\\{\\{\\s*${itemVar}\\.([a-zA-Z_][\\w.]*)\\s*\\|\\s*rich\\s*\\}\\}`,
    'g',
  );
  for (const match of text.matchAll(re)) {
    fields.add(match[1]!);
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
  const next = rowXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
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

function isLocalNameAt(xml: string, index: number, localName: string): boolean {
  const tag = `<${localName}`;
  if (!xml.startsWith(tag, index)) return false;
  const next = xml[index + tag.length];
  return next === '>' || next === '/' || next === ' ' || next === '\t' || next === '\n' || next === '\r';
}

/** End index (exclusive) of the element starting at `start`. */
function findElementEnd(xml: string, start: number, localName: string): number {
  let i = start;
  let depth = 0;
  while (i < xml.length) {
    if (xml.startsWith(`</${localName}>`, i)) {
      depth -= 1;
      i += localName.length + 3;
      if (depth === 0) return i;
      continue;
    }
    if (isLocalNameAt(xml, i, localName)) {
      const gt = xml.indexOf('>', i);
      if (gt < 0) return xml.length;
      const selfClosing = xml[gt - 1] === '/';
      if (selfClosing) {
        if (depth === 0) return gt + 1;
        i = gt + 1;
        continue;
      }
      depth += 1;
      i = gt + 1;
      continue;
    }
    i += 1;
  }
  return xml.length;
}

type BodyChild = {
  tag: 'p' | 'tbl';
  full: string;
  start: number;
  end: number;
};

/** Top-level `w:p` / `w:tbl` children of `w:body` (skips `w:sectPr`). */
function listBodyChildren(xml: string): BodyChild[] {
  const open = xml.match(/<w:body\b[^>]*>/);
  if (!open || open.index == null) return [];
  const start = open.index + open[0].length;
  const close = xml.indexOf('</w:body>', start);
  if (close < 0) return [];

  const children: BodyChild[] = [];
  let i = start;
  while (i < close) {
    while (i < close && /\s/.test(xml[i]!)) i += 1;
    if (i >= close) break;

    if (isLocalNameAt(xml, i, 'w:sectPr')) break;

    if (isLocalNameAt(xml, i, 'w:tbl')) {
      const end = findElementEnd(xml, i, 'w:tbl');
      children.push({ tag: 'tbl', full: xml.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (isLocalNameAt(xml, i, 'w:p')) {
      const end = findElementEnd(xml, i, 'w:p');
      children.push({ tag: 'p', full: xml.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    // Skip unknown top-level node
    const gt = xml.indexOf('>', i);
    if (gt < 0) break;
    const rawName = xml.slice(i + 1, gt).split(/[\s/]/)[0]!;
    if (!rawName || xml[gt - 1] === '/') {
      i = gt + 1;
      continue;
    }
    i = findElementEnd(xml, i, rawName);
  }
  return children;
}

type BlockRange = {
  startChild: number;
  endChild: number;
  itemVar: string;
  collection: string;
  forStart: number;
  endforEnd: number;
  bodyStart: number;
  bodyEnd: number;
};

function findBlockRanges(children: BodyChild[]): BlockRange[] {
  const ranges: BlockRange[] = [];
  let open: { startChild: number; itemVar: string; collection: string } | null = null;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.tag !== 'p') continue;
    const text = joinRunText(child.full);
    const forInfo = parseFor(text);
    const hasEnd = ENDFOR_RE.test(text);
    ENDFOR_RE.lastIndex = 0;

    // Same-paragraph for+endfor cannot wrap a table → not a block loop
    if (forInfo && hasEnd) continue;

    if (forInfo) {
      open = { startChild: i, itemVar: forInfo.itemVar, collection: forInfo.collection };
      continue;
    }
    if (hasEnd && open) {
      const interior = children.slice(open.startChild + 1, i);
      const tableCount = interior.filter((c) => c.tag === 'tbl').length;
      if (tableCount >= 1) {
        const forChild = children[open.startChild]!;
        const endChild = child;
        const bodyStart = forChild.end;
        const bodyEnd = endChild.start;
        ranges.push({
          startChild: open.startChild,
          endChild: i,
          itemVar: open.itemVar,
          collection: open.collection,
          forStart: forChild.start,
          endforEnd: endChild.end,
          bodyStart,
          bodyEnd,
        });
      }
      open = null;
    }
  }
  return ranges;
}

function nestRowIterable(row: IterableSchema, outerItemVar: string): IterableSchema | null {
  const prefix = `${outerItemVar}.`;
  if (!row.name.startsWith(prefix)) return null;
  return {
    ...row,
    name: row.name.slice(prefix.length),
    kind: row.kind ?? 'rows',
    fields: [...row.fields],
    richFields: row.richFields ? [...row.richFields] : undefined,
    iterables: row.iterables?.map((n) => ({ ...n, fields: [...n.fields] })),
  };
}

function schemaFromBlockBody(
  bodyXml: string,
  itemVar: string,
  collection: string,
): IterableSchema {
  const bodyText = joinRunText(bodyXml);
  const richFields = itemRichFieldsFromText(bodyText, itemVar);
  const richSet = new Set(richFields);
  const fields = itemFieldsFromText(bodyText, itemVar).filter((f) => !richSet.has(f));

  const rowed = processTableLoops(bodyXml, 'extract');
  const nested: IterableSchema[] = [];
  for (const row of rowed.iterables) {
    const nestedIt = nestRowIterable(row, itemVar);
    if (nestedIt) nested.push(nestedIt);
  }
  nested.sort((a, b) => a.name.localeCompare(b.name));

  const nestedNames = new Set(nested.map((n) => n.name));
  const filteredFields = fields
    .filter((f) => {
      if (nestedNames.has(f)) return false;
      const root = f.split('.')[0]!;
      if (nestedNames.has(root)) return false;
      return true;
    })
    .sort();

  return {
    name: collection,
    itemVar,
    kind: 'block',
    fields: filteredFields,
    richFields: richFields.length ? richFields : undefined,
    iterables: nested.length ? nested : undefined,
  };
}

/**
 * Expand / extract Nunjucks-style block loops that wrap whole tables
 * (marker paragraphs immediately before/after one or more `<w:tbl>`).
 */
export function processBlockLoops(
  xml: string,
  mode: 'extract' | 'fill',
  data: Record<string, unknown> = {},
): { xml: string; iterables: IterableSchema[] } {
  const children = listBodyChildren(xml);
  const ranges = findBlockRanges(children);
  if (ranges.length === 0) {
    return { xml, iterables: [] };
  }

  const iterables = new Map<string, IterableSchema>();
  for (const range of ranges) {
    const bodyXml = xml.slice(range.bodyStart, range.bodyEnd);
    const schema = schemaFromBlockBody(bodyXml, range.itemVar, range.collection);
    const existing = iterables.get(schema.name);
    if (existing) {
      iterables.set(schema.name, mergeIterableSchema(existing, schema));
    } else {
      iterables.set(schema.name, schema);
    }
  }

  if (mode === 'extract') {
    return {
      xml,
      iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // Fill from the end so earlier offsets stay valid.
  const sorted = [...ranges].sort((a, b) => b.forStart - a.forStart);
  let nextXml = xml;
  for (const range of sorted) {
    const bodyXml = nextXml.slice(range.bodyStart, range.bodyEnd);
    const collectionVal = getByPath(data, range.collection);
    const items = Array.isArray(collectionVal) ? collectionVal : [];
    const expanded: string[] = [];
    for (const rawItem of items) {
      const itemIsObj = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem);
      const scoped: Record<string, unknown> = {
        ...data,
        [range.itemVar]: itemIsObj ? rawItem : rawItem,
      };
      const filled = processTableLoops(bodyXml, 'fill', scoped);
      expanded.push(filled.xml);
    }
    nextXml =
      nextXml.slice(0, range.forStart) + expanded.join('') + nextXml.slice(range.endforEnd);
  }

  return {
    xml: nextXml,
    iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function mergeIterableSchema(a: IterableSchema, b: IterableSchema): IterableSchema {
  const fields = new Set([...a.fields, ...b.fields]);
  const richFields = new Set([...(a.richFields ?? []), ...(b.richFields ?? [])]);
  const nested = new Map<string, IterableSchema>();
  for (const it of [...(a.iterables ?? []), ...(b.iterables ?? [])]) {
    const existing = nested.get(it.name);
    nested.set(it.name, existing ? mergeIterableSchema(existing, it) : cloneIterable(it));
  }
  return {
    name: a.name,
    itemVar: a.itemVar || b.itemVar,
    kind: a.kind ?? b.kind,
    fields: [...fields].sort(),
    richFields: richFields.size ? [...richFields].sort() : undefined,
    iterables: nested.size
      ? [...nested.values()].sort((x, y) => x.name.localeCompare(y.name))
      : undefined,
  };
}

function cloneIterable(it: IterableSchema): IterableSchema {
  return {
    name: it.name,
    itemVar: it.itemVar,
    kind: it.kind,
    fields: [...it.fields],
    richFields: it.richFields ? [...it.richFields] : undefined,
    iterables: it.iterables?.map(cloneIterable),
  };
}

function stripIterableRefsFromFields(
  fields: Set<string>,
  richFields: Set<string>,
  iterables: IterableSchema[],
): void {
  for (const it of iterables) {
    fields.delete(it.itemVar);
    richFields.delete(it.itemVar);
    for (const f of it.fields) {
      fields.delete(`${it.itemVar}.${f}`);
      fields.delete(f);
      if (f === '_value') fields.delete(it.itemVar);
    }
    for (const f of it.richFields ?? []) {
      richFields.delete(`${it.itemVar}.${f}`);
      richFields.delete(f);
      fields.delete(`${it.itemVar}.${f}`);
      fields.delete(f);
    }
    for (const f of [...fields]) {
      if (f === it.itemVar || f.startsWith(`${it.itemVar}.`)) fields.delete(f);
    }
    for (const f of [...richFields]) {
      if (f === it.itemVar || f.startsWith(`${it.itemVar}.`)) richFields.delete(f);
    }
    if (it.iterables?.length) {
      stripIterableRefsFromFields(fields, richFields, it.iterables);
    }
  }
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

  const loopRowIndexes = new Set<number>();
  for (const range of ranges) {
    let bodyText = '';
    for (let i = range.start; i <= range.end; i++) {
      loopRowIndexes.add(i);
      bodyText += joinRunText(rows[i]!.full);
    }
    const richFields = itemRichFieldsFromText(bodyText, range.itemVar);
    const richSet = new Set(richFields);
    const fields = itemFieldsFromText(bodyText, range.itemVar).filter((f) => !richSet.has(f));
    const existing = iterables.get(range.collection);
    if (existing) {
      for (const f of fields) {
        if (!existing.fields.includes(f)) existing.fields.push(f);
      }
      existing.fields.sort();
      if (richFields.length) {
        const merged = new Set([...(existing.richFields ?? []), ...richFields]);
        existing.richFields = [...merged].sort();
      }
    } else {
      iterables.set(range.collection, {
        name: range.collection,
        itemVar: range.itemVar,
        kind: 'rows',
        fields,
        richFields: richFields.length ? richFields : undefined,
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    if (loopRowIndexes.has(i)) continue;
    const text = joinRunText(rows[i]!.full);
    for (const f of extractFieldNames(text)) scalarFields.add(f);
  }

  if (mode === 'extract') {
    return {
      xml,
      iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
      scalarFields: [...scalarFields].sort(),
    };
  }

  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let nextXml = xml;

  for (const range of sorted) {
    const startIndex = rows[range.start]!.index;
    const endRow = rows[range.end]!;
    const endIndex = endRow.index + endRow.full.length;

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
      const scoped: Record<string, unknown> = {
        ...data,
        [range.itemVar]: itemIsObj ? rawItem : rawItem,
      };

      let filledBlock = '';
      for (const rowXml of templateRows) {
        filledBlock += fillRowXml(rowXml, scoped);
      }
      expanded.push(filledBlock);
    }

    nextXml = nextXml.slice(0, startIndex) + expanded.join('') + nextXml.slice(endIndex);
  }

  const filled = processParagraphsXml(nextXml, 'fill', data);
  for (const f of filled.fields) {
    if (!f.includes('.')) scalarFields.add(f);
    else {
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
  const blocked = processBlockLoops(xml, 'extract');
  const looped = processTableLoops(xml, 'extract');
  const paras = processParagraphsXml(xml, 'extract');

  const blockItemVars = new Set(blocked.iterables.map((it) => it.itemVar));
  const nestedCollectionNames = new Set<string>();
  for (const block of blocked.iterables) {
    for (const nested of block.iterables ?? []) {
      nestedCollectionNames.add(`${block.itemVar}.${nested.name}`);
    }
  }

  const topRows = looped.iterables.filter((it) => {
    if (nestedCollectionNames.has(it.name)) return false;
    for (const itemVar of blockItemVars) {
      if (it.name === itemVar || it.name.startsWith(`${itemVar}.`)) return false;
    }
    return true;
  });

  const iterables = [...blocked.iterables, ...topRows].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const fields = new Set<string>([...looped.scalarFields, ...paras.fields]);
  const richFields = new Set<string>(paras.richFields);

  stripIterableRefsFromFields(fields, richFields, iterables);

  for (const f of richFields) {
    fields.delete(f);
  }

  return {
    iterables,
    fields: [...fields].sort(),
    richFields: [...richFields].sort(),
  };
}
