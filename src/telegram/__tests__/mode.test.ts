import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_RUN_MODE,
  formatModesText,
  parseAgentRunMode,
} from '../agent/mode.js';

describe('agent run mode', () => {
  it('defaults to agent', () => {
    expect(DEFAULT_AGENT_RUN_MODE).toBe('agent');
  });

  it('parses agent and plan', () => {
    expect(parseAgentRunMode('agent')).toBe('agent');
    expect(parseAgentRunMode('PLAN')).toBe('plan');
    expect(parseAgentRunMode('ask')).toBe('plan');
  });

  it('rejects unknown modes', () => {
    expect(() => parseAgentRunMode('debug')).toThrow(/Unknown mode/);
  });

  it('formats a list with current mark', () => {
    const text = formatModesText('plan');
    expect(text).toContain('Current mode: plan');
    expect(text).toContain('plan *');
    expect(text).toContain('/mode');
  });
});
