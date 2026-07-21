import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import {
  ensureEdgeHubToken,
  parseToolsList,
  readEdgeConfig,
  writeEdgeConfig,
} from '../config.js';
import { EdgeHub, setEdgeHub } from '../hub.js';
import { EdgeClient } from '../client.js';
import { isCommandAllowlisted } from '../local-tools.js';
import { contentHash, ingestSyncedChats, markHashesSynced, collectUnsyncedChats } from '../sync.js';
import { hubHttpToWsUrl } from '../protocol.js';
import { EDGE_LAUNCHD_LABEL } from '../launchd.js';
import {
  detectEdgeBackend,
  formatEdgeServiceStatus,
  installEdgeService,
  uninstallEdgeService,
} from '../service.js';
import { defaultRunAllowlist } from '../config.js';
import { MemoryStore } from '../../memory/store.js';

describe('edge protocol helpers', () => {
  it('converts http mcp URL to ws edge URL', () => {
    expect(hubHttpToWsUrl('https://memgrep.example/mcp')).toBe(
      'wss://memgrep.example/edge',
    );
    expect(hubHttpToWsUrl('http://127.0.0.1:3921')).toBe('ws://127.0.0.1:3921/edge');
  });

  it('parses tools list', () => {
    expect(parseToolsList('edge_ping,edge_run')).toEqual(['edge_ping', 'edge_run']);
    expect(parseToolsList('nope')).toEqual([]);
  });

  it('allowlists edge_run argv0', () => {
    expect(isCommandAllowlisted('echo', ['echo', 'uname'])).toBe(true);
    expect(isCommandAllowlisted('/bin/echo', ['echo'])).toBe(true);
    expect(isCommandAllowlisted('rm', ['echo'])).toBe(false);
  });
});

describe('edge config + launchd', () => {
  let home: string;
  let agentsDir: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('pairs and dry-runs platform service install', () => {
    home = mkdtempSync(path.join(tmpdir(), 'memgrep-edge-'));
    agentsDir = path.join(home, 'LaunchAgents');
    const cfg = writeEdgeConfig(
      {
        hubUrl: 'http://127.0.0.1:3921/mcp',
        token: 'test-token',
        tools: ['edge_ping', 'edge_run'],
        syncMemory: true,
      },
      home,
    );
    expect(cfg.hubUrl).toBe('ws://127.0.0.1:3921/edge');
    expect(readEdgeConfig(home)?.deviceId).toBe(cfg.deviceId);
    expect(defaultRunAllowlist('linux')).toContain('uname');
    expect(defaultRunAllowlist('win32')).toContain('cmd.exe');

    const backend = detectEdgeBackend();
    const status = installEdgeService({
      home,
      agentsDir,
      systemdDir: path.join(home, 'systemd'),
      startupDir: path.join(home, 'Startup'),
      programArgs: ['node', 'cli.js'],
      dryRun: true,
    });
    expect(status.backend).toBe(backend);
    expect(status.installed).toBe(true);
    if (backend === 'launchd') {
      expect(status.label).toBe(EDGE_LAUNCHD_LABEL);
      expect(status.programArgs).toEqual(['node', 'cli.js', 'edge', 'daemon']);
    }
    expect(formatEdgeServiceStatus(status).some((l) => l.includes('hub:') || l.startsWith('hub:'))).toBe(
      true,
    );

    const removed = uninstallEdgeService({
      home,
      agentsDir,
      systemdDir: path.join(home, 'systemd'),
      startupDir: path.join(home, 'Startup'),
      dryRun: true,
    });
    expect(removed.installed).toBe(false);
  });

  it('creates hub token once', () => {
    home = mkdtempSync(path.join(tmpdir(), 'memgrep-edge-hub-'));
    const a = ensureEdgeHubToken(home);
    const b = ensureEdgeHubToken(home);
    expect(a.token).toBe(b.token);
    expect(a.token.length).toBeGreaterThan(20);
  });
});

