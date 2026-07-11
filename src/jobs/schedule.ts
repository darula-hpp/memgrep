import { CronExpressionParser } from 'cron-parser';

/**
 * Pluggable schedule backends. v1 ships cron; later: interval, one-shot, calendar.
 */
export interface ScheduleProvider {
  readonly kind: string;
  /** Throw if the expression is invalid. */
  validate(expression: string): void;
  /** Next fire time strictly after `from`. */
  next(expression: string, from: Date): Date;
}

/** Standard 5-field cron (minute hour day-of-month month day-of-week). */
export class CronScheduleProvider implements ScheduleProvider {
  readonly kind = 'cron';

  validate(expression: string): void {
    const trimmed = expression.trim();
    if (!trimmed) throw new Error('Cron expression is required.');
    try {
      CronExpressionParser.parse(trimmed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid cron expression "${expression}": ${detail}`);
    }
  }

  next(expression: string, from: Date): Date {
    const interval = CronExpressionParser.parse(expression.trim(), {
      currentDate: from,
    });
    return interval.next().toDate();
  }
}

const providers = new Map<string, ScheduleProvider>();

export function registerScheduleProvider(provider: ScheduleProvider): void {
  providers.set(provider.kind, provider);
}

export function getScheduleProvider(kind = 'cron'): ScheduleProvider {
  const provider = providers.get(kind);
  if (!provider) {
    throw new Error(`No schedule provider registered for kind "${kind}".`);
  }
  return provider;
}

/** Default cron provider — registered on import. */
registerScheduleProvider(new CronScheduleProvider());
