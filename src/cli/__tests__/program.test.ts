import { describe, expect, it } from 'vitest';
import { createProgram } from '../program.js';

describe('createProgram', () => {
  it('registers all public commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'copy',
      'cursor',
      'delete',
      'gcloud',
      'index',
      'ingest',
      'jira',
      'jobs',
      'list',
      'neon',
      'posthog',
      'producthunt',
      'recall',
      'remember',
      'scan',
      'search',
      'serve',
      'show',
      'telegram',
      'upstash',
    ]);
  });

  it('registers jira subcommands', () => {
    const program = createProgram();
    const jira = program.commands.find((c) => c.name() === 'jira');
    expect(jira).toBeDefined();
    const sub = jira!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers producthunt subcommands', () => {
    const program = createProgram();
    const ph = program.commands.find((c) => c.name() === 'producthunt');
    expect(ph).toBeDefined();
    expect(ph!.aliases()).toContain('ph');
    const sub = ph!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers posthog subcommands', () => {
    const program = createProgram();
    const posthog = program.commands.find((c) => c.name() === 'posthog');
    expect(posthog).toBeDefined();
    const sub = posthog!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers neon subcommands', () => {
    const program = createProgram();
    const neon = program.commands.find((c) => c.name() === 'neon');
    expect(neon).toBeDefined();
    const sub = neon!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers upstash subcommands', () => {
    const program = createProgram();
    const upstash = program.commands.find((c) => c.name() === 'upstash');
    expect(upstash).toBeDefined();
    const sub = upstash!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers gcloud subcommands', () => {
    const program = createProgram();
    const gcloud = program.commands.find((c) => c.name() === 'gcloud');
    expect(gcloud).toBeDefined();
    const sub = gcloud!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers cursor subcommands', () => {
    const program = createProgram();
    const cursor = program.commands.find((c) => c.name() === 'cursor');
    expect(cursor).toBeDefined();
    const sub = cursor!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['setup', 'status']);
  });

  it('registers jobs subcommands', () => {
    const program = createProgram();
    const jobs = program.commands.find((c) => c.name() === 'jobs');
    expect(jobs).toBeDefined();
    const sub = jobs!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual([
      'add',
      'daemon',
      'disable',
      'enable',
      'install',
      'list',
      'logs',
      'remove',
      'run',
      'service',
      'show',
      'uninstall',
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

  it('exposes expected recall options', () => {
    const program = createProgram();
    const recall = program.commands.find((c) => c.name() === 'recall');
    expect(recall).toBeDefined();
    const optionFlags = recall!.options.map((o) => o.flags);
    expect(optionFlags).toEqual(expect.arrayContaining(['-k <n>', '--mode <mode>']));
  });

  it('exposes expected delete options', () => {
    const program = createProgram();
    const del = program.commands.find((c) => c.name() === 'delete');
    expect(del).toBeDefined();
    const optionFlags = del!.options.map((o) => o.flags);
    expect(optionFlags).toEqual(expect.arrayContaining(['--all', '--yes']));
  });

  it('exposes expected serve options', () => {
    const program = createProgram();
    const serve = program.commands.find((c) => c.name() === 'serve');
    expect(serve).toBeDefined();
    const optionFlags = serve!.options.map((o) => o.flags);
    expect(optionFlags).toEqual(
      expect.arrayContaining(['--http', '--host <host>', '--port <n>', '--token <token>']),
    );
  });

  it('registers telegram command with profiles and --no-server', () => {
    const program = createProgram();
    const tg = program.commands.find((c) => c.name() === 'telegram');
    expect(tg).toBeDefined();
    expect(tg!.options.map((o) => o.flags)).toEqual(
      expect.arrayContaining(['-p, --profile <name>', '--all', '--no-server', '--mcp-url <url>']),
    );
    const sub = tg!.commands.map((c) => c.name()).sort();
    expect(sub).toEqual(['install', 'list', 'service', 'setup', 'status', 'uninstall']);
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
