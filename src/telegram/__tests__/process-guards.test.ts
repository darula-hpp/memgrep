import { describe, expect, it, vi, afterEach } from 'vitest';
import { CursorAgentError } from '@cursor/sdk';
import { installTelegramProcessGuards, isTransientSdkOrNetworkError } from '../process-guards.js';

describe('installTelegramProcessGuards', () => {
  afterEach(() => {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('installs without throwing and is idempotent', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => installTelegramProcessGuards()).not.toThrow();
    expect(() => installTelegramProcessGuards()).not.toThrow();
    err.mockRestore();
  });
});

describe('isTransientSdkOrNetworkError', () => {
  it('treats network timeouts as transient', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    });
    expect(isTransientSdkOrNetworkError(err, 'fetch failed — ETIMEDOUT')).toBe(true);
  });

  it('treats retryable CursorAgentError as transient', () => {
    const err = new CursorAgentError('blip', { isRetryable: true });
    expect(isTransientSdkOrNetworkError(err, err.message)).toBe(true);
  });

  it('does not treat non-retryable CursorAgentError as transient', () => {
    const err = new CursorAgentError('bad api key', { isRetryable: false });
    expect(isTransientSdkOrNetworkError(err, err.message)).toBe(false);
  });

  it('treats ConnectError as transient', () => {
    const err = Object.assign(new Error('unavailable'), { name: 'ConnectError', code: 14 });
    expect(isTransientSdkOrNetworkError(err, 'ConnectError — unavailable')).toBe(true);
  });
});
