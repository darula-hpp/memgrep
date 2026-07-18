import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic-write.js';
import { defaultHome } from '../memory/store.js';
import { expandHomePath } from '../telegram/config.js';

export const LOOP_CONFIG_FILE = 'loop.json';
/** @deprecated Legacy shared manifests dir; prefer loops/<profile>/ */
export const LOOP_DIR = 'loop';
export const LOOP_BASE_DIR = 'loop.base';
export const LOOPS_DIR = 'loops';
export const LOOP_ACTIVE_FILE = 'loop.active';
export const DEFAULT_LOOP_PROFILE = 'default';
export const DEFAULT_LOOP_BASE_BRANCH = 'dev';
export const DEFAULT_LOOP_MAX_ITERATIONS = 5;
export const DEFAULT_LOOP_BRANCH_PREFIX = 'cursor/';
export const DEFAULT_LOOP_AGENT_TIMEOUT_MS = 45 * 60_000;

export type LoopArtifactKind = 'path' | 'url' | 'text' | 'builtin';

export type LoopArtifact = {
  id: string;
  kind: LoopArtifactKind;
  value: string;
  label?: string;
  description?: string;
};

export type LoopConfig = {
  version: 1;
  cwd: string;
  defaults: {
    inputs: LoopArtifact[];
    exits: LoopArtifact[];
    actions: LoopArtifact[];
  };
  git?: {
    baseBranch?: string;
    branchPrefix?: string;
  };
  maxIterations?: number;
  agentTimeoutMs?: number;
  telegramProfile?: string;
  createdAt: string;
  updatedAt: string;
};

export type LoopConfigOptions = {
  home?: string;
  profile?: string;
};

/** Second arg for config helpers: home string (legacy) or options. */
export type LoopHomeOrOptions = string | LoopConfigOptions | undefined;

export type LoopStore = {
  home: string;
  /** null when reading/writing the legacy ~/.memgrep/loop.json layout */
  profile: string | null;
  dirPath: string;
  configPath: string;
  inputsManifestPath: string;
  exitsManifestPath: string;
  actionsManifestPath: string;
  usingLegacy: boolean;
};

export type ResolvedLoopConfig = {
  cwd: string;
  defaults: {
    inputs: LoopArtifact[];
    exits: LoopArtifact[];
    actions: LoopArtifact[];
  };
  git: {
    baseBranch: string;
    branchPrefix: string;
  };
  maxIterations: number;
  agentTimeoutMs: number;
  telegramProfile?: string;
  profile?: string;
  usingLegacy?: boolean;
  configPath: string;
  dirPath: string;
  inputsManifestPath: string;
  exitsManifestPath: string;
  actionsManifestPath: string;
};

const artifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['path', 'url', 'text', 'builtin']),
  value: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
});

