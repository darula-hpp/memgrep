import { TelegramApi } from '../telegram/api.js';
import { splitForTelegram } from '../memory/tools.js';
import type { Job, JobExecuteResult } from './types.js';

/**
 * Pluggable notifiers. v1: Telegram; later: email, webhook, desktop.
 */
export interface JobNotifier {
  readonly kind: string;
  notify(job: Job, result: JobExecuteResult, meta: { scheduledAt: string; manual?: boolean }): Promise<void>;
}

export class NoopNotifier implements JobNotifier {
  readonly kind = 'noop';
  async notify(): Promise<void> {}
}

export type TelegramNotifierOptions = {
  botToken: string;
  /** Recipients (allowlisted user ids from the telegram profile). */
  userIds: number[];
};

export class TelegramJobNotifier implements JobNotifier {
  readonly kind = 'telegram';
  private readonly api: TelegramApi;

  constructor(private readonly options: TelegramNotifierOptions) {
    this.api = new TelegramApi(options.botToken);
  }

  async notify(
    job: Job,
    result: JobExecuteResult,
    meta: { scheduledAt: string; manual?: boolean },
  ): Promise<void> {
    if (this.options.userIds.length === 0) return;

    const status = result.ok ? 'ok' : 'failed';
    const header = [
      `memgrep job [${status}] ${job.name}`,
      `id: ${job.id}`,
      `scheduled: ${meta.scheduledAt}${meta.manual ? ' (manual)' : ''}`,
      `mode: ${job.mode}`,
      '',
    ].join('\n');

    const body = result.ok
      ? result.summary
      : `${result.error ?? 'unknown error'}${result.summary ? `\n\n${result.summary}` : ''}`;

    const text = `${header}${body}`.trim();
    for (const userId of this.options.userIds) {
      for (const chunk of splitForTelegram(text)) {
        await this.api.sendMessage(userId, chunk);
      }
    }
  }
}

export class NotifierRegistry {
  private readonly map = new Map<string, JobNotifier>();

  register(notifier: JobNotifier): void {
    this.map.set(notifier.kind, notifier);
  }

  get(kind: string): JobNotifier {
    return this.map.get(kind) ?? new NoopNotifier();
  }
}
