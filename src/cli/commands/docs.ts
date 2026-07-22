import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

export function registerDocsCommand(program: Command): void {
  const docs = program
    .command('docs')
    .alias('doc')
    .description('Fill Jinja-style Word templates under .memgrep/templates → .memgrep/docs');

  docs
    .command('setup')
    .description('Create .memgrep/templates and .memgrep/docs in the current directory')
    .action(async () => {
      try {
        const { runDocsSetup } = await import('../../docs/setup.js');
        await runDocsSetup(process.cwd());
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  docs
    .command('status')
    .description('Show templates and filled docs for the current project')
    .action(async () => {
      try {
        const { DocsService } = await import('../../docs/service.js');
        console.log(new DocsService(process.cwd()).formatStatus());
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  docs
    .command('list')
    .description('List .docx templates in .memgrep/templates')
    .action(async () => {
      try {
        const { DocsService } = await import('../../docs/service.js');
        const service = new DocsService(process.cwd());
        const templates = service.listTemplates();
        if (!templates.length) {
          console.log(`No templates in ${service.templatesDir}`);
          return;
        }
        for (const t of templates) console.log(t);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  docs
    .command('fill')
    .description('Fill a template with JSON context into .memgrep/docs')
    .argument('<template>', 'Template filename under .memgrep/templates')
    .option('--context <json>', 'JSON object of field values')
    .option('--context-file <path>', 'Path to JSON context file')
    .option('--name <slug>', 'Output name (default: template basename)')
    .action(
      async (
        template: string,
        opts: { context?: string; contextFile?: string; name?: string },
      ) => {
        try {
          const context = loadContext(opts);
          const { DocsService } = await import('../../docs/service.js');
          const result = await new DocsService(process.cwd()).fill({
            template,
            context,
            name: opts.name,
          });
          console.log(`Filled ${result.name}`);
          console.log(`  docx:    ${result.docxPath}`);
          console.log(`  context: ${result.contextPath}`);
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      },
    );

  docs
    .command('edit')
    .description('Start the local web editor for filled docs')
    .argument('[slug]', 'Optional filled doc name to open')
    .option('--port <n>', 'Port (default 8791)', (v) => Number(v))
    .action(async (slug: string | undefined, opts: { port?: number }) => {
      try {
        const { startDocsEditor } = await import('../../docs/server.js');
        const handle = await startDocsEditor({
          cwd: process.cwd(),
          name: slug,
          port: opts.port,
        });
        console.log(handle.reused ? 'Docs editor already running.' : 'Docs editor started.');
        console.log(`  url: ${handle.url}`);
        if (!handle.reused) {
          console.log('Press Ctrl+C to stop.');
          await new Promise(() => undefined);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
}

function loadContext(opts: { context?: string; contextFile?: string }): Record<string, unknown> {
  let raw: string | undefined;
  if (opts.contextFile) {
    raw = readFileSync(opts.contextFile, 'utf8');
  } else if (opts.context) {
    raw = opts.context;
  } else {
    throw new Error('Provide --context \'{...}\' or --context-file <path>');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Context must be valid JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Context must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
