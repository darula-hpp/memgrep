import { describe, expect, it } from 'vitest';
import { createProgram } from '../program.js';

describe('createProgram', () => {
  it('registers all public commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'copy',
      'delete',
      'index',
      'ingest',
      'list',
      'recall',
      'remember',
      'scan',
      'search',
      'serve',
      'show',
    ]);
  });

  it('exposes expected ingest options', () => {
    const program = createProgram();
    const ingest = program.commands.find((c) => c.name() === 'ingest');
    expect(ingest).toBeDefined();
    const optionFlags = ingest!.options.map((o) => o.flags).sort();
    expect(optionFlags).toEqual(
      expect.arrayContaining([
        '--source <list>',
        '--pick [indices]',
        '--last [n]',
        '--title <title>',
        '--project <name>',
      ]),
    );
  });

  it('exposes expected delete options', () => {
    const program = createProgram();
    const del = program.commands.find((c) => c.name() === 'delete');
    expect(del).toBeDefined();
    const optionFlags = del!.options.map((o) => o.flags);
    expect(optionFlags).toEqual(expect.arrayContaining(['--all', '--yes']));
  });

  it('prints help for --help without throwing', async () => {
    const program = createProgram();
    program.exitOverride();
    let help = '';
    program.configureOutput({
      writeOut: (str) => {
        help += str;
      },
      writeErr: (str) => {
        help += str;
      },
    });

    await expect(program.parseAsync(['node', 'memgrep', '--help'])).rejects.toThrow();
    expect(help).toContain('Usage: memgrep');
    expect(help).toContain('recall');
    expect(help).toContain('ingest');
  });
});
