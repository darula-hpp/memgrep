/**
 * Platform-agnostic edge background service install.
 * - darwin: LaunchAgent
 * - linux: systemd --user
 * - win32: Startup folder .cmd (logon autostart)
 * Daemon itself (`memgrep edge daemon`) works on all platforms.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultHome } from '../memory/store.js';
import { resolveMemgrepProgramArgs } from '../telegram/launchd.js';
import { readEdgeConfig, writeEdgeConfig, type EdgeToolName } from './config.js';
import {
  EDGE_LAUNCHD_LABEL,
  formatEdgeServiceStatus as formatLaunchdStatus,
  getEdgeLaunchdStatus,
  installEdgeLaunchdService,
  uninstallEdgeLaunchdService,
  edgeServiceLogPath as launchdLogPath,
  type EdgeLaunchdStatus,
} from './launchd.js';

export type EdgeServiceBackend = 'launchd' | 'systemd' | 'startup' | 'none';

export type EdgeServiceStatus = {
  platform: NodeJS.Platform;
  backend: EdgeServiceBackend;
  label: string;
  installed: boolean;
  loaded: boolean;
  unitPath: string;
  logPath: string;
  programArgs: string[] | null;
  hubUrl: string | null;
  deviceId: string | null;
  tools: string[] | null;
  syncMemory: boolean | null;
  note?: string;
};

export type EdgeServiceInstallOptions = {
  home?: string;
  programArgs?: string[];
  tools?: EdgeToolName[];
  syncMemory?: boolean;
  dryRun?: boolean;
  /** Tests: override LaunchAgents / systemd dirs */
  agentsDir?: string;
  systemdDir?: string;
  startupDir?: string;
};

const SYSTEMD_UNIT = 'memgrep-edge.service';
const WIN_STARTUP_NAME = 'memgrep-edge.cmd';

export function edgeServiceLogPath(home = defaultHome()): string {
  return path.join(home, 'logs', 'edge-service.log');
}

export function detectEdgeBackend(platform: NodeJS.Platform = process.platform): EdgeServiceBackend {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') return 'systemd';
  if (platform === 'win32') return 'startup';
  return 'none';
}

function ensurePairedOrDryRun(home: string, dryRun?: boolean): void {
  const existing = readEdgeConfig(home);
  if (!existing && !dryRun) {
    throw new Error(
      'Edge not paired. Run: memgrep edge pair <hub-url> --token <token> before install.',
    );
  }
}

function applyConfigPatch(
  home: string,
  options: EdgeServiceInstallOptions,
): void {
  const existing = readEdgeConfig(home);
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
}

function cfgFields(home: string) {
  const cfg = readEdgeConfig(home);
  return {
    hubUrl: cfg?.hubUrl ?? null,
    deviceId: cfg?.deviceId ?? null,
    tools: cfg?.tools ?? null,
    syncMemory: cfg?.syncMemory ?? null,
  };
}

function fromLaunchd(status: EdgeLaunchdStatus, platform: NodeJS.Platform): EdgeServiceStatus {
  return {
    platform,
    backend: 'launchd',
    label: status.label,
    installed: status.installed,
    loaded: status.loaded,
    unitPath: status.plistPath,
    logPath: status.logPath,
    programArgs: status.programArgs,
    hubUrl: status.hubUrl,
    deviceId: status.deviceId,
    tools: status.tools,
    syncMemory: status.syncMemory,
  };
}

// --- systemd (Linux) ---

function systemdUserDir(override?: string): string {
  return override ?? path.join(homedir(), '.config', 'systemd', 'user');
}

function systemdUnitPath(dir: string): string {
  return path.join(dir, SYSTEMD_UNIT);
}

