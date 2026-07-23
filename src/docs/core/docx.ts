import JSZip from 'jszip';
import {
  extractLoopSchema,
  mergeIterableSchema,
  processBlockLoops,
  processTableLoops,
  type IterableSchema,
} from './loops.js';
import { nestDottedKeys } from './placeholders.js';

const WORD_XML_PATH =
  /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml)$/;

export type ExtractResult = {
  fields: string[];
  richFields: string[];
  iterables: IterableSchema[];
};

async function loadZip(docx: Buffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(docx);
}

function listWordXmlPaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((p) => !zip.files[p]!.dir && WORD_XML_PATH.test(p))
    .sort();
}

export async function extractFields(docx: Buffer | Uint8Array): Promise<ExtractResult> {
  const zip = await loadZip(docx);
  const fields = new Set<string>();
  const richFields = new Set<string>();
  const iterables = new Map<string, IterableSchema>();

  for (const xmlPath of listWordXmlPaths(zip)) {
    const xml = await zip.file(xmlPath)!.async('string');
    const schema = extractLoopSchema(xml);
    for (const f of schema.fields) fields.add(f);
    for (const f of schema.richFields) richFields.add(f);
    for (const it of schema.iterables) {
      const existing = iterables.get(it.name);
      iterables.set(it.name, existing ? mergeIterableSchema(existing, it) : mergeIterableSchema(it, {
        name: it.name,
        itemVar: it.itemVar,
        fields: [],
      }));
    }
  }

  // Prefer rich over scalar if both somehow appear
  for (const f of richFields) fields.delete(f);

  return {
    fields: [...fields].sort(),
    richFields: [...richFields].sort(),
    iterables: [...iterables.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fillDocument(
  docx: Buffer | Uint8Array,
  data: Record<string, unknown>,
): Promise<Buffer> {
  const zip = await loadZip(docx);
  const nested = nestDottedKeys(data);

  for (const xmlPath of listWordXmlPaths(zip)) {
    const xml = await zip.file(xmlPath)!.async('string');
    // 1) Expand block/table loops (each clone gets scoped row-loop fill).
    // 2) Expand any remaining top-level row loops + scalar / | rich fills.
    const blocked = processBlockLoops(xml, 'fill', nested);
    const looped = processTableLoops(blocked.xml, 'fill', nested);
    zip.file(xmlPath, looped.xml);
  }

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return Buffer.from(output);
}

export type { IterableSchema };
