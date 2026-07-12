/**
 * OpenClaw-style Telegram long-poll health defaults.
 * @see https://docs.openclaw.ai/channels/telegram
 */

/** Telegram Bot API `timeout` for getUpdates (seconds). */
export const GET_UPDATES_TIMEOUT_SEC = 30;

/** Client-side abort so a hung getUpdates cannot sit forever (OpenClaw ~45s). */
export const GET_UPDATES_CLIENT_GUARD_MS = 45_000;

/** Restart poll transport after this long without a completed getUpdates. */
export const POLLING_STALL_THRESHOLD_MS = 120_000;

/** How often the stall watchdog checks liveness. */
export const POLLING_WATCHDOG_INTERVAL_MS = 10_000;

export const POLLING_STALL_MIN_MS = 30_000;
export const POLLING_STALL_MAX_MS = 600_000;

export function clampPollingStallThresholdMs(ms: number): number {
  if (!Number.isFinite(ms)) return POLLING_STALL_THRESHOLD_MS;
  return Math.min(POLLING_STALL_MAX_MS, Math.max(POLLING_STALL_MIN_MS, Math.floor(ms)));
}

/** True when no getUpdates has completed within the stall threshold. */
export function isPollingStalled(
  lastCompletedAtMs: number,
  nowMs: number,
  thresholdMs = POLLING_STALL_THRESHOLD_MS,
): boolean {
  const threshold = clampPollingStallThresholdMs(thresholdMs);
  return nowMs - lastCompletedAtMs >= threshold;
}