function buildSystemdUnit(programArgs: string[], logPath: string, home: string): string {
  const execStart = programArgs.map((a) => quoteSystemd(a)).join(' ');
  const envLines = [
    `Environment=HOME=${homedir()}`,
    `Environment=PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
  ];
  if (process.env.MEMGREP_HOME) {
    envLines.push(`Environment=MEMGREP_HOME=${process.env.MEMGREP_HOME}`);
  }
  return `[Unit]
Description=memgrep edge client (outbound hub connection)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${home}
${envLines.join('\n')}
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;
}

function quoteSystemd(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function systemctl(args: string[], dryRun: boolean): { ok: boolean; output: string } {
  if (dryRun) return { ok: true, output: '' };
  const result = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output };
}

function getSystemdStatus(options: EdgeServiceInstallOptions = {}): EdgeServiceStatus {
  const home = options.home ?? defaultHome();
  const dir = systemdUserDir(options.systemdDir);
  const unitPath = systemdUnitPath(dir);
  const logPath = edgeServiceLogPath(home);
  const installed = existsSync(unitPath);
  let loaded = false;
  if (installed && !options.dryRun) {
    loaded = systemctl(['is-active', '--quiet', SYSTEMD_UNIT], false).ok;
  }
  let programArgs: string[] | null = null;
  if (installed) {
    try {
      const text = readFileSync(unitPath, 'utf8');
      const m = text.match(/^ExecStart=(.+)$/m);
      if (m) programArgs = m[1]!.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, '')) ?? null;
    } catch {
      programArgs = null;
    }
  }
  return {
    platform: 'linux',
    backend: 'systemd',
    label: SYSTEMD_UNIT,
    installed,
    loaded,
    unitPath,
    logPath,
    programArgs,
    ...cfgFields(home),
  };
}

function installSystemd(options: EdgeServiceInstallOptions): EdgeServiceStatus {
  if (process.platform !== 'linux' && !options.dryRun) {
    throw new Error('systemd install is only supported on Linux.');
  }
  const home = options.home ?? defaultHome();
  ensurePairedOrDryRun(home, options.dryRun);
  applyConfigPatch(home, options);

  const dir = systemdUserDir(options.systemdDir);
  const unitPath = systemdUnitPath(dir);
  const logPath = edgeServiceLogPath(home);
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(dir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, 'edge', 'daemon'];
  writeFileSync(unitPath, buildSystemdUnit(programArgs, logPath, home), { mode: 0o644 });

  if (!options.dryRun) {
    systemctl(['daemon-reload'], false);
    const en = systemctl(['enable', '--now', SYSTEMD_UNIT], false);
    if (!en.ok) {
      throw new Error(`Wrote ${unitPath} but failed to enable unit.\n${en.output}`);
    }
  }
  return getSystemdStatus(options);
}

function uninstallSystemd(options: EdgeServiceInstallOptions): EdgeServiceStatus {
  const home = options.home ?? defaultHome();
  const dir = systemdUserDir(options.systemdDir);
  const unitPath = systemdUnitPath(dir);
  if (!options.dryRun) {
    systemctl(['disable', '--now', SYSTEMD_UNIT], false);
  }
  if (existsSync(unitPath)) unlinkSync(unitPath);
  if (!options.dryRun) systemctl(['daemon-reload'], false);
  return getSystemdStatus({ ...options, home });
}

// --- Windows Startup folder ---