const loopConfigSchema = z.object({
  version: z.literal(1),
  cwd: z.string().min(1),
  defaults: z.object({
    inputs: z.array(artifactSchema),
    exits: z.array(artifactSchema),
    actions: z.array(artifactSchema),
  }),
  git: z
    .object({
      baseBranch: z.string().optional(),
      branchPrefix: z.string().optional(),
    })
    .optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  agentTimeoutMs: z.number().int().min(60_000).max(6 * 60 * 60_000).optional(),
  telegramProfile: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function normalizeOptions(homeOrOpts?: LoopHomeOrOptions): LoopConfigOptions {
  if (typeof homeOrOpts === 'string') return { home: homeOrOpts };
  return homeOrOpts ?? {};
}

export function validateProfileName(name: string): string {
  const n = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(n)) {
    throw new Error(
      `Invalid loop profile name "${name}". Use letters, digits, _ or - (max 64).`,
    );
  }
  return n;
}

export function loopBaseDir(home = defaultHome()): string {
  return path.join(home, LOOP_BASE_DIR);
}

export function loopsRoot(home = defaultHome()): string {
  return path.join(home, LOOPS_DIR);
}

export function loopProfileDir(profile: string, home = defaultHome()): string {
  return path.join(loopsRoot(home), validateProfileName(profile));
}

export function loopActivePath(home = defaultHome()): string {
  return path.join(home, LOOP_ACTIVE_FILE);
}

/** Legacy global config path (~/.memgrep/loop.json). */
export function legacyLoopConfigPath(home = defaultHome()): string {
  return path.join(home, LOOP_CONFIG_FILE);
}

/** @deprecated Prefer profile store paths via getLoopStore / resolveLoopConfig */
export function loopConfigPath(home = defaultHome()): string {
  return legacyLoopConfigPath(home);
}

/** @deprecated Prefer loops/<profile>/ */
export function loopDirPath(home = defaultHome()): string {
  return path.join(home, LOOP_DIR);
}

export function inputsManifestPath(homeOrOpts?: LoopHomeOrOptions): string {
  return getLoopStore(homeOrOpts).inputsManifestPath;
}

export function exitsManifestPath(homeOrOpts?: LoopHomeOrOptions): string {
  return getLoopStore(homeOrOpts).exitsManifestPath;
}

export function actionsManifestPath(homeOrOpts?: LoopHomeOrOptions): string {
  return getLoopStore(homeOrOpts).actionsManifestPath;
}

function storeFromDir(
  home: string,
  dirPath: string,
  profile: string | null,
  usingLegacy: boolean,
): LoopStore {
  return {
    home,
    profile,
    dirPath,
    configPath: usingLegacy
      ? legacyLoopConfigPath(home)
      : path.join(dirPath, LOOP_CONFIG_FILE),
    inputsManifestPath: path.join(dirPath, 'inputs.manifest.md'),
    exitsManifestPath: path.join(dirPath, 'exits.manifest.md'),
    actionsManifestPath: path.join(dirPath, 'actions.manifest.md'),
    usingLegacy,
  };
}

export function getActiveLoopProfile(home = defaultHome()): string | undefined {
  const filePath = loopActivePath(home);
  if (!existsSync(filePath)) return undefined;
  const raw = readFileSync(filePath, 'utf8').trim();
  return raw ? validateProfileName(raw) : undefined;
}

export function setActiveLoopProfile(profile: string, home = defaultHome()): string {
  const name = validateProfileName(profile);
  const dir = loopProfileDir(name, home);
  if (!existsSync(path.join(dir, LOOP_CONFIG_FILE))) {
    throw new Error(
      `loop profile "${name}" not found at ${dir}. Run: node dist/cli.js loop init ${name}`,
    );
  }
  writeFileAtomic(loopActivePath(home), `${name}\n`, { mode: 0o600 });
  return name;
}

export function listLoopProfiles(home = defaultHome()): string[] {
  const root = loopsRoot(home);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, LOOP_CONFIG_FILE)))
    .map((d) => d.name)
    .sort();
}

/**
 * Resolve which profile name to use (does not migrate).
 * Order: explicit → MEMGREP_LOOP_PROFILE → loop.active → undefined.
 */
export function resolveProfileName(
  options: LoopConfigOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = options.profile?.trim();
  if (explicit) return validateProfileName(explicit);
  const fromEnv = env.MEMGREP_LOOP_PROFILE?.trim();
  if (fromEnv) return validateProfileName(fromEnv);
  return getActiveLoopProfile(options.home ?? defaultHome());
}

/**
 * Resolve the on-disk store for reads/writes.
 * Prefer profiles; fall back to legacy ~/.memgrep/loop.json when no profile applies.
 */
export function getLoopStore(homeOrOpts?: LoopHomeOrOptions): LoopStore {
  const options = normalizeOptions(homeOrOpts);
  const home = options.home ?? defaultHome();
  migrateLegacyLoopIfNeeded(home);

  const profile = resolveProfileName(options);
  if (profile) {
    const dir = loopProfileDir(profile, home);
    if (existsSync(path.join(dir, LOOP_CONFIG_FILE))) {
      return storeFromDir(home, dir, profile, false);
    }
    if (options.profile?.trim()) {
      throw new Error(
        `loop profile "${profile}" not found. Run: node dist/cli.js loop init ${profile}`,
      );
    }
  }

  // Active/env pointed at missing profile — try default profile, then legacy.
  const defaultDir = loopProfileDir(DEFAULT_LOOP_PROFILE, home);
  if (existsSync(path.join(defaultDir, LOOP_CONFIG_FILE))) {
    return storeFromDir(home, defaultDir, DEFAULT_LOOP_PROFILE, false);
  }

  if (existsSync(legacyLoopConfigPath(home))) {
    return storeFromDir(home, loopDirPath(home), null, true);
  }

  // Nothing configured yet — return default profile paths for writes/init.
  return storeFromDir(home, defaultDir, DEFAULT_LOOP_PROFILE, false);
}

