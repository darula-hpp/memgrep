import { buildSources, ingestTranscripts } from '../memory/ingest.js';
import { MemoryStore } from '../memory/store.js';
import {
  formatInterval,
  resolveIngestDaemonSettings,
  type IngestDaemonConfig,
} from './config.js';

export type IngestDaemonOptions = {
  home?: string;
  /** Override config / default, e.g. `1h` or `15m`. */
  interval?: string;
  sources?: string[];
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** When set, stop after this many sleep cycles (tests). */
  maxCycles?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Long-running loop: start ingest tick → sleep interval → repeat.
 * If a tick is still running when the next interval fires, that cycle is skipped.
 */
export class IngestDaemon {
  private running = false;
  private stopping: Promise<void> | undefined;
  private resolveStop: (() => void) | undefined;
  private tickInFlight: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly options: IngestDaemonOptions = {}) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });

    const settings = resolveIngestDaemonSettings({
      home: this.options.home,
      interval: this.options.interval,
      sources: this.options.sources,
    });
    const sleep = this.options.sleep ?? defaultSleep;
    const sourceLabel = settings.sources?.length
      ? settings.sources.join(',')
      : 'cursor,claude,kiro';

    console.error(
      `memgrep ingest daemon: interval=${formatInterval(settings.intervalMs)} sources=${sourceLabel} home=${settings.home}`,
    );

    let cycles = 0;
    while (this.running) {
      if (this.tickInFlight) {
        console.error('memgrep ingest daemon: previous tick still running; skipping');
      } else {
        this.tickInFlight = this.runTick(settings).finally(() => {
          this.tickInFlight = undefined;
        });
      }

      if (!this.running) break;

      await Promise.race([
        sleep(settings.intervalMs),
        new Promise<void>((resolve) => {
          this.wake = () => {
            this.wake = undefined;
            resolve();
          };
        }),
      ]);
      this.wake = undefined;

      cycles += 1;
      if (this.options.maxCycles != null && cycles >= this.options.maxCycles) {
        this.running = false;
        break;
      }
    }

    if (this.tickInFlight) await this.tickInFlight;
    this.resolveStop?.();
  }

  async stop(): Promise<void> {
    if (!this.running && !this.tickInFlight) {
      await this.stopping;
      return;
    }
    this.running = false;
    this.wake?.();
    this.wake = undefined;
    if (this.tickInFlight) await this.tickInFlight;
    await this.stopping;
  }

  private async runTick(settings: {
    home: string;
    sources?: IngestDaemonConfig['sources'];
  }): Promise<void> {
    const started = new Date().toISOString();
    console.error(`memgrep ingest daemon: tick start ${started}`);
    try {
      const sourceList = buildSources(settings.sources);
      const store = await MemoryStore.open(settings.home);
      try {
        const result = await ingestTranscripts(store, sourceList, (msg) =>
          console.error(`memgrep ingest daemon: ${msg}`),
        );
        await store.persist();
        const perSource = Object.entries(result.bySource)
          .map(([name, count]) => `${name}:${count}`)
          .join(',');
        console.error(
          `memgrep ingest daemon: tick done scanned=${result.scanned} added=${result.added} skipped=${result.skipped}` +
            (perSource ? ` (${perSource})` : ''),
        );
      } finally {
        store.close();
      }
    } catch (error) {
      console.error(
        `memgrep ingest daemon: tick failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

/** Foreground entry used by CLI / LaunchAgent. */
export async function runIngestDaemon(options: IngestDaemonOptions = {}): Promise<void> {
  const daemon = new IngestDaemon(options);
  const shutdown = async () => {
    console.error('memgrep ingest daemon: shutting down…');
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await daemon.start();
}
