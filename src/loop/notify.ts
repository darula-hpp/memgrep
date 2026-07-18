import { TelegramApi } from '../telegram/api.js';
import {
  DEFAULT_TELEGRAM_PROFILE,
  resolveTelegramConfig,
} from '../telegram/config.js';
import { splitForTelegram } from '../memory/tools.js';
import { defaultHome } from '../memory/store.js';
import type { LoopRunMeta } from './runs.js';
import { loopRunLogPath } from './runs.js';

export type LoopNotifyInput = {
  run: LoopRunMeta;
  ok: boolean;
  summary: string;
  prUrl?: string;
  profile?: string;
  home?: string;
};

/**
 * Push loop completion to Telegram. Returns false when no profile — does not throw.
 */
export async function notifyLoopComplete(input: LoopNotifyInput): Promise<boolean> {
  const home = input.home ?? defaultHome();
  const profile = input.profile?.trim() || input.run.telegramProfile || DEFAULT_TELEGRAM_PROFILE;
  const tg = resolveTelegramConfig(process.env, home, profile);
  if (!tg) {
    console.error(
      `memgrep loop: telegram notify skipped (no profile "${profile}"). ` +
        `Run: node dist/cli.js telegram setup ${profile}`,
    );
    return false;
  }

  const status = input.ok ? 'PASS' : 'FAIL';
  const header = [
    `memgrep loop [${status}] ${input.run.task}`,
    `runId: ${input.run.runId}`,
    input.prUrl ? `PR: ${input.prUrl}` : undefined,
    `log: ${loopRunLogPath(input.run.runId, home)}`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const text = `${header}${input.summary}`.trim();
  const api = new TelegramApi(tg.botToken);
  for (const userId of tg.allowedUserIds) {
    for (const chunk of splitForTelegram(text)) {
      await api.sendFormattedMessage(userId, chunk);
    }
  }
  return true;
}
