import type { ToolResult } from '../memory/tools.js';
import { defaultHome } from '../memory/store.js';
import { formatLoopStartedAck, startLoopBackground } from './background.js';
import {
  getLoopStore,
  removeLoopAction,
  removeLoopExit,
  removeLoopInput,
  upsertLoopAction,
  upsertLoopExit,
  upsertLoopInput,
  type LoopArtifact,
  type LoopArtifactKind,
  type LoopConfigOptions,
} from './config.js';
import type { LoopService } from './service.js';
import {
  formatLoopRunSnapshot,
  listLoopRuns,
  readLoopRun,
} from './runs.js';

export type LoopToolsOptions = {
  home?: string;
  startBackground?: typeof startLoopBackground;
};

function parseArtifact(input: {
  id: string;
  kind: string;
  value: string;
  label?: string;
  description?: string;
}): LoopArtifact {
  const kind = input.kind as LoopArtifactKind;
  if (!['path', 'url', 'text', 'builtin'].includes(kind)) {
    throw new Error(`kind must be path|url|text|builtin (got ${input.kind})`);
  }
  return {
    id: input.id,
    kind,
    value: input.value,
    label: input.label?.trim() || input.id,
    description: input.description,
  };
}

function scope(home: string, profile?: string): LoopConfigOptions {
  return { home, profile: profile?.trim() || undefined };
}

/**
 * MCP tools for the agnostic coding loop.
 */
export class LoopTools {
  private readonly home: string;
  private readonly startBackground: typeof startLoopBackground;

  constructor(
    private readonly service: LoopService,
    private readonly depsReady: { cursorReady: boolean; jiraReady: boolean },
    options: LoopToolsOptions = {},
  ) {
    this.home = options.home ?? defaultHome();
    this.startBackground = options.startBackground ?? startLoopBackground;
  }

  async status(): Promise<ToolResult> {
    try {
      return { text: this.service.formatStatus(this.depsReady) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async run(input: {
    task: string;
    jiraKey?: string;
    profile?: string;
    inputs?: LoopArtifact[];
    exits?: LoopArtifact[];
    actions?: LoopArtifact[];
    cwd?: string;
    agentId?: string;
    maxIterations?: number;
    query?: string;
    telegramProfile?: string;
    notify?: boolean;
    /** local = this host (default); edge = proxy to connected edge node */
    target?: 'local' | 'edge';
  }): Promise<ToolResult> {
    try {
      const task = input.task?.trim();
      if (!task) throw new Error('task is required (free-text description).');

      if (input.target === 'edge') {
        const { invokeEdgeTool } = await import('../edge/hub.js');
        const result = await invokeEdgeTool(
          'edge_loop_run',
          {
            task,
            jiraKey: input.jiraKey,
            profile: input.profile,
            inputs: input.inputs,
            exits: input.exits,
            actions: input.actions,
            cwd: input.cwd,
            agentId: input.agentId,
            maxIterations: input.maxIterations,
            query: input.query,
            telegramProfile: input.telegramProfile,
            notify: input.notify,
          },
          { timeoutMs: 60_000 },
        );
        return { text: result.text, isError: result.isError || !result.ok };
      }

      if (input.jiraKey?.trim() && !this.depsReady.jiraReady) {
        throw new Error(
          'jiraKey was provided but Jira is not configured. Run: node dist/cli.js jira setup',
        );
      }

      const { meta } = this.startBackground({
        task,
        jiraKey: input.jiraKey,
        profile: input.profile,
        inputs: input.inputs,
        exits: input.exits,
        actions: input.actions,
        cwd: input.cwd,
        agentId: input.agentId,
        maxIterations: input.maxIterations,
        query: input.query,
        telegramProfile: input.telegramProfile,
        notify: input.notify,
        home: this.home,
      });

      return { text: formatLoopStartedAck(meta, this.home) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async runStatus(input: { runId?: string; task?: string; profile?: string } = {}): Promise<ToolResult> {
    try {
      const runId = input.runId?.trim();
      if (runId) {
        const meta = readLoopRun(runId, this.home);
        if (!meta) {
          return { text: `loop run not found: ${runId}`, isError: true };
        }
        return { text: formatLoopRunSnapshot(meta, this.home) };
      }

      const task = input.task?.trim();
      const profile = input.profile?.trim();
      let runs = listLoopRuns(this.home, 50);
      if (profile) runs = runs.filter((r) => r.profile === profile);
      const match = task ? runs.find((r) => r.task === task || r.jiraKey === task) : runs[0];
      if (!match) {
        return {
          text: task
            ? `No loop runs found for task ${task}.`
            : 'No loop runs found under ~/.memgrep/loop-runs.',
          isError: true,
        };
      }
      return { text: formatLoopRunSnapshot(match, this.home) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async upsertInput(input: {
    id: string;
    kind: string;
    value: string;
    label?: string;
    description?: string;
    profile?: string;
  }): Promise<ToolResult> {
    try {
      const opts = scope(this.home, input.profile);
      const config = upsertLoopInput(parseArtifact(input), opts);
      const store = getLoopStore(opts);
      return {
        text:
          `Upserted input ${input.id}. Manifest: ${store.inputsManifestPath}` +
          (store.profile ? ` (profile ${store.profile})` : '') +
          `\nTotal inputs: ${config.defaults.inputs.length}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async removeInput(input: { id: string; profile?: string }): Promise<ToolResult> {
    try {
      const config = removeLoopInput(input.id, scope(this.home, input.profile));
      return { text: `Removed input ${input.id}. Remaining: ${config.defaults.inputs.length}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async upsertExit(input: {
    id: string;
    kind: string;
    value: string;
    label?: string;
    description?: string;
    profile?: string;
  }): Promise<ToolResult> {
    try {
      const opts = scope(this.home, input.profile);
      const config = upsertLoopExit(parseArtifact(input), opts);
      const store = getLoopStore(opts);
      return {
        text:
          `Upserted exit condition ${input.id}. Manifest: ${store.exitsManifestPath}` +
          (store.profile ? ` (profile ${store.profile})` : '') +
          `\nTotal: ${config.defaults.exits.length}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async removeExit(input: { id: string; profile?: string }): Promise<ToolResult> {
    try {
      const config = removeLoopExit(input.id, scope(this.home, input.profile));
      return { text: `Removed exit ${input.id}. Remaining: ${config.defaults.exits.length}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async upsertAction(input: {
    id: string;
    kind: string;
    value: string;
    label?: string;
    description?: string;
    profile?: string;
  }): Promise<ToolResult> {
    try {
      const opts = scope(this.home, input.profile);
      const config = upsertLoopAction(parseArtifact(input), opts);
      const store = getLoopStore(opts);
      return {
        text:
          `Upserted exit action ${input.id}. Manifest: ${store.actionsManifestPath}` +
          (store.profile ? ` (profile ${store.profile})` : '') +
          `\nTotal: ${config.defaults.actions.length}`,
      };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async removeAction(input: { id: string; profile?: string }): Promise<ToolResult> {
    try {
      const config = removeLoopAction(input.id, scope(this.home, input.profile));
      return { text: `Removed action ${input.id}. Remaining: ${config.defaults.actions.length}` };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}
