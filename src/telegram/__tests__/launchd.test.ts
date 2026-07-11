import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  LAUNCHD_LABEL,
  buildLaunchdPlist,
  getLaunchdStatus,
  installLaunchdService,
  launchdPlistPath,
  resolveMemgrepProgramArgs,
  telegramArgsForMode,
  telegramServiceLogPath,
  uninstallLaunchdService,
} from '../launchd.js';

describe('telegramArgsForMode', () => {
  it('builds default / all / profile args', () => {
    expect(telegramArgsForMode({ kind: 'default' })).toEqual(['telegram']);
    expect(telegramArgsForMode({ kind: 'all' })).toEqual(['telegram', '--all']);
    expect(telegramArgsForMode({ kind: 'profile', profile: 'Career' })).toEqual([
      'telegram',
      '--profile',
      'career',
    ]);
  });
});

describe('buildLaunchdPlist', () => {
  it('escapes xml and includes keep-alive + logs', () => {
    const xml = buildLaunchdPlist({
      programArgs: ['/usr/bin/node', '/tmp/cli.js', 'telegram', '--profile', 'a&b'],
      logPath: '/tmp/out.log',
      workingDirectory: '/tmp/home',
      env: { PATH: '/bin', HOME: '/Users/me' },
    });
    expect(xml).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(xml).toContain('<string>/usr/bin/node</string>');
    expect(xml).toContain('<string>a&amp;b</string>');
    expect(xml).toContain('<key>KeepAlive</key>');
    expect(xml).toContain('<true/>');
    expect(xml).toContain('<string>/tmp/out.log</string>');
    expect(xml).toContain('<key>PATH</key>');
    expect(xml).toContain('<string>/Users/me</string>');
  });
});

describe('resolveMemgrepProgramArgs', () => {
  it('uses node + existing .js entry from argv', () => {
    const cli = path.resolve('dist/cli.js');
    if (!existsSync(cli)) return; // skip if not built
    const args = resolveMemgrepProgramArgs(['node', cli], '/opt/homebrew/bin/node');
    expect(args).toEqual(['/opt/homebrew/bin/node', cli]);
  });
});

describe('installLaunchdService (dry-run)', () => {
  it('writes plist under a temp LaunchAgents dir', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'memgrep-launchd-'));
    const agentsDir = path.join(root, 'LaunchAgents');
    const home = path.join(root, 'memgrep-home');
    try {
      const status = installLaunchdService({
        mode: { kind: 'all' },
        agentsDir,
        home,
        programArgs: ['/usr/bin/node', '/tmp/memgrep-cli.js'],
        dryRun: true,
      });
      expect(status.installed).toBe(true);
      expect(status.plistPath).toBe(launchdPlistPath(agentsDir));
      expect(status.logPath).toBe(telegramServiceLogPath(home));
      const xml = await readFile(status.plistPath, 'utf8');
      expect(xml).toContain('telegram');
      expect(xml).toContain('--all');
      expect(xml).toContain('/usr/bin/node');

      const after = uninstallLaunchdService({ agentsDir, home, dryRun: true });
      expect(after.installed).toBe(false);
      expect(existsSync(status.plistPath)).toBe(false);
      expect(getLaunchdStatus({ agentsDir, home, dryRun: true }).installed).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
