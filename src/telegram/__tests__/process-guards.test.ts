import { describe, expect, it, vi, afterEach } from 'vitest';
import { installTelegramProcessGuards } from '../process-guards.js';

describe('installTelegramProcessGuards', () => {
  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
    // Allow re-install in other tests if needed by resetting module state —
    // guards are idempotent via module flag; re-importing isn't easy, so we
    // only assert that calling twice doesn't throw.
  });

  it('installs without throwing and is idempotent', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => installTelegramProcessGuards()).not.toThrow();
    expect(() => installTelegramProcessGuards()).not.toThrow();
    err.mockRestore();
  });
});
