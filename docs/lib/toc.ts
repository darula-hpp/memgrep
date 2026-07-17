export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export function extractToc(contentHtml: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const headingRegex = /<h([23])[^>]*\sid="([^"]*)"[^>]*>(.*?)<\/h[23]>/gi;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(contentHtml)) !== null) {
    const level = Number.parseInt(match[1], 10) as 2 | 3;
    const id = match[2];
    const text = match[3].replace(/<[^>]+>/g, '').trim();
    entries.push({ id, text, level });
  }

  if (entries.length < 2) return [];
  return entries;
}
