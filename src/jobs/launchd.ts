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

export const JOBS_LAUNCHD_LABEL = 'com.memgrep.jobs';

export type JobsLaunchdInstallOptions = {
  agentsDir?: string;
  home?: string;
  programArgs?: string[];
  dryRun?: boolean;
};

export type JobsLaunchdStatus = {
  label: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  logPath: string;
  programArgs: string[] | null;
};

export function jobsLaunchdPlistPath(agentsDir = launchAgentsDir()): string {
  return path.join(agentsDir, `${JOBS_LAUNCHD_LABEL}.plist`);
}

export function jobsServiceLogPath(home = defaultHome()): string {
  return path.join(home, 'logs', 'jobs-launchd.log');
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

export function isJobsLaunchdLoaded(dryRun = false): boolean {
  if (dryRun) return false;
  const printed = launchctl(['print', `${guiDomain()}/${JOBS_LAUNCHD_LABEL}`], false);
  if (printed.ok) return true;
  return launchctl(['list', JOBS_LAUNCHD_LABEL], false).ok;
}

export function getJobsLaunchdStatus(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): JobsLaunchdStatus {
  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = jobsLaunchdPlistPath(agentsDir);
  const logPath = jobsServiceLogPath(home);
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
    label: JOBS_LAUNCHD_LABEL,
    plistPath,
    installed,
    loaded: installed ? isJobsLaunchdLoaded(options.dryRun) : false,
    logPath,
    programArgs,
  };
}

export function installJobsLaunchdService(options: JobsLaunchdInstallOptions = {}): JobsLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent install is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const logPath = jobsServiceLogPath(home);
  const plistPath = jobsLaunchdPlistPath(agentsDir);

  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(agentsDir, { recursive: true });

  const baseArgs = options.programArgs ?? resolveMemgrepProgramArgs();
  const programArgs = [...baseArgs, 'jobs', 'daemon'];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? homedir(),
  };
  if (process.env.MEMGREP_HOME) {
    env.MEMGREP_HOME = process.env.MEMGREP_HOME;
  }

  const plist = buildLaunchdPlist({
    label: JOBS_LAUNCHD_LABEL,
    programArgs,
    logPath,
    workingDirectory: home,
    env,
  });

  if (existsSync(plistPath) && !options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${JOBS_LAUNCHD_LABEL}`], false);
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
    launchctl(['kickstart', '-k', `${guiDomain()}/${JOBS_LAUNCHD_LABEL}`], false);
  }

  return getJobsLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}

export function uninstallJobsLaunchdService(options: {
  agentsDir?: string;
  home?: string;
  dryRun?: boolean;
} = {}): JobsLaunchdStatus {
  if (process.platform !== 'darwin' && !options.dryRun) {
    throw new Error('LaunchAgent uninstall is only supported on macOS.');
  }

  const agentsDir = options.agentsDir ?? launchAgentsDir();
  const home = options.home ?? defaultHome();
  const plistPath = jobsLaunchdPlistPath(agentsDir);

  if (!options.dryRun) {
    launchctl(['bootout', `${guiDomain()}/${JOBS_LAUNCHD_LABEL}`], false);
    if (existsSync(plistPath)) {
      launchctl(['unload', '-w', plistPath], false);
    }
  }

  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }

  return getJobsLaunchdStatus({ agentsDir, home, dryRun: options.dryRun });
}
