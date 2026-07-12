/**
 * Provider-agnostic conversation mode.
 * Cursor maps these to SDK AgentModeOption ("agent" | "plan").
 */
export const AGENT_RUN_MODES = ['agent', 'plan'] as const;
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];

export const DEFAULT_AGENT_RUN_MODE: AgentRunMode = 'agent';

const MODE_HELP: Record<AgentRunMode, string> = {
  agent: 'Build and edit — full tool use',
  plan: 'Plan first — design before changing code',
};

export function isAgentRunMode(value: string): value is AgentRunMode {
  return (AGENT_RUN_MODES as readonly string[]).includes(value);
}

/** Parse user input for /mode. Throws on unknown values. */
export function parseAgentRunMode(raw: string): AgentRunMode {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Mode is required. Try /mode to list.');
  }
  if (trimmed === 'ask') {
    // Common Cursor UI label; SDK uses "plan" for plan/ask-style turns.
    return 'plan';
  }
  if (isAgentRunMode(trimmed)) return trimmed;
  throw new Error(
    `Unknown mode "${raw}". Use: ${AGENT_RUN_MODES.join(', ')} (alias: ask → plan).`,
  );
}

export function formatModesText(current: AgentRunMode): string {
  const lines = AGENT_RUN_MODES.map((m, i) => {
    const mark = m === current ? ' *' : '';
    return `${i + 1}. ${m}${mark} — ${MODE_HELP[m]}`;
  });
  return [`Current mode: ${current}`, '', ...lines, '', 'Switch with /mode <agent|plan>'].join(
    '\n',
  );
}
