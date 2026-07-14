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
    expect(hostnameFromUrlOrHost('https://example.ngrok-free.app/mcp')).toBe(
      'example.ngrok-free.app',
    );
    expect(hostnameFromUrlOrHost('example.ngrok-free.app')).toBe('example.ngrok-free.app');
  });
});

describe('resolveAllowedHosts', () => {
  it('includes loopback and public url file', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'memgrep-hosts-'));
    dirs.push(home);
    writeFileSync(
      path.join(home, 'mcp-public-url'),
      'https://example.ngrok-free.app/mcp\n',
    );
    const hosts = resolveAllowedHosts({}, home);
    expect(hosts).toEqual(
      expect.arrayContaining(['127.0.0.1', 'localhost', 'example.ngrok-free.app']),
    );
  });

  it('merges env lists', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'memgrep-hosts-'));
    dirs.push(home);
    const hosts = resolveAllowedHosts(
      {
        MEMGREP_ALLOWED_HOSTS: 'a.example.com, b.example.com',
        MEMGREP_NGROK_DOMAIN: 'c.ngrok-free.app',
      },
      home,
      ['extra.test'],
    );
    expect(hosts).toEqual(
      expect.arrayContaining(['a.example.com', 'b.example.com', 'c.ngrok-free.app', 'extra.test']),
    );
  });
});
