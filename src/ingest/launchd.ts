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
import {
  formatInterval,
  parseIntervalMs,
  readIngestConfig,
  writeIngestConfig,
} from './config.js';

export const INGEST_LAUNCHD_LABEL = 'com.memgrep.ingest';

export type IngestLaunchdInstallOptions = {
  agentsDir?: string;
  home?: string;
  programArgs?: string[];
  /** Persist before install; e.g. `1h`. */
  interval?: string;
  sources?: string[];
  dryRun?: boolean;
};

export type IngestLaunchdStatus = {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  logPath: string;
  programArgs: string[] | null;
  intervalMs: number | null;
  sources: string[] | null;
};

export function ingestLaunchdPlistPath(agentsDir = launchAgentsDir()): string {
  return path.join(agentsDir, `${INGEST_LAUNCHD_LABEL}.plist`);
}

export function ingestServiceLogPath(home = defaultHome()): string {
  return path.join(home, 'logs', 'ingest-launchd.log');
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

export function isIngestLaunchdLoaded(dryRun = false): boolean {
  if (dryRun) return false;
  const printed = launchctl(['print', `${guiDomain()}/${INGEST_LAUNCHD_LABEL}`], false);
  if (printed.ok) return true;
  return launchctl(['list', INGEST_LAUNCHD_LABEL], false).ok;
}

export function getIngestLaunchdStatus(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): IngestLaunchdStatus {
  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = ingestLaunchdPlistPath(agentsDir);
  const logPath = ingestServiceLogPath(home);
  const installed = existsSync(plistPath);
  let programArgs: string[] | null = null;
  if (installed) {
    try {
      programArgs = parseProgramArgsFromPlist(readFileSync(plistPath, 'utf8'));
    } catch {
      programArgs = null;
    }
  }
  const cfg = (() => {
    try {
      return readIngestConfig(home);
    } catch {
      return null;
    }
  })();
  return {
    label: INGEST_LAUNCHD_LABEL,
    plistPath,
    installed,
    loaded: installed ? isIngestLaunchdLoaded(options.dryRun) : false,
    logPath,
    programArgs,
    intervalMs: cfg?.intervalMs ?? null,
    sources: cfg?.sources ?? null,
  };
}

export function installIngestLaunchdService(
  options: IngestLaunchdInstallOptions = {},
): IngestLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent install is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const logPath = ingestServiceLogPath(home);
  const plistPath = ingestLaunchdPlistPath(agentsDir);

  writeIngestConfig(
    {
      intervalMs: options.interval ? parseIntervalMs(options.interval) : undefined,
      sources: options.sources,
    },
    home,
  );

  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, 'ingest', 'daemon'];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
  };
  if (process.env.MEMGREP_HOME) {
    env.MEMGREP_HOME = process.env.MEMGREP_HOME;
  }

  const plist = buildLaunchdPlist({
    label: INGEST_LAUNCHD_LABEL,
    programArgs,
    logPath,
    workingDirectory: home,
    env,
  });

  if (existsSync(plistPath) && !options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${INGEST_LAUNCHD_LABEL}`], false);
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
    launchctl(['kickstart', '-k', `${guiDomain()}/${INGEST_LAUNCHD_LABEL}`], false);
  }

  return getIngestLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

export function uninstallIngestLaunchdService(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): IngestLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent uninstall is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = ingestLaunchdPlistPath(agentsDir);

  if (!options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${INGEST_LAUNCHD_LABEL}`], false);
    if (existsSync(plistPath)) {
      launchctl(['unload', '-w', plistPath], false);
    }
  }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }

  return getIngestLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

/** Format status lines for CLI (includes interval from config). */
export function formatIngestServiceStatus(status: IngestLaunchdStatus): string[] {
  const lines = [
    `label: ${status.label}`,
    `installed: ${status.installed}`,
    `loaded: ${status.loaded}`,
    `plist: ${status.plistPath}`,
    `log: ${status.logPath}`,
  ];
  if (status.intervalMs != null) {
    lines.push(`interval: ${formatInterval(status.intervalMs)}`);
  }
  if (status.sources?.length) {
    lines.push(`sources: ${status.sources.join(',')}`);
  }
  if (status.programArgs) {
    lines.push(`args: ${status.programArgs.join(' ')}`);
  }
  return lines;
}