function windowsStartupDir(override?: string): string {
  if (override) return override;
  const appData = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function windowsStartupPath(dir: string): string {
  return path.join(dir, WIN_STARTUP_NAME);
}

function buildWindowsCmd(programArgs: string[], logPath: string): string {
  const quoted = programArgs.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  return `@echo off\r\nrem memgrep edge - starts at logon\r\n${quoted} >> "${logPath}" 2>&1\r\n`;
}

function getStartupStatus(options: EdgeServiceInstallOptions = {}): EdgeServiceStatus {
  const home = options.home ?? defaultHome();
  const dir = windowsStartupDir(options.startupDir);
  const unitPath = windowsStartupPath(dir);
  const logPath = edgeServiceLogPath(home);
  const installed = existsSync(unitPath);
  return {
    platform: 'win32',
    backend: 'startup',
    label: WIN_STARTUP_NAME,
    installed,
    loaded: installed,
    unitPath,
    logPath,
    programArgs: null,
    ...cfgFields(home),
    note: installed
      ? 'Starts at user logon via Startup folder. Use edge daemon for foreground.'
      : undefined,
  };
}

function installStartup(options: EdgeServiceInstallOptions): EdgeServiceStatus {
  if (process.platform !== 'win32' && !options.dryRun) {
    throw new Error('Startup-folder install is only supported on Windows.');
  }
  const home = options.home ?? defaultHome();
  ensurePairedOrDryRun(home, options.dryRun);
  applyConfigPatch(home, options);

  const dir = windowsStartupDir(options.startupDir);
  const unitPath = windowsStartupPath(dir);
  const logPath = edgeServiceLogPath(home);
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(dir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, 'edge', 'daemon'];
  writeFileSync(unitPath, buildWindowsCmd(programArgs, logPath), { mode: 0o644 });
  return getStartupStatus(options);
}

function uninstallStartup(options: EdgeServiceInstallOptions): EdgeServiceStatus {
  const home = options.home ?? defaultHome();
  const dir = windowsStartupDir(options.startupDir);
  const unitPath = windowsStartupPath(dir);
  if (existsSync(unitPath)) unlinkSync(unitPath);
  return getStartupStatus({ ...options, home });
}

// --- public API ---

export function getEdgeServiceStatus(
  options: EdgeServiceInstallOptions = {},
): EdgeServiceStatus {
  const platform = process.platform;
  const backend = detectEdgeBackend(platform);
  if (backend === 'launchd') {
    return fromLaunchd(
      getEdgeLaunchdStatus({
        agentsDir: options.agentsDir,
        home: options.home,
        dryRun: options.dryRun,
      }),
      platform,
    );
  }
  if (backend === 'systemd') return getSystemdStatus(options);
  if (backend === 'startup') return getStartupStatus(options);
  const home = options.home ?? defaultHome();
  return {
    platform,
    backend: 'none',
    label: 'memgrep-edge',
    installed: false,
    loaded: false,
    unitPath: '',
    logPath: edgeServiceLogPath(home),
    programArgs: null,
    ...cfgFields(home),
    note: 'No background installer on this OS. Run: memgrep edge daemon',
  };
}

export function installEdgeService(
  options: EdgeServiceInstallOptions = {},
): EdgeServiceStatus {
  const backend = detectEdgeBackend();
  if (backend === 'launchd') {
    return fromLaunchd(installEdgeLaunchdService(options), process.platform);
  }
  if (backend === 'systemd') return installSystemd(options);
  if (backend === 'startup') return installStartup(options);
  throw new Error(
    `Background install is not supported on ${process.platform}. Run: memgrep edge daemon`,
  );
}

export function uninstallEdgeService(
  options: EdgeServiceInstallOptions = {},
): EdgeServiceStatus {
  const backend = detectEdgeBackend();
  if (backend === 'launchd') {
    return fromLaunchd(uninstallEdgeLaunchdService(options), process.platform);
  }
  if (backend === 'systemd') return uninstallSystemd(options);
  if (backend === 'startup') return uninstallStartup(options);
  return getEdgeServiceStatus(options);
}

export function formatEdgeServiceStatus(status: EdgeServiceStatus): string[] {
  if (status.backend === 'launchd') {
    return formatLaunchdStatus({
      label: status.label,
      plistPath: status.unitPath,
      installed: status.installed,
      loaded: status.loaded,
      logPath: status.logPath,
      programArgs: status.programArgs,
      hubUrl: status.hubUrl,
      deviceId: status.deviceId,
      tools: status.tools,
      syncMemory: status.syncMemory,
    });
  }
  const lines = [
    `platform: ${status.platform}`,
    `backend: ${status.backend}`,
    `label: ${status.label}`,
    `installed: ${status.installed}`,
    `loaded: ${status.loaded}`,
    `unit: ${status.unitPath || '(none)'}`,
    `log: ${status.logPath}`,
  ];
  if (status.hubUrl) lines.push(`hub: ${status.hubUrl}`);
  if (status.deviceId) lines.push(`device: ${status.deviceId}`);
  if (status.tools) lines.push(`tools: ${status.tools.join(',') || '(none)'}`);
  if (status.syncMemory != null) lines.push(`syncMemory: ${status.syncMemory}`);
  if (status.programArgs) lines.push(`args: ${status.programArgs.join(' ')}`);
  if (status.note) lines.push(`note: ${status.note}`);
  return lines;
}

/** @deprecated use edgeServiceLogPath */
export const edgeLaunchdLogAlias = launchdLogPath;
export { EDGE_LAUNCHD_LABEL };
