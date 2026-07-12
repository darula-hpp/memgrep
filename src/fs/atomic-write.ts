import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Write JSON (or any text) atomically via tmp + rename. Mode defaults to 0o600. */
export function writeFileAtomic(
  filePath: string,
  contents: string,
  options: { mode?: number } = {},
): void {
  const mode = options.mode ?? 0o600;
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents, { mode });
  renameSync(tmp, filePath);
}
