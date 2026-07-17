import type {
  GcloudClient,
  GcloudInstance,
  GcloudLogEntry,
  GcloudProject,
} from './client.js';

/**
 * Shared Google Cloud business logic for MCP and CLI.
 */
export class GcloudService {
  constructor(private readonly client: GcloudClient) {}

  async verify(): Promise<{
    projectId: string;
    projectName?: string;
    lifecycleState?: string;
  }> {
    await this.client.getAccessToken();
    const project = await this.client.getProject();
    return {
      projectId: project.projectId,
      projectName: project.name,
      lifecycleState: project.lifecycleState,
    };
  }

  async listProjects(): Promise<GcloudProject[]> {
    return this.client.listProjects();
  }

  async queryLogs(input: {
    filter?: string;
    pageSize?: number;
    projectId?: string;
  } = {}): Promise<GcloudLogEntry[]> {
    return this.client.queryLogs(input);
  }

  async listInstances(input: {
    zone?: string;
    projectId?: string;
  } = {}): Promise<GcloudInstance[]> {
    return this.client.listInstances(input);
  }

  async getInstance(input: {
    name: string;
    zone: string;
    projectId?: string;
  }): Promise<GcloudInstance> {
    return this.client.getInstance(input);
  }

  formatProjects(projects: GcloudProject[]): string {
    if (projects.length === 0) return 'No projects found.';
    return projects
      .map((p) => {
        const bits = [p.projectId];
        if (p.name && p.name !== p.projectId) bits.push(`name=${p.name}`);
        if (p.lifecycleState) bits.push(p.lifecycleState);
        return bits.join(' | ');
      })
      .join('\n');
  }

  formatLogEntries(entries: GcloudLogEntry[]): string {
    if (entries.length === 0) return 'No log entries matched.';
    return entries
      .map((e, i) => {
        const header = [
          `#${i + 1}`,
          e.timestamp ?? '?',
          e.severity ?? 'DEFAULT',
          e.resourceType ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        let body = e.textPayload?.trim();
        if (!body && e.jsonPayload !== undefined) {
          try {
            body = JSON.stringify(e.jsonPayload);
          } catch {
            body = String(e.jsonPayload);
          }
        }
        if (!body) body = e.logName ?? '(empty payload)';
        if (body.length > 500) body = `${body.slice(0, 497)}…`;
        return `${header}\n${body}`;
      })
      .join('\n\n');
  }

  formatInstances(instances: GcloudInstance[]): string {
    if (instances.length === 0) return 'No instances found.';
    return instances
      .map((inst) => {
        const bits = [
          inst.name,
          `zone=${inst.zone}`,
          inst.status ?? '',
          inst.machineType ? `type=${inst.machineType}` : '',
          inst.internalIp ? `ip=${inst.internalIp}` : '',
          inst.externalIp ? `ext=${inst.externalIp}` : '',
        ].filter(Boolean);
        return bits.join(' | ');
      })
      .join('\n');
  }

  formatInstance(inst: GcloudInstance): string {
    const lines = [
      `name: ${inst.name}`,
      `zone: ${inst.zone}`,
      `status: ${inst.status ?? '(unknown)'}`,
      `machineType: ${inst.machineType ?? '(unknown)'}`,
      `internalIp: ${inst.internalIp ?? '(none)'}`,
      `externalIp: ${inst.externalIp ?? '(none)'}`,
    ];
    if (inst.creationTimestamp) {
      lines.push(`created: ${inst.creationTimestamp}`);
    }
    return lines.join('\n');
  }
}
