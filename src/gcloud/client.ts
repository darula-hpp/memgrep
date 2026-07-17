import { GoogleAuth } from 'google-auth-library';
import type { ResolvedGcloudConfig } from './config.js';

export const GCLOUD_SCOPES = ['https://www.googleapis.com/auth/cloud-platform.read-only'];

export type GcloudProject = {
  projectId: string;
  name?: string;
  projectNumber?: string;
  lifecycleState?: string;
};

export type GcloudLogEntry = {
  timestamp?: string;
  severity?: string;
  logName?: string;
  textPayload?: string;
  jsonPayload?: unknown;
  resourceType?: string;
  insertId?: string;
};

export type GcloudInstance = {
  name: string;
  zone: string;
  status?: string;
  machineType?: string;
  internalIp?: string;
  externalIp?: string;
  creationTimestamp?: string;
};

type JsonRecord = Record<string, unknown>;

export type GcloudClientOptions = {
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function zoneFromUrl(zoneUrl: string | undefined): string {
  if (!zoneUrl) return '';
  const parts = zoneUrl.split('/');
  return parts[parts.length - 1] || zoneUrl;
}

function machineTypeFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parts = url.split('/');
  return parts[parts.length - 1] || url;
}

function parseInstance(raw: unknown, zoneHint?: string): GcloudInstance | null {
  const rec = asRecord(raw);
  const name = typeof rec.name === 'string' ? rec.name : '';
  if (!name) return null;
  const zone = zoneHint || zoneFromUrl(typeof rec.zone === 'string' ? rec.zone : undefined);
  const nics = Array.isArray(rec.networkInterfaces) ? rec.networkInterfaces : [];
  const nic0 = asRecord(nics[0]);
  const accessConfigs = Array.isArray(nic0.accessConfigs) ? nic0.accessConfigs : [];
  const ac0 = asRecord(accessConfigs[0]);
  return {
    name,
    zone,
    status: typeof rec.status === 'string' ? rec.status : undefined,
    machineType: machineTypeFromUrl(
      typeof rec.machineType === 'string' ? rec.machineType : undefined,
    ),
    internalIp: typeof nic0.networkIP === 'string' ? nic0.networkIP : undefined,
    externalIp: typeof ac0.natIP === 'string' ? ac0.natIP : undefined,
    creationTimestamp:
      typeof rec.creationTimestamp === 'string' ? rec.creationTimestamp : undefined,
  };
}

/**
 * Thin Google Cloud REST client (ADC or service-account JSON via google-auth-library).
 */
export class GcloudClient {
  private auth: GoogleAuth | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessTokenOverride?: () => Promise<string>;

  constructor(
    private readonly config: ResolvedGcloudConfig,
    options: GcloudClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAccessTokenOverride = options.getAccessToken;
  }

  get projectId(): string {
    return this.config.projectId;
  }

  get defaultZone(): string | undefined {
    return this.config.defaultZone;
  }

  private googleAuth(): GoogleAuth {
    if (!this.auth) {
      this.auth = new GoogleAuth({
        scopes: GCLOUD_SCOPES,
        keyFilename: this.config.credentialsPath,
        projectId: this.config.projectId,
      });
    }
    return this.auth;
  }

