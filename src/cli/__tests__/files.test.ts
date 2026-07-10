import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEXT_EXTENSIONS, walkFiles } from '../lib/files.js';

describe('walkFiles', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('yields text files and skips node_modules / binary-ish extensions', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'memgrep-walk-'));
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'console.log(1)');
    await writeFile(path.join(root, 'readme.md'), '# hi');
    await writeFile(path.join(root, 'photo.png'), 'not-text');
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'export {}');

    const found: string[] = [];
    for await (const file of walkFiles(root)) {
      found.push(path.relative(root, file));
    }
    found.sort();

    expect(found).toEqual(['readme.md', path.join('src', 'a.ts')]);
    expect(TEXT_EXTENSIONS.has('.ts')).toBe(true);
    expect(TEXT_EXTENSIONS.has('.png')).toBe(false);
  });

  it('yields a single file root', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'memgrep-walk-file-'));
    const file = path.join(root, 'note.txt');
    await writeFile(file, 'hello');

    const found: string[] = [];
    for await (const f of walkFiles(file)) {
      found.push(f);
    }
    expect(found).toEqual([file]);
  });
});