export function resolveExistingPath(
  raw: string,
  kind: 'file' | 'directory',
  label: string,
): string {
  const expanded = expandHomePath(raw);
  if (!existsSync(expanded)) {
    throw new Error(`${label} does not exist: ${expanded}`);
  }
  const st = statSync(expanded);
  if (kind === 'file' && !st.isFile()) {
    throw new Error(`${label} must be a file: ${expanded}`);
  }
  if (kind === 'directory' && !st.isDirectory()) {
    throw new Error(`${label} must be a directory: ${expanded}`);
  }
  return realpathSync(expanded);
}

function normalizeArtifact(raw: LoopArtifact): LoopArtifact {
  const id = raw.id.trim();
  if (!id) throw new Error('artifact id is required');
  const kind = raw.kind;
  let value = raw.value.trim();
  if (!value) throw new Error(`artifact ${id}: value is required`);
  if (kind === 'path') {
    const expanded = expandHomePath(value);
    if (!existsSync(expanded)) {
      throw new Error(`artifact ${id} path does not exist: ${expanded}`);
    }
    value = realpathSync(expanded);
  }
  if (kind === 'builtin' && value !== 'github_pr') {
    throw new Error(`Unknown builtin action: ${value} (supported: github_pr)`);
  }
  return {
    id,
    kind,
    value,
    label: raw.label?.trim() || id,
    description: raw.description?.trim() || undefined,
  };
}

