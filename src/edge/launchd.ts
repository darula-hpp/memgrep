import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultHome } from '../memory/store.js';
import {
  buildLaunchdPlist,
  launchAgentsDir,
  resolveMemgrepProgramArgs,
} from '../telegram/launchd.js';
import { readEdgeConfig, writeEdgeConfig, type EdgeToolName } from './config.js';

export const EDGE_LAUNCHD_LABEL = 'com.memgrep.edge';

export type EdgeLaunchdInstallOptions = {
  agentsDir?: string;
  home?: string;
  programArgs?: string[];
  tools?: EdgeToolName[];
  syncMemory?: boolean;
  dryRun?: boolean;
};

export type EdgeLaunchdStatus = {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  logPath: string;
  programArgs: string[] | null;
  hubUrl: string | null;
  deviceId: string | null;
  tools: string[] | null;
  syncMemory: boolean | null;
};

export function edgeLaunchdPlistPath(agentsDir = launchAgentsDir()): string {
  return path.join(agentsDir, `${EDGE_LAUNCHD_LABEL}.plist`);
}

/** macOS LaunchAgent log (service facade may use edge-service.log on other OSes). */
export function edgeServiceLogPath(home = defaultHome()): string {
  return path.join(home, 'logs', 'edge-launchd.log');
}

function parseProgramArgsFromPlist(xml: string): string[] | null {
  const match = xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!match) return null;
  const args: string[] = [];
  const re = /<string>([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1]!))) {
    args.push(
      m[1]!
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&'),
    );
  }
  return args.length > 0 ? args : null;
}

function launchctl(args: string[], dryRun: boolean): { ok: boolean; output: string } {
  if (dryRun) return { ok: true, output: '' };
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output };
}

function guiDomain(): string {
  try {
    const uid = process.getuid?.();
    if (uid !== undefined) return `gui/${uid}`;
  } catch {
    // ignore
  }
  return 'gui/501';
}

export function isEdgeLaunchdLoaded(dryRun = false): boolean {
  if (dryRun) return false;
  const printed = launchctl(['print', `${guiDomain()}/${EDGE_LAUNCHD_LABEL}`], false);
  if (printed.ok) return true;
  return launchctl(['list', EDGE_LAUNCHD_LABEL], false).ok;
}

export function getEdgeLaunchdStatus(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): EdgeLaunchdStatus {
  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = edgeLaunchdPlistPath(agentsDir);
  const logPath = edgeServiceLogPath(home);
  const installed = existsSync(plistPath);
  let programArgs: string[] | null = null;
  if (installed) {
    try {
      programArgs = parseProgramArgsFromPlist(readFileSync(plistPath, 'utf8'));
    } catch {
      programArgs = null;
    }
  }
  const cfg = readEdgeConfig(home);
  return {
    label: EDGE_LAUNCHD_LABEL,
    plistPath,
    installed,
    loaded: installed ? isEdgeLaunchdLoaded(options.dryRun) : false,
    logPath,
    programArgs,
    hubUrl: cfg?.hubUrl ?? null,
    deviceId: cfg?.deviceId ?? null,
    tools: cfg?.tools ?? null,
    syncMemory: cfg?.syncMemory ?? null,
  };
}

export function installEdgeLaunchdService(
  options: EdgeLaunchdInstallOptions = {},
): EdgeLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent install is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const existing = readEdgeConfig(home);
  if (!existing && !options.dryRun) {
    throw new Error(
      'Edge not paired. Run: memgrep edge pair <hub-url> --token <token> before install.',
    );
  }
  // dryRun may install without pair (tests); live install requires edge.json.

  if (existing && (options.tools || options.syncMemory !== undefined)) {
    writeEdgeConfig(
      {
        hubUrl: existing.hubUrl,
        token: existing.token,
        deviceId: existing.deviceId,
        tools: options.tools ?? existing.tools,
        syncMemory: options.syncMemory ?? existing.syncMemory,
        runAllowlist: existing.runAllowlist,
      },
      home,
    );
  }

  const logPath = edgeServiceLogPath(home);
  const plistPath = edgeLaunchdPlistPath(agentsDir);
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, 'edge', 'daemon'];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
  };
  if (process.env.MEMGREP_HOME) {
    env.MEMGREP_HOME = process.env.MEMGREP_HOME;
  }

  const plist = buildLaunchdPlist({
    label: EDGE_LAUNCHD_LABEL,
    programArgs,
    logPath,
    workingDirectory: home,
    env,
  });

  if (existsSync(plistPath) && !options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${EDGE_LAUNCHD_LABEL}`], false);
    launchctl(['unload', plistPath], false);
  }

  writeFileSync(plistPath, plist, { mode: 0o644 });

  if (!options.dryRun) {
    const boot = launchctl(['bootstrap', guiDomain(), plistPath], false);
    if (!boot.ok) {
      const loaded = launchctl(['load', '-w', plistPath], false);
      if (!loaded.ok) {
        throw new Error(
          `Wrote ${plistPath} but failed to load LaunchAgent.\n${boot.output || loaded.output}`,
        );
      }
    }
    launchctl(['kickstart', '-k', `${guiDomain()}/${EDGE_LAUNCHD_LABEL}`], false);
  }

  return getEdgeLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

export function uninstallEdgeLaunchdService(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): EdgeLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent uninstall is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = edgeLaunchdPlistPath(agentsDir);

  if (!options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${EDGE_LAUNCHD_LABEL}`], false);
    if (existsSync(plistPath)) {
      launchctl(['unload', '-w', plistPath], false);
    }
  }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }

  return getEdgeLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

export function formatEdgeServiceStatus(status: EdgeLaunchdStatus): string[] {
  const lines = [
    `label: ${status.label}`,
    `installed: ${status.installed}`,
    `loaded: ${status.loaded}`,
    `plist: ${status.plistPath}`,
    `log: ${status.logPath}`,
  ];
  if (status.hubUrl) lines.push(`hub: ${status.hubUrl}`);
  if (status.deviceId) lines.push(`device: ${status.deviceId}`);
  if (status.tools) lines.push(`tools: ${status.tools.join(',') || '(none)'}`);
  if (status.syncMemory != null) lines.push(`syncMemory: ${status.syncMemory}`);
  if (status.programArgs) lines.push(`args: ${status.programArgs.join(' ')}`);
  return lines;
}
