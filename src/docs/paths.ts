import path from 'node:path';

export const PROJECT_MEMGREP_DIR = '.memgrep';
export const TEMPLATES_DIRNAME = 'templates';
export const DOCS_DIRNAME = 'docs';
export const EDITOR_LOCK_FILE = '.editor.json';

export function projectMemgrepDir(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_MEMGREP_DIR);
}

export function projectTemplatesDir(cwd = process.cwd()): string {
  return path.join(projectMemgrepDir(cwd), TEMPLATES_DIRNAME);
}

export function projectDocsDir(cwd = process.cwd()): string {
  return path.join(projectMemgrepDir(cwd), DOCS_DIRNAME);
}

export function editorLockPath(cwd = process.cwd()): string {
  return path.join(projectDocsDir(cwd), EDITOR_LOCK_FILE);
}
