import type { CursorAgentService } from '../cursor/service.js';
import type { JiraService } from '../jira/service.js';
import type { MemoryTools } from '../memory/tools.js';
import {
  type LoopArtifact,
  type ResolvedLoopConfig,
} from './config.js';
import {
  buildActionsPrompt,
  buildImplementPrompt,
  buildPinnedBlock,
  buildPinnedFromConfig,
  buildVerifyPrompt,
  parseLoopActionsTrailer,
  parseLoopStatusTrailer,
  type LoopPinnedContext,
  type LoopStatusTrailer,
} from './prompt.js';
import {
  commitPushAndOpenPr,
  snapshotGitDirtyPaths,
  type CommitPushPrResult,
} from './git.js';
import { buildPrBodyFromTemplate, type GhRunner } from './pr.js';

export type LoopRunProgress = {
  iteration: number;
  maxIterations: number;
  agentId?: string;
  status: string;
};

export type LoopRunInput = {
  task: string;
  jiraKey?: string;
  inputs?: LoopArtifact[];
  exits?: LoopArtifact[];
  actions?: LoopArtifact[];
  cwd?: string;
  agentId?: string;
  maxIterations?: number;
  query?: string;
  onProgress?: (progress: LoopRunProgress) => void;
};

export type LoopRunResult = {
  ok: boolean;
  text: string;
  prUrl?: string;
  agentId?: string;
  iterations: number;
  pinned: LoopPinnedContext;
  lastTrailer: LoopStatusTrailer;
};

export type LoopPublishFn = (opts: {
  cwd: string;
  task: string;
  branchPrefix: string;
  baseBranch: string;
  title: string;
  body: string;
  commitMessage: string;
  trailerFiles: string;
  baseline: Set<string>;
  gh?: GhRunner;
}) => Promise<CommitPushPrResult>;

/**
 * Orchestrates: optional Jira enrich → remember → Cursor implement/verify →
 * exit actions (builtins then agent turn).
 */
export class LoopService {
  constructor(
    private readonly config: ResolvedLoopConfig,
    private readonly cursor: CursorAgentService,
    private readonly memory: MemoryTools,
    private readonly jira?: JiraService,
    private readonly gh?: GhRunner,
    private readonly publish: LoopPublishFn = commitPushAndOpenPr,
  ) {}

  formatStatus(extras?: { cursorReady: boolean; jiraReady: boolean }): string {
    const d = this.config.defaults;
    const lines = [
      'loop: configured',
      `  profile:          ${this.config.profile ?? '(legacy)'}`,
      `  cwd:              ${this.config.cwd}`,
      `  inputs:           ${d.inputs.length} (manifest ${this.config.inputsManifestPath})`,
      `  exit conditions:  ${d.exits.length} (manifest ${this.config.exitsManifestPath})`,
      `  exit actions:     ${d.actions.length} (manifest ${this.config.actionsManifestPath})`,
      `  git.baseBranch:   ${this.config.git.baseBranch}`,
      `  git.branchPrefix: ${this.config.git.branchPrefix}`,
      `  maxIterations:    ${this.config.maxIterations}`,
      `  agentTimeoutMs:   ${this.config.agentTimeoutMs}`,
      `  telegramProfile:  ${this.config.telegramProfile ?? '(default)'}`,
      `  config:           ${this.config.configPath}`,
    ];
    if (this.config.usingLegacy) {
      lines.push(
        '  warning:         using legacy ~/.memgrep/loop.json — run loop init <name>',
      );
    }
    if (d.inputs.length) {
      lines.push('', 'Default inputs:');
      for (const a of d.inputs) lines.push(`  - ${a.id} [${a.kind}] ${a.value}`);
    }
    if (d.exits.length) {
      lines.push('', 'Default exit conditions:');
      for (const a of d.exits) lines.push(`  - ${a.id}: ${a.value.slice(0, 120)}`);
    }
    if (d.actions.length) {
      lines.push('', 'Default exit actions:');
      for (const a of d.actions) lines.push(`  - ${a.id} [${a.kind}] ${a.value}`);
    }
    if (extras) {
      lines.push('', `  cursorReady:      ${extras.cursorReady}`);
      lines.push(`  jiraReady:        ${extras.jiraReady}`);
    }
    lines.push(
      '',
      'Tools: loop_status, loop_run, loop_run_status, loop_upsert_*/loop_remove_* for defaults.',
    );
    return lines.join('\n');
  }

