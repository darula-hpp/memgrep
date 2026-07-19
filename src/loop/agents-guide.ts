import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../fs/atomic-write.js';

export const LOOP_AGENTS_FILE = 'AGENTS.md';

/** Built-in guide copied into loop.base and each project `.memgrep/`. */
export function defaultAgentsMarkdown(): string {
  return `# memgrep loop - guide for agents

This folder is the **project-local loop store**. Edit these files in the IDE; they are what the coding loop pins into every Cursor turn.

## Layout

| File | Purpose |
| --- | --- |
| \`loop.json\` | cwd, git defaults, maxIterations, and default inputs / exits / actions |
| \`inputs.manifest.md\` | Human-readable list of default inputs (regenerated on upsert) |
| \`exits.manifest.md\` | Exit conditions (code-review rules) that must all pass for \`LOOP_STATUS: PASS\` |
| \`actions.manifest.md\` | Post-PASS actions (builtins like \`github_pr\`, then agent actions) |
| \`AGENTS.md\` | This guide |

Global template (do not edit per project): \`~/.memgrep/loop.base/\`.  
Named home pointer: \`~/.memgrep/loops/<profile>/project.json\` → this project.

## Artifact kinds

Every input, exit, and action is an artifact:

- \`path\` - file or directory the agent must use (absolute or expand \`~\`)
- \`url\` - URL to fetch / follow
- \`text\` - free-text instruction or acceptance criterion
- \`builtin\` - memgrep-handled action (currently: \`github_pr\`)

Stable \`id\` values. Optional \`label\` / \`description\`.

## How to add items (CLI)

From any shell (uses active profile, or pass \`--profile\`):

\`\`\`bash
memgrep loop input set --id architecture --kind path --value docs/architecture.md --label Architecture
memgrep loop exit set --id tests --kind text --value "All tests pass"
memgrep loop action set --id github_pr --kind builtin --value github_pr

memgrep loop input rm <id>
memgrep loop exit rm <id>
memgrep loop action rm <id>
\`\`\`

Or edit \`loop.json\` defaults, then run an upsert / \`loop setup\` so manifests regenerate.

## How to add items (MCP)

When memgrep MCP is attached:

- \`loop_upsert_input\` / \`loop_remove_input\`
- \`loop_upsert_exit\` / \`loop_remove_exit\`
- \`loop_upsert_action\` / \`loop_remove_action\`
- \`loop_status\` - show cwd, counts, paths
- \`loop_run\` - start detached run (\`task\` required; optional \`profile\`, \`jiraKey\`)
- \`loop_run_status\` - inspect a run

## Exit conditions = code review rules

Treat exits as a PR review checklist, not vague goals. Before \`PASS\`:

- Switch into **code-review mode** against the exits (and the real diff/behavior).
- Reject the change yourself if any exit fails; list failures under \`LOOP_FAILURES\`.
- Do not invent extra review criteria beyond the exits (plus the task).

## What the loop expects from you

1. Read **LOOP_PINNED** and the manifests under this \`.memgrep/\` directory.
2. Work only in \`workspaceCwd\`.
3. Do **not** run exit actions until coding has PASSed (memgrep runs builtins, then an actions turn).
4. End implement/verify turns with:

\`\`\`text
LOOP_STATUS: PASS|FAIL
LOOP_FAILURES: <none or unmet exits>
LOOP_PR_SUMMARY: <clear summary>
LOOP_DEPLOY_NOTES: <notes or None>
LOOP_CHANGED_FILES:
<path relative to repo>
\`\`\`

5. Use \`PASS\` only after a code-review pass where **every** exit condition is satisfied.
6. List only files you created or changed for this task under \`LOOP_CHANGED_FILES\` (used by \`github_pr\`).

## Suggested defaults for a new project

\`\`\`bash
memgrep loop exit set --id done --kind text --value "Task complete and verified"
memgrep loop action set --id github_pr --kind builtin --value github_pr
\`\`\`

Adjust \`git.baseBranch\` / \`branchPrefix\` via \`memgrep loop setup\` or \`loop.json\`.
`;
}

/**
 * Ensure AGENTS.md exists under a loop store directory (base or project .memgrep).
 * Does not overwrite an existing file (projects may customize the guide).
 */
export function ensureAgentsGuide(dirPath: string, force = false): string {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  const filePath = path.join(dirPath, LOOP_AGENTS_FILE);
  if (!force && existsSync(filePath)) return filePath;
  writeFileAtomic(filePath, defaultAgentsMarkdown(), { mode: 0o600 });
  return filePath;
}