export function normalizeArtifacts(list: LoopArtifact[]): LoopArtifact[] {
  const seen = new Set<string>();
  const out: LoopArtifact[] = [];
  for (const item of list) {
    const next = normalizeArtifact(item);
    if (seen.has(next.id)) {
      throw new Error(`Duplicate artifact id: ${next.id}`);
    }
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

/** Merge defaults with run overrides (run wins on same id). */
export function mergeArtifacts(
  defaults: LoopArtifact[],
  overrides: LoopArtifact[] = [],
): LoopArtifact[] {
  const map = new Map<string, LoopArtifact>();
  for (const a of defaults) map.set(a.id, a);
  for (const a of overrides) map.set(a.id, normalizeArtifact(a));
  return [...map.values()];
}

export function renderManifest(title: string, artifacts: LoopArtifact[]): string {
  const lines = [`# ${title}`, ''];
  if (artifacts.length === 0) {
    lines.push('_None configured._', '');
    return lines.join('\n');
  }
  for (const a of artifacts) {
    lines.push(`## ${a.id}`);
    lines.push(`- label: ${a.label || a.id}`);
    lines.push(`- kind: ${a.kind}`);
    lines.push(`- value: ${a.value}`);
    if (a.description) lines.push(`- description: ${a.description}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeManifests(config: LoopConfig, homeOrOpts?: LoopHomeOrOptions): void {
  const store = getLoopStore(homeOrOpts);
  mkdirSync(store.dirPath, { recursive: true, mode: 0o700 });
  writeFileAtomic(
    store.inputsManifestPath,
    renderManifest('Loop default inputs', config.defaults.inputs),
    { mode: 0o600 },
  );
  writeFileAtomic(
    store.exitsManifestPath,
    renderManifest('Loop default exit conditions', config.defaults.exits),
    { mode: 0o600 },
  );
  writeFileAtomic(
    store.actionsManifestPath,
    renderManifest('Loop default exit actions', config.defaults.actions),
    { mode: 0o600 },
  );
}

function readConfigFile(filePath: string): LoopConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid loop config at ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const parsed = loopConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid loop config at ${filePath}: ${issue?.path.join('.') ?? 'root'} ${issue?.message ?? 'schema error'}`,
    );
  }
  return parsed.data;
}

function emptyDefaults(): LoopConfig['defaults'] {
  return { inputs: [], exits: [], actions: [] };
}

function buildConfigPayload(
  config: Omit<LoopConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  existing: LoopConfig | null,
): LoopConfig {
  const cwd = resolveExistingPath(config.cwd, 'directory', 'cwd');
  const now = new Date().toISOString();
  return {
    version: 1,
    cwd,
    defaults: {
      inputs: normalizeArtifacts(config.defaults.inputs),
      exits: normalizeArtifacts(config.defaults.exits),
      actions: normalizeArtifacts(config.defaults.actions),
    },
    git: {
      baseBranch:
        config.git?.baseBranch?.trim() ||
        existing?.git?.baseBranch ||
        DEFAULT_LOOP_BASE_BRANCH,
      branchPrefix:
        config.git?.branchPrefix?.trim() ||
        existing?.git?.branchPrefix ||
        DEFAULT_LOOP_BRANCH_PREFIX,
    },
    maxIterations:
      config.maxIterations ?? existing?.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS,
    agentTimeoutMs:
      config.agentTimeoutMs ?? existing?.agentTimeoutMs ?? DEFAULT_LOOP_AGENT_TIMEOUT_MS,
    telegramProfile:
      config.telegramProfile?.trim() || existing?.telegramProfile || undefined,
    createdAt: config.createdAt ?? existing?.createdAt ?? now,
    updatedAt: config.updatedAt ?? now,
  };
}

function writeConfigToStore(next: LoopConfig, store: LoopStore): void {
  mkdirSync(store.dirPath, { recursive: true, mode: 0o700 });
  writeFileAtomic(store.configPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileAtomic(
    store.inputsManifestPath,
    renderManifest('Loop default inputs', next.defaults.inputs),
    { mode: 0o600 },
  );
  writeFileAtomic(
    store.exitsManifestPath,
    renderManifest('Loop default exit conditions', next.defaults.exits),
    { mode: 0o600 },
  );
  writeFileAtomic(
    store.actionsManifestPath,
    renderManifest('Loop default exit actions', next.defaults.actions),
    { mode: 0o600 },
  );
}

/** Seed ~/.memgrep/loop.base with an empty (or provided) template. */
export function ensureLoopBase(
  home = defaultHome(),
  seed?: {
    cwd: string;
    git?: LoopConfig['git'];
    maxIterations?: number;
    agentTimeoutMs?: number;
  },
): string {
  const baseDir = loopBaseDir(home);
  const baseConfigPath = path.join(baseDir, LOOP_CONFIG_FILE);
  if (existsSync(baseConfigPath)) return baseDir;

  const cwd =
    seed?.cwd && existsSync(seed.cwd)
      ? realpathSync(seed.cwd)
      : existsSync(process.cwd())
        ? realpathSync(process.cwd())
        : home;
  const now = new Date().toISOString();
  const next: LoopConfig = {
    version: 1,
    cwd,
    defaults: emptyDefaults(),
    git: {
      baseBranch: seed?.git?.baseBranch || DEFAULT_LOOP_BASE_BRANCH,
      branchPrefix: seed?.git?.branchPrefix || DEFAULT_LOOP_BRANCH_PREFIX,
    },
    maxIterations: seed?.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS,
    agentTimeoutMs: seed?.agentTimeoutMs ?? DEFAULT_LOOP_AGENT_TIMEOUT_MS,
    createdAt: now,
    updatedAt: now,
  };
  writeConfigToStore(next, storeFromDir(home, baseDir, null, false));
  return baseDir;
}

/**
 * One-time: legacy ~/.memgrep/loop.json → loops/default + seed loop.base.
 */
export function migrateLegacyLoopIfNeeded(home = defaultHome()): boolean {
  const defaultConfig = path.join(loopProfileDir(DEFAULT_LOOP_PROFILE, home), LOOP_CONFIG_FILE);
  if (existsSync(defaultConfig)) return false;

  const legacyPath = legacyLoopConfigPath(home);
  if (!existsSync(legacyPath)) return false;

  const legacy = readConfigFile(legacyPath);
  ensureLoopBase(home, {
    cwd: legacy.cwd,
    git: legacy.git,
    maxIterations: legacy.maxIterations,
    agentTimeoutMs: legacy.agentTimeoutMs,
  });

  const profileDir = loopProfileDir(DEFAULT_LOOP_PROFILE, home);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  writeConfigToStore(legacy, storeFromDir(home, profileDir, DEFAULT_LOOP_PROFILE, false));

  if (!getActiveLoopProfile(home)) {
    writeFileAtomic(loopActivePath(home), `${DEFAULT_LOOP_PROFILE}\n`, { mode: 0o600 });
  }
  return true;
}

/**
 * Copy loop.base → loops/<name>, set cwd, optionally activate.
 */
export function initLoopProfile(
  name: string,
  options: {
    home?: string;
    cwd?: string;
    setActive?: boolean;
    force?: boolean;
  } = {},
): { profile: string; store: LoopStore; config: LoopConfig } {
  const home = options.home ?? defaultHome();
  const profile = validateProfileName(name);
  migrateLegacyLoopIfNeeded(home);

  const legacy = existsSync(legacyLoopConfigPath(home))
    ? readConfigFile(legacyLoopConfigPath(home))
    : null;
  ensureLoopBase(home, legacy
    ? {
        cwd: options.cwd || legacy.cwd,
        git: legacy.git,
        maxIterations: legacy.maxIterations,
        agentTimeoutMs: legacy.agentTimeoutMs,
      }
    : options.cwd
      ? { cwd: options.cwd }
      : undefined);

  const destDir = loopProfileDir(profile, home);
  const destConfig = path.join(destDir, LOOP_CONFIG_FILE);
  if (existsSync(destConfig) && !options.force) {
    throw new Error(
      `loop profile "${profile}" already exists at ${destDir}. Use --force to overwrite from base.`,
    );
  }

  mkdirSync(loopsRoot(home), { recursive: true, mode: 0o700 });
  if (existsSync(destDir)) {
    // Overwrite contents from base
    cpSync(loopBaseDir(home), destDir, { recursive: true });
  } else {
    cpSync(loopBaseDir(home), destDir, { recursive: true });
  }

  const store = storeFromDir(home, destDir, profile, false);
  const current = readConfigFile(store.configPath);
  const cwd = resolveExistingPath(
    options.cwd?.trim() || current.cwd,
    'directory',
    'cwd',
  );
  const next = buildConfigPayload({ ...current, cwd }, current);
  writeConfigToStore(next, store);

  if (options.setActive !== false) {
    writeFileAtomic(loopActivePath(home), `${profile}\n`, { mode: 0o600 });
  }

  return { profile, store, config: next };
}

export function readLoopConfig(homeOrOpts?: LoopHomeOrOptions): LoopConfig | null {
  const options = normalizeOptions(homeOrOpts);
  const home = options.home ?? defaultHome();
  migrateLegacyLoopIfNeeded(home);

  try {
    const store = getLoopStore(options);
    if (!existsSync(store.configPath)) return null;
    return readConfigFile(store.configPath);
  } catch {
    // Explicit missing profile should surface; other path errors → null for resolve.
    if (options.profile?.trim()) throw new Error(
      `loop profile "${validateProfileName(options.profile)}" not found. Run: node dist/cli.js loop init ${options.profile.trim()}`,
    );
    return null;
  }
}

export function writeLoopConfig(
  config: Omit<LoopConfig, 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  homeOrOpts?: LoopHomeOrOptions,
): LoopConfig {
  const options = normalizeOptions(homeOrOpts);
  const home = options.home ?? defaultHome();
  migrateLegacyLoopIfNeeded(home);

  let profile = resolveProfileName(options);
  if (!profile) {
    // First write: create default profile from base.
    ensureLoopBase(home, { cwd: config.cwd, git: config.git });
    profile = DEFAULT_LOOP_PROFILE;
    if (!existsSync(path.join(loopProfileDir(profile, home), LOOP_CONFIG_FILE))) {
      initLoopProfile(profile, {
        home,
        cwd: config.cwd,
        setActive: true,
        force: true,
      });
    } else if (!getActiveLoopProfile(home)) {
      writeFileAtomic(loopActivePath(home), `${profile}\n`, { mode: 0o600 });
    }
  }

  const store = storeFromDir(home, loopProfileDir(profile, home), profile, false);
  const existing = existsSync(store.configPath) ? readConfigFile(store.configPath) : null;
  const next = buildConfigPayload(config, existing);
  writeConfigToStore(next, store);
  if (!getActiveLoopProfile(home)) {
    writeFileAtomic(loopActivePath(home), `${profile}\n`, { mode: 0o600 });
  }
  return next;
}

function upsertInList(list: LoopArtifact[], artifact: LoopArtifact): LoopArtifact[] {
  const next = normalizeArtifact(artifact);
  const out = list.filter((a) => a.id !== next.id);
  out.push(next);
  return out;
}

function requireConfig(homeOrOpts?: LoopHomeOrOptions): {
  current: LoopConfig;
  options: LoopConfigOptions;
} {
  const options = normalizeOptions(homeOrOpts);
  const current = readLoopConfig(options);
  if (!current) {
    throw new Error(
      'loop not configured. Run: node dist/cli.js loop init <name>  (or loop setup)',
    );
  }
  return { current, options };
}

export function upsertLoopInput(
  artifact: LoopArtifact,
  homeOrOpts?: LoopHomeOrOptions,
): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        inputs: upsertInList(current.defaults.inputs, artifact),
      },
    },
    options,
  );
}