  async run(input: LoopRunInput): Promise<LoopRunResult> {
    const task = input.task?.trim();
    if (!task) throw new Error('task is required (free-text description of the work).');

    const jiraKey = input.jiraKey?.trim() || undefined;
    if (jiraKey && !this.jira) {
      throw new Error(
        'jiraKey was provided but Jira is not configured. Run: node dist/cli.js jira setup',
      );
    }

    let workspaceCwd = this.config.cwd;
    if (input.cwd?.trim()) {
      workspaceCwd = this.cursor.resolveCwd(input.cwd);
    } else {
      workspaceCwd = this.cursor.resolveCwd(this.config.cwd);
    }

    const pin = buildPinnedFromConfig(this.config, {
      task,
      jiraKey,
      inputs: input.inputs,
      exits: input.exits,
      actions: input.actions,
      workspaceCwd,
    });

    let taskContext = task;
    if (jiraKey && this.jira) {
      const issue = await this.jira.getIssue(jiraKey);
      taskContext = [`Task: ${task}`, '', `## Jira ${jiraKey}`, this.jira.formatIssue(issue)].join(
        '\n',
      );
    }

    await this.memory.remember({
      title: jiraKey || task.slice(0, 80),
      project: 'loop',
      text: taskContext,
    });

    let recallText: string | undefined;
    if (input.query?.trim()) {
      const recalled = await this.memory.recall({ query: input.query.trim(), k: 5 });
      if (!recalled.isError) recallText = recalled.text;
    }

    const maxIterations = input.maxIterations ?? this.config.maxIterations;
    let agentId = input.agentId?.trim() || undefined;
    let lastTrailer: LoopStatusTrailer = {
      status: 'UNKNOWN',
      failures: '',
      prSummary: '',
      deployNotes: '',
      changedFiles: '',
    };
    const iterationLog: string[] = [];

    let baseline = new Set<string>();
    try {
      baseline = await snapshotGitDirtyPaths(workspaceCwd);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      iterationLog.push(`(git baseline snapshot skipped: ${msg})`);
    }

    for (let i = 1; i <= maxIterations; i++) {
      const prompt =
        i === 1
          ? buildImplementPrompt({ pin, taskContext, recallText })
          : buildVerifyPrompt({
              pin,
              iteration: i,
              previousFailures: lastTrailer.failures || '(none)',
            });

      const turn = await this.cursor.run({
        prompt,
        cwd: workspaceCwd,
        agentId,
        timeoutMs: this.config.agentTimeoutMs,
      });
      agentId = turn.agentId;
      lastTrailer = parseLoopStatusTrailer(turn.text);
      iterationLog.push(
        `--- iteration ${i}/${maxIterations} ok=${turn.ok} LOOP_STATUS=${lastTrailer.status} ---`,
        turn.text.slice(0, 4000),
      );
      input.onProgress?.({
        iteration: i,
        maxIterations,
        agentId,
        status: lastTrailer.status,
      });

      if (!turn.ok) {
        return {
          ok: false,
          text: [
            'loop failed: Cursor turn error.',
            buildPinnedBlock(pin),
            '',
            ...iterationLog,
          ].join('\n'),
          agentId,
          iterations: i,
          pinned: pin,
          lastTrailer,
        };
      }

      if (lastTrailer.status === 'PASS') break;

      if (i === maxIterations) {
        return {
          ok: false,
          text: [
            `loop stopped: maxIterations=${maxIterations} without PASS.`,
            buildPinnedBlock(pin),
            '',
            `Last failures: ${lastTrailer.failures || '(none parsed)'}`,
            '',
            ...iterationLog,
          ].join('\n'),
          agentId,
          iterations: i,
          pinned: pin,
          lastTrailer,
        };
      }
    }

    if (lastTrailer.status !== 'PASS') {
      return {
        ok: false,
        text: ['loop ended without PASS.', buildPinnedBlock(pin), '', ...iterationLog].join('\n'),
        agentId,
        iterations: iterationLog.length,
        pinned: pin,
        lastTrailer,
      };
    }

    // Post-PASS exit actions
    const actionResult = await this.runExitActions({
      pin,
      workspaceCwd,
      task: jiraKey || task,
      lastTrailer,
      baseline,
      agentId,
      iterationLog,
    });
    return actionResult;
  }

