import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { extractFields, fillDocument, type IterableSchema } from './core/index.js';
import { editorLockPath, projectDocsDir, projectTemplatesDir } from './paths.js';
import { ensureDocsDirs } from './setup.js';

export type DocContextFile = {
  version: 1;
  template: string;
  context: Record<string, unknown>;
  fields: string[];
  richFields?: string[];
  iterables?: IterableSchema[];
  updatedAt: string;
  createdAt: string;
};

export type FilledDocInfo = {
  name: string;
  docxPath: string;
  contextPath: string;
  template: string;
  updatedAt: string;
};

export type EditorLock = {
  pid: number;
  port: number;
  host: string;
  url: string;
  cwd: string;
  startedAt: string;
};

export class DocsService {
  constructor(readonly cwd: string = process.cwd()) {}

  get templatesDir(): string {
    return projectTemplatesDir(this.cwd);
  }

  get docsDir(): string {
    return projectDocsDir(this.cwd);
  }

  setup(): { templatesDir: string; docsDir: string } {
    return ensureDocsDirs(this.cwd);
  }

  listTemplates(): string[] {
    const dir = this.templatesDir;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.docx') && !name.startsWith('.'))
      .sort();
  }

  resolveTemplatePath(template: string): string {
    const base = path.basename(template);
    if (base !== template || base.includes('..')) {
      throw new Error(`Invalid template name: ${template}`);
    }
    if (!base.toLowerCase().endsWith('.docx')) {
      throw new Error(`Template must be a .docx file: ${template}`);
    }
    const full = path.join(this.templatesDir, base);
    if (!existsSync(full)) {
      throw new Error(`Template not found: ${base} (looked in ${this.templatesDir})`);
    }
    return full;
  }

  async extract(
    template: string,
  ): Promise<{ fields: string[]; richFields: string[]; iterables: IterableSchema[] }> {
    const buf = readFileSync(this.resolveTemplatePath(template));
    return extractFields(buf);
  }

  listDocs(): FilledDocInfo[] {
    const dir = this.docsDir;
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.docx') && !name.startsWith('.'))
      .map((name) => name.replace(/\.docx$/i, ''))
      .sort();

    const out: FilledDocInfo[] = [];
    for (const name of names) {
      const meta = this.readContext(name);
      out.push({
        name,
        docxPath: this.docxPath(name),
        contextPath: this.contextPath(name),
        template: meta?.template ?? '(unknown)',
        updatedAt: meta?.updatedAt ?? '',
      });
    }
    return out;
  }

  async fill(input: {
    template: string;
    context: Record<string, unknown>;
    name?: string;
  }): Promise<FilledDocInfo> {
    ensureDocsDirs(this.cwd);
    const templatePath = this.resolveTemplatePath(input.template);
    const templateName = path.basename(templatePath);
    const slug = sanitizeSlug(input.name ?? templateName.replace(/\.docx$/i, ''));
    const schema = await this.extract(templateName);
    const templateBuf = readFileSync(templatePath);
    const filled = await fillDocument(templateBuf, input.context);

    const docxPath = this.docxPath(slug);
    const contextPath = this.contextPath(slug);
    const now = new Date().toISOString();
    const existing = this.readContext(slug);
    const meta: DocContextFile = {
      version: 1,
      template: templateName,
      context: input.context,
      fields: schema.fields,
      richFields: schema.richFields,
      iterables: schema.iterables,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    writeFileSync(docxPath, filled);
    writeFileAtomic(contextPath, JSON.stringify(meta, null, 2) + '\n', { mode: 0o644 });

    return {
      name: slug,
      docxPath,
      contextPath,
      template: templateName,
      updatedAt: now,
    };
  }

  async getDoc(name: string): Promise<{
    name: string;
    meta: DocContextFile;
    fields: string[];
    richFields: string[];
    iterables: IterableSchema[];
  }> {
    const slug = sanitizeSlug(name);
    const meta = this.readContext(slug);
    if (!meta) {
      throw new Error(`No context found for doc "${slug}" (expected ${this.contextPath(slug)})`);
    }
    if (!existsSync(this.docxPath(slug))) {
      throw new Error(`Docx missing for "${slug}"`);
    }
    // Prefer live schema from template so GUI picks up new iterables after template edits.
    let fields = meta.fields ?? [];
    let richFields = meta.richFields ?? [];
    let iterables = meta.iterables ?? [];
    try {
      const schema = await this.extract(meta.template);
      fields = schema.fields;
      richFields = schema.richFields;
      iterables = schema.iterables;
    } catch {
      // keep sidecar schema
    }
    return { name: slug, meta, fields, richFields, iterables };
  }

  async saveDoc(name: string, context: Record<string, unknown>): Promise<FilledDocInfo> {
    const slug = sanitizeSlug(name);
    const meta = this.readContext(slug);
    if (!meta) {
      throw new Error(`No context found for doc "${slug}"`);
    }
    return this.fill({
      template: meta.template,
      context,
      name: slug,
    });
  }

  readEditorLock(): EditorLock | null {
    const lockFile = editorLockPath(this.cwd);
    if (!existsSync(lockFile)) return null;
    try {
      const parsed = JSON.parse(readFileSync(lockFile, 'utf8')) as EditorLock;
      if (!parsed?.port || !parsed?.pid) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  writeEditorLock(lock: EditorLock): void {
    ensureDocsDirs(this.cwd);
    writeFileAtomic(editorLockPath(this.cwd), JSON.stringify(lock, null, 2) + '\n', {
      mode: 0o644,
    });
  }

  clearEditorLock(): void {
    const lockFile = editorLockPath(this.cwd);
    if (existsSync(lockFile)) {
      try {
        unlinkSync(lockFile);
      } catch {
        // ignore
      }
    }
  }

  formatStatus(): string {
    ensureDocsDirs(this.cwd);
    const templates = this.listTemplates();
    const docs = this.listDocs();
    const lines = [
      'Docs: project-local',
      `  templates: ${this.templatesDir} (${templates.length} .docx)`,
      `  docs:      ${this.docsDir} (${docs.length} filled)`,
    ];
    if (templates.length) {
      lines.push('  templates:');
      for (const t of templates) lines.push(`    - ${t}`);
    }
    if (docs.length) {
      lines.push('  filled:');
      for (const d of docs) lines.push(`    - ${d.name} ← ${d.template}`);
    }
    return lines.join('\n');
  }

  private docxPath(slug: string): string {
    return path.join(this.docsDir, `${slug}.docx`);
  }

  private contextPath(slug: string): string {
    return path.join(this.docsDir, `${slug}.context.json`);
  }

  private readContext(slug: string): DocContextFile | null {
    const p = this.contextPath(slug);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as DocContextFile;
    } catch {
      return null;
    }
  }
}

export function sanitizeSlug(raw: string): string {
  const base = path.basename(raw).replace(/\.docx$/i, '').trim();
  const cleaned = base.replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, '-');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`Invalid document name: ${raw}`);
  }
  return cleaned;
}
