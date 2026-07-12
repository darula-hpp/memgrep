import { CursorAgentError } from '@cursor/sdk';
import { formatFetchError, isNetworkTimeoutError } from './errors.js';

let installed = false;

/**
 * Keep long-running telegram/jobs processes alive when the Cursor SDK (or undici)
 * emits transient background network failures as unhandled rejections.
 */
export function installTelegramProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    const detail = formatFetchError(reason);
    if (isTransientSdkOrNetworkError(reason, detail)) {
      console.error(`memgrep telegram: ignored background error: ${detail}`);
      return;
    }
    console.error(`memgrep telegram: unhandledRejection: ${detail}`);
  });

  process.on('uncaughtException', (error) => {
    const detail = formatFetchError(error);
    if (isTransientSdkOrNetworkError(error, detail)) {
      console.error(`memgrep telegram: ignored uncaughtException: ${detail}`);
      return;
    }
    // Disk-full transcript writes take down the process; KeepAlive restarts it.
    // Surface a clear hint so operators don't chase model flakes.
    if (/enospc|no space left/i.test(detail)) {
      console.error(
        `memgrep telegram: fatal ENOSPC (disk full) — free space under ~/.cursor or /System/Volumes/Data, then restart telegram: ${detail}`,
      );
      process.exit(1);
    }
    console.error(`memgrep telegram: fatal uncaughtException: ${detail}`);
    process.exit(1);
  });
}

/** Exported for tests — only retryable CursorAgentError / network flakes are transient. */
export function isTransientSdkOrNetworkError(reason: unknown, detail: string): boolean {
  if (isNetworkTimeoutError(reason)) return true;
  const text = detail.toLowerCase();
  if (
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('enotfound') ||
    text.includes('eai_again') ||
    text.includes('socket hang up') ||
    text.includes('fetch failed') ||
    text.includes('[unavailable]') ||
    text.includes('connecterror') ||
    text.includes('network')
  ) {
    return true;
  }
  if (reason instanceof CursorAgentError) {
    return reason.isRetryable === true;
  }
  if (reason && typeof reason === 'object') {
    const name = (reason as { name?: string }).name ?? '';
    const code = (reason as { code?: string | number }).code;
    if (name === 'ConnectError') return true;
    // Non-retryable CursorAgentError must not be treated as transient.
    if (name === 'CursorAgentError') {
      return (reason as { isRetryable?: boolean }).isRetryable === true;
    }
    // connectrpc unavailable = 14
    if (code === 14 || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  }
  return false;
}
