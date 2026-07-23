import type { ToolResult } from '../memory/tools.js';
import { startDocsEditor } from './server.js';
import { DocsService } from './service.js';

/**
 * MCP/CLI-facing docs tools — project-local Word template fill + editor.
 */
export class DocsTools {
  constructor(private readonly service: DocsService) {}

  setup(): ToolResult {
    try {
      const dirs = this.service.setup();
      return {
        text: `Docs dirs ready:\n  templates: ${dirs.templatesDir}\n  docs: ${dirs.docsDir}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  listTemplates(): ToolResult {
    try {
      const templates = this.service.listTemplates();
      if (!templates.length) {
        return {
          text: `No templates in ${this.service.templatesDir}\nDrop .docx files with {{ placeholders }} there.`,
        };
      }
      return { text: templates.map((t) => `- ${t}`).join('\n') };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async extract(input: { template: string }): Promise<ToolResult> {
    try {
      const schema = await this.service.extract(input.template);
      const lines: string[] = [];
      if (schema.fields.length) {
        lines.push('Fields:');
        for (const f of schema.fields) lines.push(`  - ${f}`);
      }
      if (schema.richFields.length) {
        lines.push('Rich fields (Markdown → Word):');
        for (const f of schema.richFields) lines.push(`  - {{ ${f} | rich }}`);
      }
      if (schema.iterables.length) {
        lines.push('Iterables:');
        const walk = (it: (typeof schema.iterables)[number], indent: string) => {
          const kind = it.kind === 'block' ? 'block' : 'rows';
          const fields = it.fields.length ? it.fields.join(', ') : '(no item fields)';
          const rich =
            it.richFields?.length ? `; rich: ${it.richFields.join(', ')}` : '';
          lines.push(`${indent}- [${kind}] ${it.name} as ${it.itemVar} → ${fields}${rich}`);
          for (const nested of it.iterables ?? []) {
            walk(nested, `${indent}  `);
          }
        };
        for (const it of schema.iterables) walk(it, '  ');
      }
      if (!lines.length) {
        return {
          text: `No {{ placeholders }}, {{ x | rich }}, or {% for %} loops found in ${input.template}`,
        };
      }
      return { text: lines.join('\n') };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async fill(input: {
    template: string;
    context: Record<string, unknown>;
    name?: string;
  }): Promise<ToolResult> {
    try {
      const result = await this.service.fill(input);
      return {
        text: [
          `Filled ${result.name}`,
          `  template: ${result.template}`,
          `  docx:     ${result.docxPath}`,
          `  context:  ${result.contextPath}`,
        ].join('\n'),
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  list(): ToolResult {
    try {
      const docs = this.service.listDocs();
      if (!docs.length) {
        return { text: `No filled docs in ${this.service.docsDir}` };
      }
      return {
        text: docs
          .map((d) => `- ${d.name} ← ${d.template}${d.updatedAt ? ` (${d.updatedAt})` : ''}`)
          .join('\n'),
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async serve(input: { name?: string; port?: number } = {}): Promise<ToolResult> {
    try {
      const handle = await startDocsEditor({
        cwd: this.service.cwd,
        name: input.name,
        port: input.port,
      });
      return {
        text: [
          handle.reused ? 'Docs editor already running.' : 'Docs editor started.',
          `  url: ${handle.url}`,
          `  bind: ${handle.host}:${handle.port}`,
        ].join('\n'),
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

export function openDocsTools(cwd = process.cwd()): DocsTools {
  return new DocsTools(new DocsService(cwd));
}
