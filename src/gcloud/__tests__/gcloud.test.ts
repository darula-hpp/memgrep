import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gcloudConfigPath,
  redactPath,
  resolveGcloudConfig,
  writeGcloudConfig,
} from '../config.js';
import { GcloudClient } from '../client.js';
import { GcloudService } from '../service.js';
import { GcloudTools } from '../tools.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-gcloud-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('resolveGcloudConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolveGcloudConfig({}, home)).toBeUndefined();
  });

  it('reads from file', () => {
    const home = tempHome();
    writeGcloudConfig(
      {
        projectId: 'my-gcp-project',
        credentialsPath: '/tmp/sa.json',
        defaultZone: 'africa-south1-a',
      },
      home,
    );
    const resolved = resolveGcloudConfig({}, home);
    expect(resolved).toMatchObject({
      projectId: 'my-gcp-project',
      credentialsPath: '/tmp/sa.json',
      defaultZone: 'africa-south1-a',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(gcloudConfigPath(home));
  });

  it('lets env override file', () => {
    const home = tempHome();
    writeGcloudConfig({ projectId: 'file-project' }, home);
    const resolved = resolveGcloudConfig(
      {
        GCLOUD_PROJECT: 'env-project',
        GOOGLE_APPLICATION_CREDENTIALS: '/env/sa.json',
      },
      home,
    );
    expect(resolved).toMatchObject({
      projectId: 'env-project',
      credentialsPath: '/env/sa.json',
      source: 'mixed',
    });
  });

  it('accepts GOOGLE_CLOUD_PROJECT', () => {
    const home = tempHome();
    const resolved = resolveGcloudConfig({ GOOGLE_CLOUD_PROJECT: 'alt-project' }, home);
    expect(resolved?.projectId).toBe('alt-project');
    expect(resolved?.source).toBe('env');
  });

  it('throws on corrupt config', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(gcloudConfigPath(home), '{bad', 'utf8');
    expect(() => resolveGcloudConfig({}, home)).toThrow(/Invalid gcloud config/);
  });
});

describe('redactPath', () => {
  it('keeps basename with parent hint', () => {
    expect(redactPath('/Users/me/.config/sa.json')).toMatch(/sa\.json$/);
    expect(redactPath('/Users/me/.config/sa.json')).toContain('…');
  });
});

describe('GcloudClient (mocked fetch)', () => {
  it('queries logs via Logging API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          entries: [
            {
              timestamp: '2026-07-13T10:00:00Z',
              severity: 'ERROR',
              textPayload: 'boom',
              resource: { type: 'gce_instance' },
            },
          ],
        }),
    });
    const client = new GcloudClient(
      {
        projectId: 'p1',
        configPath: '/tmp/gcloud.json',
        source: 'env',
      },
      { getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const entries = await client.queryLogs({ filter: 'severity>=ERROR', pageSize: 5 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textPayload).toBe('boom');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('logging.googleapis.com');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('lists instances for a zone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          items: [
            {
              name: 'web-1',
              zone: 'zones/africa-south1-a',
              status: 'RUNNING',
              machineType: 'zones/africa-south1-a/machineTypes/e2-medium',
              networkInterfaces: [
                {
                  networkIP: '10.0.0.2',
                  accessConfigs: [{ natIP: '1.2.3.4' }],
                },
              ],
            },
          ],
        }),
    });
    const client = new GcloudClient(
      {
        projectId: 'p1',
        defaultZone: 'africa-south1-a',
        configPath: '/tmp/gcloud.json',
        source: 'env',
      },
      { getAccessToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const instances = await client.listInstances();
    expect(instances).toEqual([
      expect.objectContaining({
        name: 'web-1',
        zone: 'africa-south1-a',
        status: 'RUNNING',
        machineType: 'e2-medium',
        internalIp: '10.0.0.2',
        externalIp: '1.2.3.4',
      }),
    ]);
  });
});

describe('GcloudTools', () => {
  function mockClient(overrides: Partial<GcloudClient> = {}): GcloudClient {
    return {
      projectId: 'p1',
      defaultZone: 'africa-south1-a',
      getAccessToken: vi.fn().mockResolvedValue('tok'),
      getProject: vi.fn(),
      listProjects: vi.fn(),
      queryLogs: vi.fn(),
      listInstances: vi.fn(),
      getInstance: vi.fn(),
      ...overrides,
    } as unknown as GcloudClient;
  }

  it('formats projects', async () => {
    const client = mockClient({
      listProjects: vi.fn().mockResolvedValue([
        { projectId: 'p1', name: 'App', lifecycleState: 'ACTIVE' },
      ]),
    });
    const tools = new GcloudTools(new GcloudService(client));
    const result = await tools.listProjects();
    expect(result.text).toContain('p1');
    expect(result.text).toContain('ACTIVE');
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      getInstance: vi.fn().mockRejectedValue(new Error('GCP GET failed (HTTP 404)')),
    });
    const tools = new GcloudTools(new GcloudService(client));
    const result = await tools.getInstance({ name: 'missing', zone: 'africa-south1-a' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/404/);
  });

  it('verify fetches token then project', async () => {
    const client = mockClient({
      getProject: vi.fn().mockResolvedValue({
        projectId: 'p1',
        name: 'App',
        lifecycleState: 'ACTIVE',
      }),
    });
    const service = new GcloudService(client);
    const me = await service.verify();
    expect(me.projectId).toBe('p1');
    expect(client.getAccessToken).toHaveBeenCalled();
  });
});