describe('edge hub + client e2e', () => {
  let homeHub: string;
  let homeEdge: string;

  afterEach(async () => {
    setEdgeHub(null);
    if (homeHub) rmSync(homeHub, { recursive: true, force: true });
    if (homeEdge) rmSync(homeEdge, { recursive: true, force: true });
  });

  it('connects, heartbeats presence, proxies edge_ping and syncs memory', async () => {
    homeHub = mkdtempSync(path.join(tmpdir(), 'memgrep-hub-'));
    homeEdge = mkdtempSync(path.join(tmpdir(), 'memgrep-mac-'));

    const hubToken = ensureEdgeHubToken(homeHub).token;
    const store = await MemoryStore.open(homeHub);
    const hub = new EdgeHub({ home: homeHub, store });
    setEdgeHub(hub);

    const httpServer = createServer((req, res) => {
      if (req.url === '/edge/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(hub.getPresence()));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    hub.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const port = addr.port;

    writeEdgeConfig(
      {
        hubUrl: `http://127.0.0.1:${port}/mcp`,
        token: hubToken,
        tools: ['edge_ping', 'edge_run', 'edge_loop_run', 'edge_cursor_run'],
        syncMemory: true,
        runAllowlist: ['echo'],
      },
      homeEdge,
    );

    const edgeStore = await MemoryStore.open(homeEdge);
    await edgeStore.addChat({
      title: 'mac note',
      project: 'test',
      content: 'hello from mac edge sync ' + Date.now(),
      tool: 'note',
      source: 'note:test-1',
    });
    await edgeStore.persist();
    edgeStore.close();

    const client = new EdgeClient({ home: homeEdge });
    await client.start();

    // Wait for hello_ok
    const deadline = Date.now() + 5000;
    while (!hub.isOnline() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(hub.isOnline()).toBe(true);
    expect(hub.getPresence().capabilities.map((c) => c.name)).toContain('edge_ping');

    const ping = await hub.invokeTool('edge_ping', {});
    expect(ping.ok).toBe(true);
    expect(ping.text).toContain('deviceId');

    const run = await hub.invokeTool('edge_run', { argv: ['echo', 'edge-ok'] });
    expect(run.ok).toBe(true);
    expect(run.text).toContain('edge-ok');

    // Allow sync flush
    await client.flushMemorySync();
    const syncDeadline = Date.now() + 8000;
    while (Date.now() < syncDeadline) {
      const chats = store.listChats();
      if (chats.some((c) => c.title.includes('mac note') || c.project === 'test')) break;
      await new Promise((r) => setTimeout(r, 100));
      await client.flushMemorySync();
    }
    const synced = store.listChats().some((c) => c.title.includes('mac note'));
    expect(synced).toBe(true);

    client.stop();
    await hub.close();
    store.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }, 20_000);
});

describe('edge sync helpers', () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('tracks synced hashes and upserts on hub', async () => {
    home = mkdtempSync(path.join(tmpdir(), 'memgrep-sync-'));
    const store = await MemoryStore.open(home);
    const content = 'sync payload ' + Date.now();
    const hash = contentHash(content);
    await store.addChat({
      title: 't',
      project: 'p',
      content,
      tool: 'note',
      source: 'note:a',
    });
    const pending = await collectUnsyncedChats(store, home, 10);
    expect(pending.some((c) => c.hash === hash)).toBe(true);

    const hubHome = mkdtempSync(path.join(tmpdir(), 'memgrep-sync-hub-'));
    const hubStore = await MemoryStore.open(hubHome);
    const result = await ingestSyncedChats(hubStore, 'device-1', pending);
    expect(result.accepted).toContain(hash);
    markHashesSynced(result.accepted, home);
    const pending2 = await collectUnsyncedChats(store, home, 10);
    expect(pending2.some((c) => c.hash === hash)).toBe(false);

    store.close();
    hubStore.close();
    rmSync(hubHome, { recursive: true, force: true });
  });
});
