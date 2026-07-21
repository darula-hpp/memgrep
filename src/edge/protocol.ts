/** Wire protocol for edge node ↔ cloud hub (JSON text frames over WebSocket). */

export type EdgeToolDescriptor = {
  name: string;
  description: string;
};

export type SyncChatPayload = {
  title: string;
  project: string;
  content: string;
  /** Original Mac source path or note id (hashed into cloud source). */
  source?: string | null;
  tool?: string;
  cursorAgentId?: string;
  createdAt?: string;
  /** Content sha256 on Mac; used for idempotent upsert + sync ack. */
  hash: string;
};

export type EdgeHelloMessage = {
  type: 'hello';
  deviceId: string;
  token: string;
  capabilities: EdgeToolDescriptor[];
  syncMemory: boolean;
};

export type EdgeHelloOkMessage = {
  type: 'hello_ok';
  serverTime: string;
};

export type EdgeHeartbeatMessage = {
  type: 'heartbeat';
  ts: string;
};

export type EdgeHeartbeatAckMessage = {
  type: 'heartbeat_ack';
  ts: string;
};

export type EdgeToolCallMessage = {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type EdgeToolResultMessage = {
  type: 'tool_result';
  id: string;
  ok: boolean;
  text: string;
  isError?: boolean;
};

export type EdgeMemoryPushMessage = {
  type: 'memory_push';
  id: string;
  chats: SyncChatPayload[];
};

export type EdgeMemoryPushAckMessage = {
  type: 'memory_push_ack';
  id: string;
  accepted: string[];
  skipped: string[];
  error?: string;
};

export type EdgeErrorMessage = {
  type: 'error';
  message: string;
};

export type EdgeClientMessage =
  | EdgeHelloMessage
  | EdgeHeartbeatMessage
  | EdgeToolResultMessage
  | EdgeMemoryPushMessage;

export type EdgeServerMessage =
  | EdgeHelloOkMessage
  | EdgeHeartbeatAckMessage
  | EdgeToolCallMessage
  | EdgeMemoryPushAckMessage
  | EdgeErrorMessage;

export function parseEdgeMessage(raw: string): EdgeClientMessage | EdgeServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string };
    if (!parsed || typeof parsed.type !== 'string') return null;
    return parsed as EdgeClientMessage | EdgeServerMessage;
  } catch {
    return null;
  }
}

/** Convert an MCP/http(s) hub URL to the edge WebSocket URL. */
export function hubHttpToWsUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    if (/^wss?:\/\//i.test(trimmed)) {
      url = new URL(trimmed);
    } else if (/^https?:\/\//i.test(trimmed)) {
      url = new URL(trimmed);
    } else {
      url = new URL(`http://${trimmed}`);
    }
  } catch {
    throw new Error(`Invalid hub URL: ${input}`);
  }

  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported hub URL protocol: ${url.protocol}`);
  }

  // Strip /mcp suffix if present; edge lives at /edge.
  if (url.pathname === '/mcp' || url.pathname.endsWith('/mcp')) {
    url.pathname = url.pathname.replace(/\/mcp\/?$/, '/edge');
  } else if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/edge';
  } else if (!url.pathname.endsWith('/edge')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/edge`;
  }
  return url.toString();
}

/** HTTP base for status checks (same host as WS hub). */
export function hubWsToHttpStatusUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  url.pathname = '/edge/status';
  url.search = '';
  url.hash = '';
  return url.toString();
}
