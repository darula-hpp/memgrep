import type { ResolvedJiraConfig } from './config.js';

export type JiraAdfDoc = {
  type: 'doc';
  version: 1;
  content: Array<{
    type: 'paragraph';
    content: Array<{ type: 'text'; text: string }>;
  }>;
};

/** Minimal ADF document from plain text (Jira Cloud descriptions/comments). */
export function plainTextToAdf(text: string): JiraAdfDoc {
  const lines = text.length > 0 ? text.split(/\n/) : [''];
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph' as const,
      content: line.length > 0 ? [{ type: 'text' as const, text: line }] : [],
    })),
  };
}

export type JiraIssueSummary = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  project: string;
  assignee?: string;
  updated?: string;
};

export type JiraProjectSummary = {
  key: string;
  name: string;
  id: string;
};

export type JiraTransition = {
  id: string;
  name: string;
  to?: string;
};

export type JiraMyself = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function fieldText(fields: JsonRecord, path: string[]): string | undefined {
  let cur: unknown = fields;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as JsonRecord)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function summarizeIssue(raw: JsonRecord): JiraIssueSummary {
  const fields = asRecord(raw.fields);
  const key = typeof raw.key === 'string' ? raw.key : String(raw.key ?? '');
  return {
    key,
    summary: fieldText(fields, ['summary']) ?? '(no summary)',
    status: fieldText(fields, ['status', 'name']) ?? 'unknown',
    issueType: fieldText(fields, ['issuetype', 'name']) ?? 'unknown',
    project: fieldText(fields, ['project', 'key']) ?? '',
    assignee: fieldText(fields, ['assignee', 'displayName']),
    updated: fieldText(fields, ['updated']),
  };
}

/**
 * Thin Atlassian Cloud REST client (API v3) using Basic auth.
 */
export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: ResolvedJiraConfig) {
    this.baseUrl = `${config.host.replace(/\/+$/, '')}/rest/api/3`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
  }

  get defaultProject(): string | undefined {
    return this.config.defaultProject;
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
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const errObj = asRecord(parsed);
      const messages = Array.isArray(errObj.errorMessages)
        ? errObj.errorMessages.filter((m): m is string => typeof m === 'string')
        : [];
      const errors = asRecord(errObj.errors);
      const fieldErrors = Object.entries(errors)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('; ');
      const detail =
        messages.join('; ') ||
        fieldErrors ||
        (typeof parsed === 'string' ? parsed : '') ||
        res.statusText;
      throw new Error(`Jira API ${method} ${path} failed (HTTP ${res.status}): ${detail}`);
    }

    return parsed as T;
  }

  async myself(): Promise<JiraMyself> {
    const data = await this.request<JsonRecord>('GET', '/myself');
    return {
      accountId: String(data.accountId ?? ''),
      displayName: String(data.displayName ?? ''),
      emailAddress: typeof data.emailAddress === 'string' ? data.emailAddress : undefined,
    };
  }

  async search(jql: string, maxResults = 20): Promise<JiraIssueSummary[]> {
    const data = await this.request<JsonRecord>('POST', '/search/jql', {
      jql,
      maxResults: Math.min(Math.max(maxResults, 1), 50),
      fields: ['summary', 'status', 'issuetype', 'project', 'assignee', 'updated'],
    });
    const issues = Array.isArray(data.issues) ? data.issues : [];
    return issues.map((issue) => summarizeIssue(asRecord(issue)));
  }

  async getIssue(key: string): Promise<JiraIssueSummary & { description?: string; raw: JsonRecord }> {
    const data = await this.request<JsonRecord>('GET', `/issue/${encodeURIComponent(key)}`, undefined, {
      fields: 'summary,status,issuetype,project,assignee,updated,description,comment',
    });
    const summary = summarizeIssue(data);
    const fields = asRecord(data.fields);
    const description = extractPlainText(fields.description);
    return { ...summary, description, raw: data };
  }

  async createIssue(input: {
    project: string;
    summary: string;
    description?: string;
    issueType?: string;
  }): Promise<JiraIssueSummary> {
    const body: JsonRecord = {
      fields: {
        project: { key: input.project },
        summary: input.summary,
        issuetype: { name: input.issueType ?? 'Task' },
        ...(input.description
          ? { description: plainTextToAdf(input.description) }
          : {}),
      },
    };
    const created = await this.request<JsonRecord>('POST', '/issue', body);
    const key = typeof created.key === 'string' ? created.key : '';
    if (!key) {
      throw new Error('Jira create issue returned no key.');
    }
    return this.getIssue(key);
  }

  async addComment(key: string, body: string): Promise<{ id: string }> {
    const data = await this.request<JsonRecord>('POST', `/issue/${encodeURIComponent(key)}/comment`, {
      body: plainTextToAdf(body),
    });
    return { id: String(data.id ?? '') };
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const data = await this.request<JsonRecord>(
      'GET',
      `/issue/${encodeURIComponent(key)}/transitions`,
    );
    const transitions = Array.isArray(data.transitions) ? data.transitions : [];
    return transitions.map((t) => {
      const rec = asRecord(t);
      const to = asRecord(rec.to);
      return {
        id: String(rec.id ?? ''),
        name: String(rec.name ?? ''),
        to: typeof to.name === 'string' ? to.name : undefined,
      };
    });
  }

  async transition(key: string, transitionId: string): Promise<void> {
    await this.request('POST', `/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async listProjects(): Promise<JiraProjectSummary[]> {
    const data = await this.request<unknown>('GET', '/project');
    const values = Array.isArray(data) ? data : [];
    return values.map((p) => {
      const rec = asRecord(p);
      return {
        key: String(rec.key ?? ''),
        name: String(rec.name ?? ''),
        id: String(rec.id ?? ''),
      };
    });
  }
}

function extractPlainText(adf: unknown): string | undefined {
  if (typeof adf === 'string') return adf;
  if (!adf || typeof adf !== 'object') return undefined;
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as JsonRecord;
    if (rec.type === 'text' && typeof rec.text === 'string') {
      parts.push(rec.text);
    }
    if (Array.isArray(rec.content)) {
      for (const child of rec.content) walk(child);
    }
  };
  walk(adf);
  const text = parts.join('').trim();
  return text || undefined;
}
