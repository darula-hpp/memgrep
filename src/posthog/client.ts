import type { ResolvedPostHogConfig } from './config.js';

export type PostHogProject = {
  id: string;
  name: string;
  uuid?: string;
};

export type PostHogQueryResult = {
  columns: string[];
  results: unknown[][];
  types?: string[];
};

export type PostHogFeatureFlag = {
  id: number;
  key: string;
  name: string;
  active: boolean;
  filters?: unknown;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Thin PostHog private API client (personal API key).
 */
export class PostHogClient {
  private readonly baseUrl: string;

  constructor(private readonly config: ResolvedPostHogConfig) {
    this.baseUrl = `${config.host.replace(/\/+$/, '')}/api`;
  }

  get projectId(): string {
    return this.config.projectId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const err = asRecord(parsed);
      const detail =
        (typeof err.detail === 'string' && err.detail) ||
        (typeof err.error === 'string' && err.error) ||
        (typeof parsed === 'string' ? parsed : '') ||
        res.statusText;
      throw new Error(`PostHog API ${method} ${path} failed (HTTP ${res.status}): ${detail}`);
    }

    return parsed as T;
  }

  async getProject(): Promise<PostHogProject> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/projects/${encodeURIComponent(this.config.projectId)}/`,
    );
    return {
      id: String(data.id ?? this.config.projectId),
      name: String(data.name ?? ''),
      uuid: typeof data.uuid === 'string' ? data.uuid : undefined,
    };
  }

  async query(hogql: string, name?: string): Promise<PostHogQueryResult> {
    const data = await this.request<JsonRecord>(
      'POST',
      `/projects/${encodeURIComponent(this.config.projectId)}/query/`,
      {
        query: {
          kind: 'HogQLQuery',
          query: hogql,
        },
        name: name ?? 'memgrep posthog_query',
      },
    );

    const columns = Array.isArray(data.columns)
      ? data.columns.map((c) => String(c))
      : [];
    const results = Array.isArray(data.results)
      ? (data.results as unknown[][])
      : [];
    const types = Array.isArray(data.types)
      ? data.types.map((t) => String(t))
      : undefined;

    return { columns, results, types };
  }

  async listFeatureFlags(): Promise<PostHogFeatureFlag[]> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/projects/${encodeURIComponent(this.config.projectId)}/feature_flags/`,
      undefined,
      { limit: 100 },
    );
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((row) => {
      const rec = asRecord(row);
      return {
        id: Number(rec.id ?? 0),
        key: String(rec.key ?? ''),
        name: String(rec.name ?? ''),
        active: Boolean(rec.active),
        filters: rec.filters,
      };
    });
  }

  async getFeatureFlag(idOrKey: string): Promise<PostHogFeatureFlag> {
    const trimmed = idOrKey.trim();
    if (/^\d+$/.test(trimmed)) {
      const data = await this.request<JsonRecord>(
        'GET',
        `/projects/${encodeURIComponent(this.config.projectId)}/feature_flags/${trimmed}/`,
      );
      return {
        id: Number(data.id ?? 0),
        key: String(data.key ?? ''),
        name: String(data.name ?? ''),
        active: Boolean(data.active),
        filters: data.filters,
      };
    }

    const flags = await this.listFeatureFlags();
    const match = flags.find((f) => f.key === trimmed);
    if (!match) {
      throw new Error(`Feature flag not found: ${trimmed}`);
    }
    // Fetch full detail by id when available.
    if (match.id) {
      return this.getFeatureFlag(String(match.id));
    }
    return match;
  }
}
