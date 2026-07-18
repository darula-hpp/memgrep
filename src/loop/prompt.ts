import path from 'node:path';
import type { LoopArtifact, ResolvedLoopConfig } from './config.js';
import { mergeArtifacts } from './config.js';
import { LOOP_AGENTS_FILE } from './agents-guide.js';

export type LoopPinnedContext = {
  workspaceCwd: string;
  task: string;
  jiraKey?: string;
  inputsManifestPath: string;
  exitsManifestPath: string;
  actionsManifestPath: string;
  agentsGuidePath: string;
  inputs: LoopArtifact[];
  exits: LoopArtifact[];
  actions: LoopArtifact[];
};

export type LoopStatusTrailer = {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  failures: string;
  prSummary: string;
  deployNotes: string;
  changedFiles: string;
};

export type LoopActionsTrailer = {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  failures: string;
};

function formatArtifactList(title: string, artifacts: LoopArtifact[]): string {
  if (artifacts.length === 0) return `${title}: (none)`;
  return [
    `${title}:`,
    ...artifacts.map(
      (a) =>
        `- ${a.id} [${a.kind}] ${a.label || a.id}: ${a.value}` +
        (a.description ? ` - ${a.description}` : ''),
    ),
  ].join('\n');
}

/** Build the pinned block injected into every Cursor turn. */
export function buildPinnedBlock(pin: LoopPinnedContext): string {
  return [
    'LOOP_PINNED (do not invent alternatives; use these exact values/paths):',
    `- workspaceCwd: ${pin.workspaceCwd}`,
    `- task: ${pin.task}`,
    pin.jiraKey ? `- jiraKey: ${pin.jiraKey}` : undefined,
    `- inputsManifest: ${pin.inputsManifestPath}`,
    `- exitsManifest: ${pin.exitsManifestPath}`,
    `- actionsManifest: ${pin.actionsManifestPath}`,
    `- agentsGuide: ${pin.agentsGuidePath}`,
    '',
    formatArtifactList('Inputs', pin.inputs),
    '',
    formatArtifactList(
      'Exit conditions (code-review rules; must all pass for LOOP_STATUS: PASS)',
      pin.exits,
    ),
    '',
    formatArtifactList('Exit actions (run only after PASS)', pin.actions),
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildPinnedFromConfig(
  config: ResolvedLoopConfig,
  input: {
    task: string;
    jiraKey?: string;
    inputs?: LoopArtifact[];
    exits?: LoopArtifact[];
    actions?: LoopArtifact[];
    workspaceCwd?: string;
  },
): LoopPinnedContext {
  return {
    workspaceCwd: input.workspaceCwd?.trim() || config.cwd,
    task: input.task.trim(),
    jiraKey: input.jiraKey?.trim() || undefined,
    inputsManifestPath: config.inputsManifestPath,
    exitsManifestPath: config.exitsManifestPath,
    actionsManifestPath: config.actionsManifestPath,
    agentsGuidePath: path.join(config.dirPath, LOOP_AGENTS_FILE),
    inputs: mergeArtifacts(config.defaults.inputs, input.inputs),
    exits: mergeArtifacts(config.defaults.exits, input.exits),
    actions: mergeArtifacts(config.defaults.actions, input.actions),
  };
}

function blockField(text: string, prefix: string, name: string): string {
  const re = new RegExp(
    `${prefix}_${name}:\\s*([\\s\\S]*?)(?=\\n${prefix}_[A-Z_]+:|$)`,
    'i',
  );
  const m = text.match(re);
  return m?.[1]?.trim() ?? '';
}

export function parseLoopStatusTrailer(text: string): LoopStatusTrailer {
  const statusRaw = blockField(text, 'LOOP', 'STATUS').toUpperCase();
  const status: LoopStatusTrailer['status'] =
    statusRaw === 'PASS' || statusRaw === 'FAIL' ? statusRaw : 'UNKNOWN';
  return {
    status,
    failures: blockField(text, 'LOOP', 'FAILURES'),
    prSummary: blockField(text, 'LOOP', 'PR_SUMMARY'),
    deployNotes: blockField(text, 'LOOP', 'DEPLOY_NOTES'),
    changedFiles: blockField(text, 'LOOP', 'CHANGED_FILES'),
  };
}

export function parseLoopActionsTrailer(text: string): LoopActionsTrailer {
  const statusRaw = blockField(text, 'LOOP_ACTIONS', 'STATUS').toUpperCase();
  // Also accept LOOP_ACTIONS_STATUS as a single field name via LOOP_ACTIONS + STATUS
  const status: LoopActionsTrailer['status'] =
    statusRaw === 'PASS' || statusRaw === 'FAIL' ? statusRaw : 'UNKNOWN';
  return {
    status,
    failures: blockField(text, 'LOOP_ACTIONS', 'FAILURES'),
  };
}

export function buildImplementPrompt(opts: {
  pin: LoopPinnedContext;
  taskContext: string;
  recallText?: string;
}): string {
  const parts = [
    `You are running memgrep loop for task: ${opts.pin.task}.`,
    'Implement the task in workspaceCwd only.',
    'Read AGENTS.md in the project .memgrep/ folder for how inputs, exits, and actions work.',
    'Read the inputs manifest and each input (paths/URLs/text) before coding.',
    'Treat exit conditions as code-review rules: before PASS, review your changes against every exit (reject yourself if any fail).',
    'Exit actions run later - do not perform them yet.',
    '',
    buildPinnedBlock(opts.pin),
    '',
    '## Task',
    opts.taskContext,
  ];
  if (opts.recallText?.trim()) {
    parts.push('', '## Related memory (memgrep recall)', opts.recallText.trim());
  }
  parts.push(
    '',
    '## End-of-turn trailer (required)',
    'When finished this turn, end your reply with exactly:',
    'LOOP_STATUS: PASS|FAIL',
    'LOOP_FAILURES: <none or list of unmet exit conditions>',
    'LOOP_PR_SUMMARY: <business-clear description of changes>',
    'LOOP_DEPLOY_NOTES: <deploy considerations or None>',
    'LOOP_CHANGED_FILES:',
    '<one repo-relative path per line; ONLY files you created or changed for this task>',
    '',
    'Use PASS only after a code-review pass against every exit condition.',
    'On FAIL, fix what you can this turn and list remaining review failures.',
    'If a github_pr exit action exists, the loop will commit/push ONLY LOOP_CHANGED_FILES.',
  );
  return parts.join('\n');
}

export function buildVerifyPrompt(opts: {
  pin: LoopPinnedContext;
  iteration: number;
  previousFailures: string;
}): string {
  return [
    `Loop verify iteration ${opts.iteration}.`,
    'Enter code-review mode: exit conditions are the review rules for this change.',
    'Re-read AGENTS.md and the exits manifest. Check each exit against the actual diff/behavior.',
    'Fix review failures in workspaceCwd. Do not invent other checklists.',
    'Do not run exit actions yet.',
    '',
    buildPinnedBlock(opts.pin),
    '',
    '## Previous failures',
    opts.previousFailures.trim() || '(none listed)',
    '',
    '## End-of-turn trailer (required)',
    'LOOP_STATUS: PASS|FAIL',
    'LOOP_FAILURES: <none or remaining unmet exit conditions>',
    'LOOP_PR_SUMMARY: <business-clear description>',
    'LOOP_DEPLOY_NOTES: <deploy considerations or None>',
    'LOOP_CHANGED_FILES:',
    '<one repo-relative path per line; ONLY files for this task>',
    '',
    'PASS only when every review rule (exit condition) is met.',
  ].join('\n');
}

export function buildActionsPrompt(opts: {
  pin: LoopPinnedContext;
  agentActions: LoopArtifact[];
}): string {
  return [
    'Loop exit-actions turn.',
    'Coding already PASSed. Execute the non-builtin exit actions below.',
    'Builtin actions (e.g. github_pr) were already handled by memgrep - skip those.',
    'Read the actions manifest. Follow each remaining action exactly.',
    '',
    buildPinnedBlock(opts.pin),
    '',
    formatArtifactList('Actions to execute this turn', opts.agentActions),
    '',
    '## End-of-turn trailer (required)',
    'LOOP_ACTIONS_STATUS: PASS|FAIL',
    'LOOP_ACTIONS_FAILURES: <none or which actions failed>',
  ].join('\n');
}
