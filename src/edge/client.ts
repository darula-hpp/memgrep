import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { MemoryStore, defaultHome } from '../memory/store.js';
import { readEdgeConfig, type EdgeClientConfig } from './config.js';
import { descriptorsForTools, executeLocalEdgeTool } from './local-tools.js';
import {
  collectUnsyncedChats,
  getSyncedHashCount,
  markHashesSynced,
} from './sync.js';
import {
  parseEdgeMessage,
  type EdgeServerMessage,
} from './protocol.js';

export type EdgeClientStatus = {
  paired: boolean;
  connected: boolean;
  hubUrl: string | null;
  deviceId: string | null;
  tools: string[];
  syncMemory: boolean;
  syncedHashCount: number;
  lastError: string | null;
};

const HEARTBEAT_MS = 30_000;
const RECONNECT_MS = 5_000;
const SYNC_BATCH = 20;

/**
 * Edge-node client: dials out to cloud hub, heartbeats, executes tools, pushes memory.
 */
export class EdgeClient {
  private ws: WebSocket | null = null;
  private running = false;
  private config: EdgeClientConfig | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncInFlight = false;
  private lastError: string | null = null;
  private helloOk = false;
  private readonly home: string;

  constructor(options: { home?: string } = {}) {
    this.home = options.home ?? defaultHome();
  }

  getStatus(): EdgeClientStatus {
    const cfg = this.config ?? readEdgeConfig(this.home);
    return {
      paired: !!cfg,
      connected: !!this.ws && this.ws.readyState === WebSocket.OPEN && this.helloOk,
      hubUrl: cfg?.hubUrl ?? null,
      deviceId: cfg?.deviceId ?? null,
      tools: cfg?.tools ?? [],
      syncMemory: cfg?.syncMemory ?? false,
      syncedHashCount: getSyncedHashCount(this.home),
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.config = readEdgeConfig(this.home);
    if (!this.config) {
      throw new Error(
        'Edge not paired. Run: memgrep edge pair <hub-url> --token <token>',
      );
    }
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.helloOk = false;
  }

  private connect(): void {
    if (!this.running || !this.config) return;
    const url = new URL(this.config.hubUrl);
    url.searchParams.set('token', this.config.token);

    console.error(`memgrep edge: connecting to ${this.config.hubUrl}`);
    const ws = new WebSocket(url.toString());
    this.ws = ws;
    this.helloOk = false;

    ws.on('open', () => {
      this.lastError = null;
      this.send({
        type: 'hello',
        deviceId: this.config!.deviceId,
        token: this.config!.token,
        capabilities: descriptorsForTools(this.config!.tools),
        syncMemory: this.config!.syncMemory,
      });
    });

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      void this.onMessage(raw);
    });

    ws.on('close', () => {
      this.helloOk = false;
      this.clearHeartbeat();
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.lastError = err.message;
      console.error(`memgrep edge: socket error: ${err.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', ts: new Date().toISOString() });
    }, HEARTBEAT_MS);
  }

  private send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private async onMessage(raw: string): Promise<void> {
    const msg = parseEdgeMessage(raw) as EdgeServerMessage | null;
    if (!msg) return;

    if (msg.type === 'hello_ok') {
      this.helloOk = true;
      this.startHeartbeat();
      console.error('memgrep edge: connected (hello_ok)');
      void this.flushMemorySync();
      return;
    }

    if (msg.type === 'error') {
      this.lastError = msg.message;
      console.error(`memgrep edge: hub error: ${msg.message}`);
      return;
    }

    if (msg.type === 'heartbeat_ack') {
      return;
    }

    if (msg.type === 'tool_call') {
      const cfg = this.config ?? readEdgeConfig(this.home);
      if (!cfg) {
        this.send({
          type: 'tool_result',
          id: msg.id,
          ok: false,
          text: 'edge config missing',
          isError: true,
        });
        return;
      }
      const result = await executeLocalEdgeTool(msg.name, msg.arguments ?? {}, cfg);
      this.send({
        type: 'tool_result',
        id: msg.id,
        ok: result.ok,
        text: result.text,
        isError: result.isError,
      });
      return;
    }

    if (msg.type === 'memory_push_ack') {
      this.syncInFlight = false;
      if (msg.error) {
        this.lastError = msg.error;
        console.error(`memgrep edge: memory sync error: ${msg.error}`);
      }
      const done = [...(msg.accepted ?? []), ...(msg.skipped ?? [])];
      if (done.length) markHashesSynced(done, this.home);
      // Continue flushing if more pending.
      void this.flushMemorySync();
    }
  }

  /** Push unsynced local chats to the hub (no-op if sync disabled or offline). */
  async flushMemorySync(): Promise<void> {
    const cfg = this.config ?? readEdgeConfig(this.home);
    if (!cfg?.syncMemory) return;
    if (!this.helloOk || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.syncInFlight) return;

    this.syncInFlight = true;
    try {
      const store = await MemoryStore.open(this.home);
      try {
        const chats = await collectUnsyncedChats(store, this.home, SYNC_BATCH);
        if (chats.length === 0) {
          this.syncInFlight = false;
          return;
        }
        const id = randomUUID();
        console.error(`memgrep edge: pushing ${chats.length} chat(s) to hub`);
        this.send({ type: 'memory_push', id, chats });
        // syncInFlight cleared on memory_push_ack (or error path below).
      } finally {
        store.close();
      }
    } catch (error) {
      this.syncInFlight = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`memgrep edge: sync failed: ${this.lastError}`);
    }
  }
}
