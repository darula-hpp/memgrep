import type { NeonBranch, NeonClient, NeonProject } from './client.js';

/**
 * Shared Neon business logic for MCP and CLI.
 */
export class NeonService {
  constructor(private readonly client: NeonClient) {}

  async verify(): Promise<{
    email?: string;
    id?: string;
    name?: string;
    projectCount: number;
    projectId?: string;
    projectName?: string;
  }> {
    // Prefer a known project id: default, or extract from scoped-key errors.
    const preferredId = this.client.defaultProjectId;
    if (preferredId) {
      const project = await this.client.getProject(preferredId);
      return {
        projectCount: 1,
        projectId: project.id,
        projectName: project.name,
      };
    }

    try {
      const projects = await this.client.listProjects();
      let identity: { email?: string; id?: string; name?: string } = {};
      try {
        identity = await this.client.whoami();
      } catch {
        // Organization keys: skip whoami.
      }
      return { ...identity, projectCount: projects.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const scoped = message.match(/subject_project_id:"([^"]+)"/);
      if (scoped?.[1]) {
        const project = await this.client.getProject(scoped[1]);
        return {
          projectCount: 1,
          projectId: project.id,
          projectName: project.name,
        };
      }
      throw error;
    }
  }

  async listProjects(): Promise<NeonProject[]> {
    try {
      return await this.client.listProjects();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const scoped = message.match(/subject_project_id:"([^"]+)"/);
      const id = scoped?.[1] || this.client.defaultProjectId;
      if (id) {
        return [await this.client.getProject(id)];
      }
      throw error;
    }
  }

  async getProject(projectId?: string): Promise<NeonProject> {
    const id = projectId?.trim() || this.client.defaultProjectId;
    if (!id) {
      throw new Error(
        'Project id is required (pass projectId or set defaultProjectId / NEON_PROJECT_ID).',
      );
    }
    return this.client.getProject(id);
  }

  async listBranches(projectId?: string): Promise<NeonBranch[]> {
    const id = projectId?.trim() || this.client.defaultProjectId;
    if (!id) {
      throw new Error(
        'Project id is required (pass projectId or set defaultProjectId / NEON_PROJECT_ID).',
      );
    }
    return this.client.listBranches(id);
  }

  async connectionUri(input: {
    projectId?: string;
    branchId?: string;
    databaseName?: string;
    roleName?: string;
  }): Promise<{ uri: string }> {
    const projectId = input.projectId?.trim() || this.client.defaultProjectId;
    if (!projectId) {
      throw new Error(
        'Project id is required (pass projectId or set defaultProjectId / NEON_PROJECT_ID).',
      );
    }
    return this.client.getConnectionUri({
      projectId,
      branchId: input.branchId,
      databaseName: input.databaseName,
      roleName: input.roleName,
    });
  }

  formatProjects(projects: NeonProject[]): string {
    if (projects.length === 0) return 'No Neon projects.';
    return projects
      .map(
        (p) =>
          `${p.name} (${p.id})` +
          (p.regionId ? ` region=${p.regionId}` : '') +
          (p.createdAt ? ` created=${p.createdAt}` : ''),
      )
      .join('\n');
  }

  formatProject(project: NeonProject): string {
    return [
      `${project.name} (${project.id})`,
      project.regionId ? `region: ${project.regionId}` : null,
      project.createdAt ? `created: ${project.createdAt}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  formatBranches(branches: NeonBranch[]): string {
    if (branches.length === 0) return 'No branches.';
    return branches
      .map(
        (b) =>
          `${b.default ? '* ' : '  '}${b.name} (${b.id})` +
          (b.createdAt ? ` created=${b.createdAt}` : ''),
      )
      .join('\n');
  }

  /** Redact password in postgres URIs for safer agent display. */
  formatConnectionUri(uri: string): string {
    try {
      const u = new URL(uri);
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return uri.replace(/:([^:@/]+)@/, ':***@');
    }
  }
}
