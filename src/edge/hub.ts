import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { MemoryStore } from '../memory/store.js';
import { defaultHome } from '../memory/store.js';
import { ensureEdgeHubToken, readEdgeHubConfig } from './config.js';
import { ingestSyncedChats } from './sync.js';
import {
  parseEdgeMessage,
  type EdgeClientMessage,
  type EdgeServerMessage,
  type EdgeToolDescriptor,
} from './protocol.js';

export type EdgePresence = {
  online: boolean;
  deviceId: string | null;
  lastSeen: string | null;
  capabilities: EdgeToolDescriptor[];
  syncMemory: boolean;
  connectedAt: string | null;
};

type PendingCall = {
  resolve: (value: { ok: boolean; text: string; isError?: boolean }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TOOL_TIMEOUT_MS = 90_000;

/**
 * Cloud-side edge registry: one active edge WebSocket, tool proxy, memory ingest.
 * Attached to the HTTP MCP server via upgrade on /edge.
 */
export class EdgeHub {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private deviceId: string | null = null;
  private capabilities: EdgeToolDescriptor[] = [];
  private syncMemory = false;
  private lastSeen: string | null = null;
  private connectedAt: string | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private readonly home: string;
  private store: MemoryStore | null;

  constructor(options: { home?: string; store?: MemoryStore | null } = {}) {
    this.home = options.home ?? defaultHome();
    this.store = options.store ?? null;
  }

  setStore(store: MemoryStore | null): void {
    this.store = store;
  }

  /** Ensure pairing token exists and attach WebSocket upgrade handler. */
  attach(httpServer: HttpServer): void {
    ensureEdgeHubToken(this.home);
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => {
      this.bindSocket(ws);
    });

    httpServer.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    });
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname !== '/edge') {
        socket.destroy();
        return;
      }

      const token =
        url.searchParams.get('token') ??
        bearerFromHeader(req.headers.authorization) ??
        '';
      const expected = readEdgeHubConfig(this.home)?.token;
      if (!expected || token !== expected) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!this.wss) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  }

  private bindSocket(ws: WebSocket): void {
    // Single active edge: replace previous connection.
    if (this.socket && this.socket !== ws) {
      try {
        this.socket.close(4000, 'replaced');
      } catch {
        // ignore
      }
      this.clearPending(new Error('edge connection replaced'));
    }

    this.socket = ws;
    this.connectedAt = new Date().toISOString();
    this.lastSeen = this.connectedAt;

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      void this.onMessage(ws, raw);
    });

    ws.on('close', () => {
      if (this.socket === ws) {
        this.socket = null;
        this.deviceId = null;
        this.capabilities = [];
        this.syncMemory = false;
        this.connectedAt = null;
        this.clearPending(new Error('edge offline'));
      }
    });

    ws.on('error', () => {
      // close handler cleans up
    });
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    const msg = parseEdgeMessage(raw) as EdgeClientMessage | null;
    if (!msg) return;
    this.lastSeen = new Date().toISOString();

    if (msg.type === 'hello') {
      const expected = readEdgeHubConfig(this.home)?.token;
      if (!expected || msg.token !== expected) {
        this.send(ws, { type: 'error', message: 'invalid token' });
        ws.close(4001, 'invalid token');
        return;
      }
      this.deviceId = msg.deviceId;
      this.capabilities = Array.isArray(msg.capabilities) ? msg.capabilities : [];
      this.syncMemory = !!msg.syncMemory;
      this.send(ws, { type: 'hello_ok', serverTime: new Date().toISOString() });
      return;
    }

    if (msg.type === 'heartbeat') {
      this.send(ws, { type: 'heartbeat_ack', ts: msg.ts });
      return;
    }

    if (msg.type === 'tool_result') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve({
        ok: msg.ok,
        text: msg.text,
        isError: msg.isError,
      });
      return;
    }

    if (msg.type === 'memory_push') {
      if (!this.store || !this.deviceId) {
        this.send(ws, {
          type: 'memory_push_ack',
          id: msg.id,
          accepted: [],
          skipped: [],
          error: 'hub store not ready',
        });
        return;
      }
      try {
        const result = await ingestSyncedChats(this.store, this.deviceId, msg.chats ?? []);
        this.send(ws, {
          type: 'memory_push_ack',
          id: msg.id,
          accepted: result.accepted,
          skipped: result.skipped,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.send(ws, {
          type: 'memory_push_ack',
          id: msg.id,
          accepted: [],
          skipped: [],
          error: detail,
        });
      }
    }
  }

  private send(ws: WebSocket, message: EdgeServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private clearPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  isOnline(): boolean {
    return (
      !!this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      !!this.deviceId
    );
  }

  getPresence(): EdgePresence {
    return {
      online: this.isOnline(),
      deviceId: this.deviceId,
      lastSeen: this.lastSeen,
      capabilities: this.capabilities.slice(),
      syncMemory: this.syncMemory,
      connectedAt: this.connectedAt,
    };
  }

  hasCapability(name: string): boolean {
    return this.capabilities.some((c) => c.name === name);
  }

  /**
   * Proxy a tool call to the connected edge node.
   * Rejects with Error('edge offline') when no edge is connected.
   */
  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  ): Promise<{ ok: boolean; text: string; isError?: boolean }> {
    if (!this.isOnline() || !this.socket) {
      throw new Error('edge offline');
    }
    if (!this.hasCapability(name)) {
      return {
        ok: false,
        text: `Edge is online but does not advertise tool ${name}`,
        isError: true,
      };
    }

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`edge tool timeout: ${name}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(this.socket!, {
          type: 'tool_call',
          id,
          name,
          arguments: args,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<void> {
    this.clearPending(new Error('hub closing'));
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
  }
}

function bearerFromHeader(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value.trim());
  return m?.[1] ?? null;
}

let globalHub: EdgeHub | null = null;

export function getEdgeHub(): EdgeHub | null {
  return globalHub;
}

export function setEdgeHub(hub: EdgeHub | null): void {
  globalHub = hub;
}

export function ensureGlobalEdgeHub(options: {
  home?: string;
  store?: MemoryStore | null;
} = {}): EdgeHub {
  if (!globalHub) {
    globalHub = new EdgeHub(options);
  } else if (options.store) {
    globalHub.setStore(options.store);
  }
  return globalHub;
}

/** HTTP status probe for jobs daemon / CLI (uses in-process hub when available). */
export async function fetchEdgeOnline(
  statusUrl: string,
  token?: string,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(statusUrl, { headers });
    if (!res.ok) return false;
    const body = (await res.json()) as { online?: boolean };
    return !!body.online;
  } catch {
    return false;
  }
}

/** Build http://host:port/edge/invoke from an MCP or status URL. */
export function edgeInvokeUrlFromHub(hubHttpOrMcpUrl: string): string {
  const url = new URL(
    /^https?:\/\//i.test(hubHttpOrMcpUrl) ? hubHttpOrMcpUrl : `http://${hubHttpOrMcpUrl}`,
  );
  url.pathname = '/edge/invoke';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export type EdgeInvokeResult = { ok: boolean; text: string; isError?: boolean };

/**
 * Invoke an edge tool via in-process hub, or HTTP POST /edge/invoke on the cloud serve process.
 */
export async function invokeEdgeTool(
  name: string,
  args: Record<string, unknown>,
  options: {
    timeoutMs?: number;
    /** Prefer in-process hub when set / global. */
    hub?: EdgeHub | null;
    /** e.g. http://127.0.0.1:3921/mcp or MEMGREP_MCP_URL */
    hubUrl?: string;
    token?: string;
  } = {},
): Promise<EdgeInvokeResult> {
  const local = options.hub ?? getEdgeHub();
  if (local?.isOnline()) {
    try {
      return await local.invokeTool(name, args, options.timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, text: message, isError: true };
    }
  }

  const hubUrl =
    options.hubUrl ??
    process.env.MEMGREP_EDGE_INVOKE_URL ??
    process.env.MEMGREP_MCP_URL ??
    'http://127.0.0.1:3921/mcp';
  const invokeUrl = hubUrl.includes('/edge/invoke')
    ? hubUrl
    : edgeInvokeUrlFromHub(hubUrl);
  const token =
    options.token ?? process.env.MEMGREP_MCP_TOKEN ?? process.env.MEMGREP_EDGE_HUB_TOKEN;

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(invokeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, arguments: args, timeoutMs: options.timeoutMs }),
    });
    const body = (await res.json()) as EdgeInvokeResult & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        text: body.text ?? body.error ?? `edge invoke HTTP ${res.status}`,
        isError: true,
      };
    }
    return {
      ok: !!body.ok,
      text: body.text ?? '',
      isError: body.isError || !body.ok,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, text: message, isError: true };
  }
}