  async getAccessToken(): Promise<string> {
    if (this.getAccessTokenOverride) {
      return this.getAccessTokenOverride();
    }
    const client = await this.googleAuth().getClient();
    const tokenResponse = await client.getAccessToken();
    const token =
      typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!token) {
      throw new Error(
        'Failed to obtain Google Cloud access token (check ADC or credentialsPath / GOOGLE_APPLICATION_CREDENTIALS).',
      );
    }
    return token;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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
      const nested = asRecord(err.error);
      const message =
        (typeof nested.message === 'string' && nested.message) ||
        (typeof err.message === 'string' && err.message) ||
        (typeof parsed === 'string' ? parsed : '') ||
        res.statusText;
      throw new Error(`GCP ${method} ${url} failed (HTTP ${res.status}): ${message}`);
    }

    return parsed as T;
  }

  async getProject(projectId?: string): Promise<GcloudProject> {
    const id = (projectId?.trim() || this.config.projectId).trim();
    const data = await this.request<JsonRecord>(
      'GET',
      `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(id)}`,
    );
    return {
      projectId: typeof data.projectId === 'string' ? data.projectId : id,
      name: typeof data.name === 'string' ? data.name : undefined,
      projectNumber:
        typeof data.projectNumber === 'string' ? data.projectNumber : undefined,
      lifecycleState:
        typeof data.lifecycleState === 'string' ? data.lifecycleState : undefined,
    };
  }

  async listProjects(): Promise<GcloudProject[]> {
    const data = await this.request<JsonRecord>(
      'GET',
      'https://cloudresourcemanager.googleapis.com/v1/projects',
    );
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const out: GcloudProject[] = [];
    for (const p of projects) {
      const rec = asRecord(p);
      const projectId = typeof rec.projectId === 'string' ? rec.projectId : '';
      if (!projectId) continue;
      out.push({
        projectId,
        name: typeof rec.name === 'string' ? rec.name : undefined,
        projectNumber:
          typeof rec.projectNumber === 'string' ? rec.projectNumber : undefined,
        lifecycleState:
          typeof rec.lifecycleState === 'string' ? rec.lifecycleState : undefined,
      });
    }
    return out;
  }

  async queryLogs(input: {
    filter?: string;
    pageSize?: number;
    projectId?: string;
  } = {}): Promise<GcloudLogEntry[]> {
    const projectId = (input.projectId?.trim() || this.config.projectId).trim();
    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 100);
    const data = await this.request<JsonRecord>(
      'POST',
      'https://logging.googleapis.com/v2/entries:list',
      {
        resourceNames: [`projects/${projectId}`],
        filter: input.filter?.trim() || undefined,
        orderBy: 'timestamp desc',
        pageSize,
      },
    );
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.map((entry) => {
      const rec = asRecord(entry);
      const resource = asRecord(rec.resource);
      return {
        timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : undefined,
        severity: typeof rec.severity === 'string' ? rec.severity : undefined,
        logName: typeof rec.logName === 'string' ? rec.logName : undefined,
        textPayload: typeof rec.textPayload === 'string' ? rec.textPayload : undefined,
        jsonPayload: rec.jsonPayload,
        resourceType: typeof resource.type === 'string' ? resource.type : undefined,
        insertId: typeof rec.insertId === 'string' ? rec.insertId : undefined,
      };
    });
  }

  async listInstances(input: {
    zone?: string;
    projectId?: string;
  } = {}): Promise<GcloudInstance[]> {
    const projectId = (input.projectId?.trim() || this.config.projectId).trim();
    const zone = (input.zone?.trim() || this.config.defaultZone || '').trim();

    if (zone) {
      const data = await this.request<JsonRecord>(
        'GET',
        `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(projectId)}/zones/${encodeURIComponent(zone)}/instances`,
      );
      const items = Array.isArray(data.items) ? data.items : [];
      return items
        .map((item) => parseInstance(item, zone))
        .filter((i): i is GcloudInstance => i !== null);
    }

    const data = await this.request<JsonRecord>(
      'GET',
      `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(projectId)}/aggregated/instances`,
    );
    const items = asRecord(data.items);
    const out: GcloudInstance[] = [];
    for (const [key, value] of Object.entries(items)) {
      const bucket = asRecord(value);
      const zoneName = key.startsWith('zones/') ? key.slice('zones/'.length) : zoneFromUrl(key);
      const list = Array.isArray(bucket.instances) ? bucket.instances : [];
      for (const inst of list) {
        const parsed = parseInstance(inst, zoneName);
        if (parsed) out.push(parsed);
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name) || a.zone.localeCompare(b.zone));
    return out;
  }

  async getInstance(input: {
    name: string;
    zone: string;
    projectId?: string;
  }): Promise<GcloudInstance> {
    const projectId = (input.projectId?.trim() || this.config.projectId).trim();
    const zone = input.zone.trim();
    const name = input.name.trim();
    if (!zone || !name) {
      throw new Error('zone and name are required for getInstance.');
    }
    const data = await this.request<JsonRecord>(
      'GET',
      `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(projectId)}/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(name)}`,
    );
    const parsed = parseInstance(data, zone);
    if (!parsed) {
      throw new Error(`Instance ${name} in ${zone} returned an unexpected payload.`);
    }
    return parsed;
  }
}
