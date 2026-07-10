import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_INDEX_DIR = '.memgrep';
export const MAX_FILE_BYTES = 1024 * 1024;

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  DEFAULT_INDEX_DIR,
]);

export const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.lua',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env.example',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.sh',
  '.graphql',
  '.proto',
]);

export async function* walkFiles(root: string): AsyncGenerator<string> {
  const info = await stat(root);
  if (info.isFile()) {
    yield root;
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}
