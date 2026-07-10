import pc from 'picocolors';

export function formatWhen(iso: string | undefined): string {
  return (iso ?? '').slice(0, 16).replace('T', ' ');
}

export function formatScanMark(status: 'ingested' | 'changed' | 'new'): string {
  if (status === 'ingested') return ' ';
  if (status === 'changed') return pc.yellow('~');
  return pc.green('*');
}

export function formatScanLine(
  index: number,
  mark: string,
  title: string,
  sourceName: string,
  project: string,
  when: string,
): string {
  return `${String(index).padStart(2)}. ${mark} ${title.slice(0, 66).padEnd(66)}  (${sourceName}/${project}, ${when})`;
}

export function formatListLine(chat: {
  id: number;
  title: string;
  tool: string;
  project: string;
  createdAt: string;
  chars: number;
}): string {
  return `[${chat.id}] ${chat.title}  (${chat.tool}/${chat.project}, ${chat.createdAt.slice(0, 10)}, ${chat.chars} chars)`;
}

export function formatRecallHit(
  hit: {
    id: number;
    title: string;
    tool: string;
    project: string;
    createdAt: string;
    score: number;
    snippet: string;
  },
  top: boolean,
): { header: string; snippet: string } {
  const id = top ? pc.bold(pc.green(`[${hit.id}]`)) : pc.cyan(`[${hit.id}]`);
  const title = top ? pc.bold(hit.title) : hit.title;
  const meta = pc.dim(
    `(${hit.tool}/${hit.project}, ${hit.createdAt.slice(0, 10)}, score ${hit.score.toFixed(3)})`,
  );
  return {
    header: `${id} ${title}  ${meta}`,
    snippet: pc.dim(`  ${hit.snippet.replace(/\s+/g, ' ').slice(0, 200)}`),
  };
}

export function formatRecallFooter(): string {
  return pc.dim(
    `\nCopy the ${pc.green('top hit')} with: memgrep copy  (or memgrep copy <id> for another)`,
  );
}

export function parseSourceList(source: string | undefined): string[] | undefined {
  return source ? source.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

export function parsePickIndices(raw: string, maxExclusive: number): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < maxExclusive);
}
