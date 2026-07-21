import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INGEST_INTERVAL_MS,
  formatInterval,
  ingestConfigPath,
  parseIntervalMs,
  readIngestConfig,
  resolveIngestDaemonSettings,
  writeIngestConfig,
} from '../config.js';
import { IngestDaemon } from '../daemon.js';
import {
  getIngestLaunchdStatus,
  ingestLaunchdPlistPath,
  ingestServiceLogPath,
  installIngestLaunchdService,
  uninstallIngestLaunchdService,
} from '../launchd.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-ingest-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('parseIntervalMs', () => {
  it('parses units and bare seconds', () => {
    expect(parseIntervalMs('15m')).toBe(15 * 60_000);
    expect(parseIntervalMs('1h')).toBe(3_600_000);
    expect(parseIntervalMs('3600')).toBe(3_600_000);
    expect(parseIntervalMs('90s')).toBe(90_000);
    expect(parseIntervalMs('60000ms')).toBe(60_000);
  });

  it('rejects too-short and invalid values', () => {
    expect(() => parseIntervalMs('30s')).toThrow(/Minimum/);
    expect(() => parseIntervalMs('nope')).toThrow(/Invalid interval/);
    expect(() => parseIntervalMs('')).toThrow(/empty/);
  });
});

describe('formatInterval', () => {
  it('prefers compact units', () => {
    expect(formatInterval(3_600_000)).toBe('1h');
    expect(formatInterval(15 * 60_000)).toBe('15m');
    expect(formatInterval(90_000)).toBe('90s');
  });
});

describe('ingest config', () => {
  it('writes and reads defaults', () => {
    const home = tempHome();
    const cfg = writeIngestConfig({}, home);
    expect(cfg.intervalMs).toBe(DEFAULT_INGEST_INTERVAL_MS);
    expect(cfg.sources).toBeUndefined();
    expect(existsSync(ingestConfigPath(home))).toBe(true);
    expect(readIngestConfig(home)?.intervalMs).toBe(DEFAULT_INGEST_INTERVAL_MS);
  });

  it('persists interval and sources', () => {
    const home = tempHome();
    writeIngestConfig({ intervalMs: parseIntervalMs('15m'), sources: ['cursor'] }, home);
    const cfg = readIngestConfig(home)!;
    expect(cfg.intervalMs).toBe(15 * 60_000);
    expect(cfg.sources).toEqual(['cursor']);
    const raw = JSON.parse(readFileSync(ingestConfigPath(home), 'utf8'));
    expect(raw.version).toBe(1);
  });

  it('resolve prefers CLI overrides', () => {
    const home = tempHome();
    writeIngestConfig({ intervalMs: parseIntervalMs('2h'), sources: ['claude'] }, home);
    const resolved = resolveIngestDaemonSettings({
      home,
      interval: '30m',
      sources: ['cursor', 'kiro'],
    });
    expect(resolved.intervalMs).toBe(30 * 60_000);
    expect(resolved.sources).toEqual(['cursor', 'kiro']);
  });
});

describe('IngestDaemon', () => {
  it('runs ticks on an interval and stops after maxCycles', async () => {
    const home = tempHome();
    writeIngestConfig({ intervalMs: 60_000 }, home);

    const sleep = vi.fn(async () => undefined);
    const daemon = new IngestDaemon({
      home,
      interval: '1m',
      sleep,
      maxCycles: 2,
      sources: ['cursor'],
    });

    const storeMod = await import('../../memory/store.js');
    const open = vi.spyOn(storeMod.MemoryStore, 'open').mockRejectedValue(new Error('no store'));

    await daemon.start();
    expect(sleep).toHaveBeenCalled();
    expect(open.mock.calls.length).toBeGreaterThanOrEqual(1);
    open.mockRestore();
  });
});

describe('installIngestLaunchdService (dry-run)', () => {
  it('writes plist and ingest.json under a temp home', () => {
    const home = tempHome();
    const agentsDir = path.join(home, 'LaunchAgents');
    const status = installIngestLaunchdService({
      home,
      agentsDir,
      programArgs: ['/usr/bin/node', '/tmp/memgrep-cli.js'],
      interval: '15m',
      sources: ['cursor'],
      dryRun: true,
    });
    expect(status.installed).toBe(true);
    expect(status.plistPath).toBe(ingestLaunchdPlistPath(agentsDir));
    expect(status.logPath).toBe(ingestServiceLogPath(home));
    expect(status.intervalMs).toBe(15 * 60_000);
    expect(status.sources).toEqual(['cursor']);
    const xml = readFileSync(status.plistPath, 'utf8');
    expect(xml).toContain('ingest');
    expect(xml).toContain('daemon');
    expect(xml).toContain('/usr/bin/node');

    const after = uninstallIngestLaunchdService({ agentsDir, home, dryRun: true });
    expect(after.installed).toBe(false);
    expect(existsSync(status.plistPath)).toBe(false);
    expect(getIngestLaunchdStatus({ agentsDir, home, dryRun: true }).installed).toBe(false);
  });
});
