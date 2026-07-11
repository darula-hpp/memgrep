import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultHome } from '../memory/store.js';
import { sanitizeTelegramProfile } from './config.js';

export const LAUNCHD_LABEL = 'com.memgrep.telegram';

export type LaunchdRunMode =
  | { kind: 'default' }
  | { kind: 'all' }
  | { kind: 'profile'; profile: string };

export type LaunchdInstallOptions = {
  mode: LaunchdRunMode;
  /** Override LaunchAgents directory (tests). */
  agentsDir?: string;
  /** Override memgrep home for logs. */
  home?: string;
  /** Override node + cli resolution (tests). */
  programArgs?: string[];
  /** Skip launchctl load/unload (tests). */
  dryRun?: boolean;
};

export type LaunchdStatus = {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  logPath: string;
  programArgs: string[] | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function launchAgentsDir(home = homedir()): string {
  return path.join(home, 'Library', 'LaunchAgents');
}

export function launchdPlistPath(agentsDir = launchAgentsDir()): string {
  return path.join(agentsDir, `${LAUNCHD_LABEL}.plist`);
}

export function telegramServiceLogPath(home = defaultHome()): string {
  return path.join(home, 'logs', 'telegram-launchd.log');
}

/**
 * Resolve how launchd should invoke memgrep.
 * Prefer the current Node + this package's CLI entry so local builds and global installs both work.
 */
export function resolveMemgrepProgramArgs(argv = process.argv, execPath = process.execPath): string[] {
  const entry = argv[1];
  if (entry) {
    const resolved = path.resolve(entry);
    if (existsSync(resolved) && /\.(c|m)?js$/i.test(resolved)) {
      return [execPath, resolved];
    }
    // Global `memgrep` bin is often a shim next to ../lib/node_modules/memgrep/dist/cli.js
    const candidates = [
      path.resolve(resolved, '..', 'dist', 'cli.js'),
      path.resolve(resolved, '..', '..', 'lib', 'node_modules', 'memgrep', 'dist', 'cli.js'),
      path.resolve(resolved, '..', 'lib', 'node_modules', 'memgrep', 'dist', 'cli.js'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return [execPath, candidate];
      }
    }
  }

  // Fallback: dist/cli.js next to this compiled module (dist/telegram/launchd.js → dist/cli.js).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distCli = path.resolve(here, '..', 'cli.js');
  if (existsSync(distCli)) {
    return [execPath, distCli];
  }

  throw new Error(
    'Cannot resolve memgrep CLI path for LaunchAgent. Run from a built install (npm run build / npm link).',
  );
}

export function telegramArgsForMode(mode: LaunchdRunMode): string[] {
  switch (mode.kind) {
    case 'all':
      return ['telegram', '--all'];
    case 'profile':
      return ['telegram', '--profile', sanitizeTelegramProfile(mode.profile)];
    default:
      return ['telegram'];
  }
}

export function buildLaunchdPlist(options: {
  label?: string;
  programArgs: string[];
  logPath: string;
  workingDirectory?: string;
  env?: Record<string, string>;
}): string {
  const label = options.label ?? LAUNCHD_LABEL;
  const argsXml = options.programArgs
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join('\n');

  const envEntries = Object.entries(options.env ?? {}).filter(([, v]) => v.length > 0);
  const envXml =
    envEntries.length === 0
      ? ''
      : `
  <key>EnvironmentVariables</key>
  <dict>
${envEntries
  .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
  .join('\n')}
  </dict>`;

  const cwdXml = options.workingDirectory
    ? `
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>${cwdXml}${envXml}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logPath)}</string>
</dict>
</plist>
`;
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

export function isLaunchdLoaded(label = LAUNCHD_LABEL, dryRun = false): boolean {
  if (dryRun) return false;
  // Prefer modern print; fall back to list.
  const printed = launchctl(['print', `${guiDomain()}/${label}`], false);
  if (printed.ok) return true;
  const listed = launchctl(['list', label], false);
  return listed.ok;
}

export function getLaunchdStatus(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): LaunchdStatus {
  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = launchdPlistPath(agentsDir);
  const logPath = telegramServiceLogPath(home);
  const installed = existsSync(plistPath);
  let programArgs: string[] | null = null;
  if (installed) {
    try {
      programArgs = parseProgramArgsFromPlist(readFileSync(plistPath, 'utf8'));
    } catch {
      programArgs = null;
    }
  }
  return {
    label: LAUNCHD_LABEL,
    plistPath,
    installed,
    loaded: installed ? isLaunchdLoaded(LAUNCHD_LABEL, options.dryRun) : false,
    logPath,
    programArgs,
  };
}

export function installLaunchdService(options: LaunchdInstallOptions): LaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent install is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const logPath = telegramServiceLogPath(home);
  const plistPath = launchdPlistPath(agentsDir);

  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, ...telegramArgsForMode(options.mode)];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
  };
  if (process.env.MEMGREP_HOME) {
    env.MEMGREP_HOME = process.env.MEMGREP_HOME;
  }

  const plist = buildLaunchdPlist({
    programArgs,
    logPath,
    workingDirectory: home,
    env,
  });

  // Replace any existing job cleanly.
  if (existsSync(plistPath) && !options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${LAUNCHD_LABEL}`], false);
    launchctl(['unload', plistPath], false);
  }

  writeFileSync(plistPath, plist, { mode: 0o644 });

  if (!options.dryRun) {
    // bootout may fail if not loaded; ignore. Prefer bootstrap (modern) then load.
    const boot = launchctl(['bootstrap', guiDomain(), plistPath], false);
    if (!boot.ok) {
      const loaded = launchctl(['load', '-w', plistPath], false);
      if (!loaded.ok) {
        throw new Error(
          `Wrote ${plistPath} but failed to load LaunchAgent.\n${boot.output || loaded.output}`,
        );
      }
    }
    // Kickstart in case RunAtLoad didn't fire immediately.
    launchctl(['kickstart', '-k', `${guiDomain()}/${LAUNCHD_LABEL}`], false);
  }

  return getLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

export function uninstallLaunchdService(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): LaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent uninstall is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = launchdPlistPath(agentsDir);

  if (!options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${LAUNCHD_LABEL}`], false);
    if (existsSync(plistPath)) {
      launchctl(['unload', '-w', plistPath], false);
    }
  }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }

  return getLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}
