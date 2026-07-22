import JSZip from 'jszip';
import { nestDottedKeys, processParagraphsXml } from './placeholders.js';

const WORD_XML_PATH =
  /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml)$/;

export type ExtractResult = {
  fields: string[];
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

  for (const xmlPath of listWordXmlPaths(zip)) {
    const xml = await zip.file(xmlPath)!.async('string');
    const result = processParagraphsXml(xml, 'extract');
    for (const field of result.fields) {
      fields.add(field);
    }
  }

  return { fields: [...fields].sort() };
}

export async function fillDocument(
  docx: Buffer | Uint8Array,
  data: Record<string, unknown>,
): Promise<Buffer> {
  const zip = await loadZip(docx);
  const nested = nestDottedKeys(data);

  for (const xmlPath of listWordXmlPaths(zip)) {
    const xml = await zip.file(xmlPath)!.async('string');
    const result = processParagraphsXml(xml, 'fill', nested);
    zip.file(xmlPath, result.xml);
  }

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return Buffer.from(output);
}
