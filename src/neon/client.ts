import { NEON_API_BASE, type ResolvedNeonConfig } from './config.js';

export type NeonProject = {
  id: string;
  name: string;
  regionId?: string;
  createdAt?: string;
};

export type NeonBranch = {
  id: string;
  name: string;
  projectId: string;
  default: boolean;
  createdAt?: string;
};

export type NeonConnectionUri = {
  uri: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/**
 * Thin Neon Console API client (Bearer API key).
 */
export class NeonClient {
  constructor(private readonly config: ResolvedNeonConfig) {}

  get defaultProjectId(): string | undefined {
    return this.config.defaultProjectId;
  }

  private async request<T>(
    method: string,
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${NEON_API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: 'application/json',
      },
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
      const message =
        (typeof err.message === 'string' && err.message) ||
        (Array.isArray(err.errors) && err.errors.map(String).join('; ')) ||
        (typeof parsed === 'string' ? parsed : '') ||
        res.statusText;
      throw new Error(`Neon API ${method} ${path} failed (HTTP ${res.status}): ${message}`);
    }

    return parsed as T;
  }

  async whoami(): Promise<{ email?: string; id?: string; name?: string }> {
    const data = await this.request<JsonRecord>('GET', '/users/me');
    return {
      id: typeof data.id === 'string' ? data.id : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      name: typeof data.name === 'string' ? data.name : undefined,
    };
  }

  async listProjects(): Promise<NeonProject[]> {
    const data = await this.request<JsonRecord>('GET', '/projects');
    const projects = Array.isArray(data.projects) ? data.projects : [];
    return projects.map((p) => {
      const rec = asRecord(p);
      return {
        id: String(rec.id ?? ''),
        name: String(rec.name ?? ''),
        regionId: typeof rec.region_id === 'string' ? rec.region_id : undefined,
        createdAt: typeof rec.created_at === 'string' ? rec.created_at : undefined,
      };
    });
  }

  async getProject(projectId: string): Promise<NeonProject> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/projects/${encodeURIComponent(projectId)}`,
    );
    const rec = asRecord(data.project ?? data);
    return {
      id: String(rec.id ?? projectId),
      name: String(rec.name ?? ''),
      regionId: typeof rec.region_id === 'string' ? rec.region_id : undefined,
      createdAt: typeof rec.created_at === 'string' ? rec.created_at : undefined,
    };
  }

  async listBranches(projectId: string): Promise<NeonBranch[]> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/branches`,
    );
    const branches = Array.isArray(data.branches) ? data.branches : [];
    return branches.map((b) => {
      const rec = asRecord(b);
      return {
        id: String(rec.id ?? ''),
        name: String(rec.name ?? ''),
        projectId,
        default: Boolean(rec.default),
        createdAt: typeof rec.created_at === 'string' ? rec.created_at : undefined,
      };
    });
  }

  async getConnectionUri(input: {
    projectId: string;
    branchId?: string;
    databaseName?: string;
    roleName?: string;
  }): Promise<NeonConnectionUri> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/projects/${encodeURIComponent(input.projectId)}/connection_uri`,
      {
        branch_id: input.branchId,
        database_name: input.databaseName,
        role_name: input.roleName,
      },
    );
    const uri =
      (typeof data.uri === 'string' && data.uri) ||
      (typeof asRecord(data.connection_uri).uri === 'string'
        ? String(asRecord(data.connection_uri).uri)
        : '');
    if (!uri) {
      throw new Error('Neon connection_uri response missing uri.');
    }
    return { uri };
  }
}