  private async runExitActions(opts: {
    pin: LoopPinnedContext;
    workspaceCwd: string;
    task: string;
    lastTrailer: LoopStatusTrailer;
    baseline: Set<string>;
    agentId?: string;
    iterationLog: string[];
  }): Promise<LoopRunResult> {
    const { pin, workspaceCwd, task, lastTrailer, baseline, iterationLog } = opts;
    let agentId = opts.agentId;
    let prUrl: string | undefined;
    const actionLog: string[] = [];

    const builtins = pin.actions.filter((a) => a.kind === 'builtin');
    const agentActions = pin.actions.filter((a) => a.kind !== 'builtin');

    for (const action of builtins) {
      if (action.value === 'github_pr') {
        try {
          const published = await this.runGithubPrBuiltin({
            pin,
            workspaceCwd,
            task,
            lastTrailer,
            baseline,
          });
          prUrl = published.prUrl;
          actionLog.push(
            `builtin github_pr OK: ${published.prUrl} files=${published.files.join(', ')}`,
          );
          if (published.warnings.length) {
            actionLog.push(`warnings: ${published.warnings.join('; ')}`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            text: [
              `loop coding PASS but exit action github_pr failed: ${msg}`,
              '',
              buildPinnedBlock(pin),
              '',
              ...iterationLog,
              '',
              ...actionLog,
            ].join('\n'),
            agentId,
            iterations: iterationLog.length,
            pinned: pin,
            lastTrailer,
          };
        }
      } else {
        return {
          ok: false,
          text: `Unknown builtin exit action: ${action.value}`,
          agentId,
          iterations: iterationLog.length,
          pinned: pin,
          lastTrailer,
        };
      }
    }

    if (agentActions.length > 0) {
      const prompt = buildActionsPrompt({ pin, agentActions });
      const turn = await this.cursor.run({
        prompt,
        cwd: workspaceCwd,
        agentId,
        timeoutMs: this.config.agentTimeoutMs,
      });
      agentId = turn.agentId;
      const actionsTrailer = parseLoopActionsTrailer(turn.text);
      actionLog.push(
        `--- actions turn ok=${turn.ok} LOOP_ACTIONS_STATUS=${actionsTrailer.status} ---`,
        turn.text.slice(0, 4000),
      );
      if (!turn.ok || actionsTrailer.status !== 'PASS') {
        return {
          ok: false,
          text: [
            'loop coding PASS but exit actions failed.',
            actionsTrailer.failures || '(no LOOP_ACTIONS_FAILURES parsed)',
            '',
            buildPinnedBlock(pin),
            '',
            ...iterationLog,
            '',
            ...actionLog,
          ].join('\n'),
          prUrl,
          agentId,
          iterations: iterationLog.length,
          pinned: pin,
          lastTrailer,
        };
      }
    }

    return {
      ok: true,
      text: [
        `loop PASS for ${pin.task}.`,
        prUrl ? `PR: ${prUrl}` : undefined,
        '',
        buildPinnedBlock(pin),
        '',
        ...iterationLog,
        '',
        ...actionLog,
      ]
        .filter(Boolean)
        .join('\n'),
      prUrl,
      agentId,
      iterations: iterationLog.length,
      pinned: pin,
      lastTrailer,
    };
  }

  private async runGithubPrBuiltin(opts: {
    pin: LoopPinnedContext;
    workspaceCwd: string;
    task: string;
    lastTrailer: LoopStatusTrailer;
    baseline: Set<string>;
  }): Promise<CommitPushPrResult> {
    const template =
      opts.pin.inputs.find((i) => i.id === 'prTemplate') ||
      opts.pin.inputs.find((i) => i.kind === 'path' && /pr.?template/i.test(i.id));
    if (!template || template.kind !== 'path') {
      throw new Error(
        'builtin github_pr requires a path input with id "prTemplate" (or id matching pr template).',
      );
    }

    const body = buildPrBodyFromTemplate({
      templatePath: template.value,
      task: opts.task,
      prSummary: opts.lastTrailer.prSummary,
      deployNotes: opts.lastTrailer.deployNotes,
    });
    const summaryLine =
      opts.lastTrailer.prSummary.trim().split(/\r?\n/)[0]?.trim().slice(0, 72) || opts.task;
    const commitMessage = `${opts.task}: ${summaryLine}`;

    return this.publish({
      cwd: opts.workspaceCwd,
      task: opts.task.replace(/\s+/g, '-').slice(0, 80),
      branchPrefix: this.config.git.branchPrefix,
      baseBranch: this.config.git.baseBranch,
      title: opts.task.slice(0, 120),
      body,
      commitMessage,
      trailerFiles: opts.lastTrailer.changedFiles,
      baseline: opts.baseline,
      gh: this.gh,
    });
  }
}