export function removeLoopInput(id: string, homeOrOpts?: LoopHomeOrOptions): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  const trimmed = id.trim();
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        inputs: current.defaults.inputs.filter((a) => a.id !== trimmed),
      },
    },
    options,
  );
}

export function upsertLoopExit(
  artifact: LoopArtifact,
  homeOrOpts?: LoopHomeOrOptions,
): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        exits: upsertInList(current.defaults.exits, artifact),
      },
    },
    options,
  );
}

export function removeLoopExit(id: string, homeOrOpts?: LoopHomeOrOptions): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  const trimmed = id.trim();
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        exits: current.defaults.exits.filter((a) => a.id !== trimmed),
      },
    },
    options,
  );
}

export function upsertLoopAction(
  artifact: LoopArtifact,
  homeOrOpts?: LoopHomeOrOptions,
): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        actions: upsertInList(current.defaults.actions, artifact),
      },
    },
    options,
  );
}

export function removeLoopAction(id: string, homeOrOpts?: LoopHomeOrOptions): LoopConfig {
  const { current, options } = requireConfig(homeOrOpts);
  const trimmed = id.trim();
  return writeLoopConfig(
    {
      ...current,
      defaults: {
        ...current.defaults,
        actions: current.defaults.actions.filter((a) => a.id !== trimmed),
      },
    },
    options,
  );
}

