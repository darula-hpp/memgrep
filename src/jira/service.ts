import type { JiraClient, JiraIssueSummary, JiraProjectSummary } from './client.js';

/**
 * Shared Jira business logic for MCP and CLI.
 */
export class JiraService {
  constructor(private readonly client: JiraClient) {}

  async verify(): Promise<{ displayName: string; emailAddress?: string }> {
    const me = await this.client.myself();
    return { displayName: me.displayName, emailAddress: me.emailAddress };
  }

  async search(jql: string, maxResults?: number): Promise<JiraIssueSummary[]> {
    return this.client.search(jql, maxResults ?? 20);
  }

  async getIssue(key: string): Promise<JiraIssueSummary & { description?: string }> {
    const issue = await this.client.getIssue(key);
    const { raw: _raw, ...rest } = issue;
    return rest;
  }

  async createIssue(input: {
    project?: string;
    summary: string;
    description?: string;
    issueType?: string;
  }): Promise<JiraIssueSummary> {
    const project = input.project?.trim() || this.client.defaultProject;
    if (!project) {
      throw new Error(
        'Project is required (pass project, set defaultProject in ~/.memgrep/jira.json, or JIRA_DEFAULT_PROJECT).',
      );
    }
    return this.client.createIssue({
      project,
      summary: input.summary,
      description: input.description,
      issueType: input.issueType,
    });
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    return this.client.addComment(key, body);
  }

  async transition(key: string, transition: string): Promise<{ from?: string; to: string; name: string }> {
    const transitions = await this.client.listTransitions(key);
    if (transitions.length === 0) {
      throw new Error(`No transitions available for ${key}.`);
    }
    const needle = transition.trim().toLowerCase();
    const match =
      transitions.find((t) => t.id === transition.trim()) ||
      transitions.find((t) => t.name.toLowerCase() === needle) ||
      transitions.find((t) => t.name.toLowerCase().includes(needle));
    if (!match) {
      const available = transitions.map((t) => `${t.name} (${t.id})`).join(', ');
      throw new Error(`Transition "${transition}" not found for ${key}. Available: ${available}`);
    }
    await this.client.transition(key, match.id);
    const after = await this.client.getIssue(key);
    return { to: after.status, name: match.name };
  }

  async listProjects(): Promise<JiraProjectSummary[]> {
    return this.client.listProjects();
  }

  formatIssue(issue: JiraIssueSummary & { description?: string }): string {
    const lines = [
      `${issue.key}: ${issue.summary}`,
      `  type=${issue.issueType} status=${issue.status} project=${issue.project}`,
    ];
    if (issue.assignee) lines.push(`  assignee=${issue.assignee}`);
    if (issue.updated) lines.push(`  updated=${issue.updated}`);
    if (issue.description) {
      lines.push('', issue.description.slice(0, 2000));
    }
    return lines.join('\n');
  }

  formatSearch(issues: JiraIssueSummary[]): string {
    if (issues.length === 0) return 'No issues matched.';
    return issues
      .map(
        (i) =>
          `${i.key}: ${i.summary}\n  status=${i.status} type=${i.issueType} project=${i.project}` +
          (i.assignee ? ` assignee=${i.assignee}` : ''),
      )
      .join('\n\n');
  }

  formatProjects(projects: JiraProjectSummary[]): string {
    if (projects.length === 0) return 'No projects found.';
    return projects.map((p) => `${p.key}: ${p.name}`).join('\n');
  }
}
