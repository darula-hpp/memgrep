import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import { hubHttpToWsUrl } from './protocol.js';

export const EDGE_CONFIG_FILE = 'edge.json';
export const EDGE_HUB_FILE = 'edge-hub.json';

/** Tools the edge node may advertise / execute. */
export const EDGE_TOOL_NAMES = [
  'edge_ping',
  'edge_run',
  'edge_loop_run',
  'edge_cursor_run',
] as const;
export type EdgeToolName = (typeof EDGE_TOOL_NAMES)[number];

/** Default allowlisted binaries for edge_run (platform-aware). */
export function defaultRunAllowlist(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    return ['echo', 'cmd.exe', 'cmd', 'hostname', 'where'];
  }
  return ['echo', 'uname', 'pwd', 'date'];
}

export type EdgeClientConfig = {
  hubUrl: string;
  token: string;
  deviceId: string;
  /** Allowlisted tool names (empty = none until enabled). */
  tools: EdgeToolName[];
  /** One-way Mac → cloud memory sync. */
  syncMemory: boolean;
  /**
   * Allowed argv[0] values for edge_run (basename or absolute path).
   * Empty means edge_run refuses all commands.
   */
  runAllowlist: string[];
};

export type EdgeHubConfig = {
  token: string;
  createdAt: string;
};

export function edgeConfigPath(home = defaultHome()): string {
  return path.join(home, EDGE_CONFIG_FILE);
}

export function edgeHubConfigPath(home = defaultHome()): string {
  return path.join(home, EDGE_HUB_FILE);
}

function isToolName(value: string): value is EdgeToolName {
  return (EDGE_TOOL_NAMES as readonly string[]).includes(value);
}

export function readEdgeConfig(home = defaultHome()): EdgeClientConfig | null {
  const file = edgeConfigPath(home);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<EdgeClientConfig>;
    if (!parsed.hubUrl || !parsed.token || !parsed.deviceId) return null;
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools.filter((t): t is EdgeToolName => typeof t === 'string' && isToolName(t))
      : [];
    const runAllowlist = Array.isArray(parsed.runAllowlist)
      ? parsed.runAllowlist.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    return {
      hubUrl: String(parsed.hubUrl),
      token: String(parsed.token),
      deviceId: String(parsed.deviceId),
      tools,
      syncMemory: parsed.syncMemory !== false,
      runAllowlist,
    };
  } catch {
    return null;
  }
}

export function writeEdgeConfig(
  patch: Partial<EdgeClientConfig> & Pick<EdgeClientConfig, 'hubUrl' | 'token'>,
  home = defaultHome(),
): EdgeClientConfig {
  mkdirSync(home, { recursive: true });
  const prev = readEdgeConfig(home);
  const next: EdgeClientConfig = {
    hubUrl: hubHttpToWsUrl(patch.hubUrl),
    token: patch.token,
    deviceId: patch.deviceId ?? prev?.deviceId ?? randomUUID(),
    tools: patch.tools ?? prev?.tools ?? [],
    syncMemory: patch.syncMemory ?? prev?.syncMemory ?? true,
    runAllowlist: patch.runAllowlist ?? prev?.runAllowlist ?? defaultRunAllowlist(),
  };
  writeFileAtomic(edgeConfigPath(home), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

export function readEdgeHubConfig(home = defaultHome()): EdgeHubConfig | null {
  const file = edgeHubConfigPath(home);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<EdgeHubConfig>;
    if (!parsed.token) return null;
    return {
      token: String(parsed.token),
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Create or return existing hub pairing token (cloud side). */
export function ensureEdgeHubToken(home = defaultHome()): EdgeHubConfig {
  const existing = readEdgeHubConfig(home);
  if (existing) return existing;
  mkdirSync(home, { recursive: true });
  const created: EdgeHubConfig = {
    token: randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  writeFileAtomic(edgeHubConfigPath(home), JSON.stringify(created, null, 2) + '\n', {
    mode: 0o600,
  });
  return created;
}

export function parseToolsList(raw?: string): EdgeToolName[] {
  if (!raw?.trim()) return [];
  const out: EdgeToolName[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (isToolName(name) && !out.includes(name)) out.push(name);
  }
  return out;
}
