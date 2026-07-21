import { EdgeClient } from './client.js';

export type EdgeDaemonOptions = {
  home?: string;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** When set, stop after this many ms (tests). */
  maxMs?: number;
};

/**
 * Long-running edge process: keep WebSocket to cloud hub + periodic memory flush.
 */
export async function runEdgeDaemon(options: EdgeDaemonOptions = {}): Promise<void> {
  const client = new EdgeClient({ home: options.home });
  await client.start();

  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let running = true;

  const onSignal = () => {
    running = false;
    client.stop();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const started = Date.now();
  try {
    while (running) {
      await sleep(60_000);
      if (!running) break;
      if (options.maxMs != null && Date.now() - started >= options.maxMs) break;
      // Periodic sync in case ingest wrote new chats while connected.
      void client.flushMemorySync();
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    client.stop();
  }
}
