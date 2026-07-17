import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hostnameFromUrlOrHost, resolveAllowedHosts } from '../mcp.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('hostnameFromUrlOrHost', () => {
  it('parses urls and bare hosts', () => {
    expect(hostnameFromUrlOrHost('https://example.tunnel.test/mcp')).toBe('example.tunnel.test');
    expect(hostnameFromUrlOrHost('example.tunnel.test')).toBe('example.tunnel.test');
  });
});

describe('resolveAllowedHosts', () => {
  it('includes loopback and public url file', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'memgrep-hosts-'));
    dirs.push(home);
    writeFileSync(path.join(home, 'mcp-public-url'), 'https://example.tunnel.test/mcp\n');
    const hosts = resolveAllowedHosts({}, home);
    expect(hosts).toEqual(
      expect.arrayContaining(['127.0.0.1', 'localhost', 'example.tunnel.test']),
    );
  });

  it('merges MEMGREP_PUBLIC_URL / PUBLIC_HOST / ALLOWED_HOSTS', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'memgrep-hosts-'));
    dirs.push(home);
    const hosts = resolveAllowedHosts(
      {
        MEMGREP_ALLOWED_HOSTS: 'a.example.com, b.example.com',
        MEMGREP_PUBLIC_URL: 'https://pub.example.com/mcp',
        MEMGREP_PUBLIC_HOST: 'host.example.com',
      },
      home,
      ['extra.test'],
    );
    expect(hosts).toEqual(
      expect.arrayContaining([
        'a.example.com',
        'b.example.com',
        'pub.example.com',
        'host.example.com',
        'extra.test',
      ]),
    );
  });

  it('still accepts MEMGREP_NGROK_DOMAIN as compat alias', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'memgrep-hosts-'));
    dirs.push(home);
    const hosts = resolveAllowedHosts({ MEMGREP_NGROK_DOMAIN: 'legacy.example.com' }, home);
    expect(hosts).toEqual(expect.arrayContaining(['legacy.example.com']));
  });
});
