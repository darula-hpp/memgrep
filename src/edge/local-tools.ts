import { spawn } from 'node:child_process';
import path from 'node:path';
import type { EdgeClientConfig, EdgeToolName } from './config.js';
import type { EdgeToolDescriptor } from './protocol.js';

const TOOL_DESCRIPTIONS: Record<EdgeToolName, string> = {
  edge_ping: 'Ping the edge node; returns device id and ok when connected.',
  edge_run:
    'Run an allowlisted local command on the edge node (local shell / GUI host). ' +
    'argv[0] must match edge.json runAllowlist (basename or absolute path).',
  edge_loop_run:
    'Start a coding loop on the edge node in the background (uses local Cursor + loop profile). ' +
    'Returns runId immediately; completion notifies via Telegram when configured on the edge.',
  edge_cursor_run:
    'Run a one-shot Cursor agent turn on the edge node (blocking until the turn finishes).',
};

export function descriptorsForTools(tools: EdgeToolName[]): EdgeToolDescriptor[] {
  return tools.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
  }));
}

export function isCommandAllowlisted(argv0: string, allowlist: string[]): boolean {
  if (!argv0 || allowlist.length === 0) return false;
  const base = path.basename(argv0);
  return allowlist.some((entry) => entry === argv0 || entry === base);
}

async function runAllowlistedCommand(
  argv: string[],
  allowlist: string[],
  cwd?: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; text: string; isError?: boolean }> {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== 'string') {
    return { ok: false, text: 'edge_run requires non-empty argv string array', isError: true };
  }
  if (!isCommandAllowlisted(argv[0], allowlist)) {
    return {
      ok: false,
      text: `Command not allowlisted: ${argv[0]}. Update ~/.memgrep/edge.json runAllowlist.`,
      isError: true,
    };
  }

  return new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: cwd || process.cwd(),
      env: process.env,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        ok: false,
        text: `edge_run timed out after ${timeoutMs}ms`,
        isError: true,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, text: err.message, isError: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || `(exit ${code})`;
      if (code === 0) resolve({ ok: true, text });
      else resolve({ ok: false, text, isError: true });
    });
  });
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function runEdgeLoop(args: Record<string, unknown>): Promise<{
  ok: boolean;
  text: string;
  isError?: boolean;
}> {
  const task = optString(args.task);
  if (!task) return { ok: false, text: 'edge_loop_run.task is required', isError: true };

  try {
    const { startLoopBackground, formatLoopStartedAck } = await import('../loop/background.js');
    const { meta } = startLoopBackground({
      task,
      jiraKey: optString(args.jiraKey),
      profile: optString(args.profile),
      inputs: Array.isArray(args.inputs) ? (args.inputs as never) : undefined,
      exits: Array.isArray(args.exits) ? (args.exits as never) : undefined,
      actions: Array.isArray(args.actions) ? (args.actions as never) : undefined,
      cwd: optString(args.cwd),
      agentId: optString(args.agentId),
      maxIterations:
        typeof args.maxIterations === 'number' && Number.isFinite(args.maxIterations)
          ? args.maxIterations
          : undefined,
      query: optString(args.query),
      telegramProfile: optString(args.telegramProfile),
      notify: typeof args.notify === 'boolean' ? args.notify : undefined,
    });
    return {
      ok: true,
      text: `[edge] ${formatLoopStartedAck(meta)}`,
    };
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

async function runEdgeCursor(args: Record<string, unknown>): Promise<{
  ok: boolean;
  text: string;
  isError?: boolean;
}> {
  const prompt = optString(args.prompt);
  const cwd = optString(args.cwd);
  if (!prompt) return { ok: false, text: 'edge_cursor_run.prompt is required', isError: true };
  if (!cwd) return { ok: false, text: 'edge_cursor_run.cwd is required', isError: true };

  try {
    const { existsSync } = await import('node:fs');
    if (!existsSync(cwd)) {
      return { ok: false, text: `cwd does not exist on edge: ${cwd}`, isError: true };
    }
    const { resolveCursorConfig } = await import('../cursor/config.js');
    const { createCursorProvider } = await import('../cursor/providers/cursor.js');
    const { runAgentTurn } = await import('../cursor/runner.js');
    const config = resolveCursorConfig();
    if (!config?.apiKey) {
      return {
        ok: false,
        text: 'Cursor not configured on edge. Run: memgrep cursor setup',
        isError: true,
      };
    }
    const { DEFAULT_CURSOR_MODEL } = await import('../telegram/config.js');
    const model = optString(args.model) ?? config.model ?? DEFAULT_CURSOR_MODEL;
    // Prefer caller-provided hub MCP; else local serve if present.
    const mcpUrl =
      optString(args.mcpUrl) ??
      process.env.MEMGREP_MCP_URL ??
      'http://127.0.0.1:3921/mcp';
    const mcpToken = optString(args.mcpToken) ?? process.env.MEMGREP_MCP_TOKEN;
    const provider = createCursorProvider();
    const session = await provider.create({
      apiKey: config.apiKey,
      cwd,
      model,
      mcpUrl,
      mcpToken,
      name: 'memgrep-edge-cursor'.slice(0, 64),
    });
    try {
      const turn = await runAgentTurn(session, prompt, {
        providerId: provider.id,
        isRetryableError: (e) => provider.isRetryableError?.(e) === true,
        logPrefix: 'memgrep edge',
      });
      if (!turn.ok) return { ok: false, text: turn.text, isError: true };
      return { ok: true, text: turn.text };
    } finally {
      await session.dispose();
    }
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

/** Execute a tool on the edge node (allowlist enforced for edge_run). */
export async function executeLocalEdgeTool(
  name: string,
  args: Record<string, unknown>,
  config: EdgeClientConfig,
): Promise<{ ok: boolean; text: string; isError?: boolean }> {
  if (!config.tools.includes(name as EdgeToolName)) {
    return {
      ok: false,
      text: `Tool ${name} is not enabled on this edge (tools=${config.tools.join(',') || 'none'})`,
      isError: true,
    };
  }

  if (name === 'edge_ping') {
    return {
      ok: true,
      text: JSON.stringify({
        ok: true,
        deviceId: config.deviceId,
        tools: config.tools,
        syncMemory: config.syncMemory,
      }),
    };
  }

  if (name === 'edge_run') {
    const argv = args.argv;
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
      return { ok: false, text: 'edge_run.argv must be string[]', isError: true };
    }
    const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;
    const timeoutMs =
      typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
        ? Math.min(Math.max(args.timeoutMs, 1000), 300_000)
        : 60_000;
    return runAllowlistedCommand(argv as string[], config.runAllowlist, cwd, timeoutMs);
  }

  if (name === 'edge_loop_run') {
    return runEdgeLoop(args);
  }

  if (name === 'edge_cursor_run') {
    return runEdgeCursor(args);
  }

  return { ok: false, text: `Unknown edge tool: ${name}`, isError: true };
}
