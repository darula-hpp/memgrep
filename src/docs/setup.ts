import { mkdirSync } from 'node:fs';
import { projectDocsDir, projectTemplatesDir } from './paths.js';

export type DocsSetupResult = {
  templatesDir: string;
  docsDir: string;
};

/** Ensure project-local `.memgrep/templates` and `.memgrep/docs` exist. */
export function ensureDocsDirs(cwd = process.cwd()): DocsSetupResult {
  const templatesDir = projectTemplatesDir(cwd);
  const docsDir = projectDocsDir(cwd);
  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  return { templatesDir, docsDir };
}

export async function runDocsSetup(cwd = process.cwd()): Promise<DocsSetupResult> {
  const result = ensureDocsDirs(cwd);
  console.log('Docs dirs ready:');
  console.log(`  templates: ${result.templatesDir}`);
  console.log(`  docs:      ${result.docsDir}`);
  console.log('Drop .docx templates with {{ placeholders }} into the templates folder.');
  return result;
}