export function resolveLoopConfig(
  homeOrOpts?: LoopHomeOrOptions,
): ResolvedLoopConfig | undefined {
  const options = normalizeOptions(homeOrOpts);
  const home = options.home ?? defaultHome();
  migrateLegacyLoopIfNeeded(home);

  try {
    const store = getLoopStore(options);
    if (!existsSync(store.configPath)) return undefined;
    const file = readConfigFile(store.configPath);
    const cwd = resolveExistingPath(file.cwd, 'directory', 'cwd');
    const defaults = {
      inputs: normalizeArtifacts(file.defaults.inputs),
      exits: normalizeArtifacts(file.defaults.exits),
      actions: normalizeArtifacts(file.defaults.actions),
    };
    writeConfigToStore({ ...file, cwd, defaults }, store);
    return {
      cwd,
      defaults,
      git: {
        baseBranch: file.git?.baseBranch?.trim() || DEFAULT_LOOP_BASE_BRANCH,
        branchPrefix: file.git?.branchPrefix?.trim() || DEFAULT_LOOP_BRANCH_PREFIX,
      },
      maxIterations: file.maxIterations ?? DEFAULT_LOOP_MAX_ITERATIONS,
      agentTimeoutMs: file.agentTimeoutMs ?? DEFAULT_LOOP_AGENT_TIMEOUT_MS,
      telegramProfile: file.telegramProfile?.trim() || undefined,
      profile: store.profile ?? undefined,
      usingLegacy: store.usingLegacy,
      configPath: store.configPath,
      dirPath: store.dirPath,
      inputsManifestPath: store.inputsManifestPath,
      exitsManifestPath: store.exitsManifestPath,
      actionsManifestPath: store.actionsManifestPath,
    };
  } catch {
    return undefined;
  }
}
