import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeJiraHost,
  resolveJiraConfig,
  writeJiraConfig,
  jiraConfigPath,
} from '../config.js';
import { plainTextToAdf, summarizeIssue } from '../client.js';
import { JiraService } from '../service.js';
import { JiraTools } from '../tools.js';
import type { JiraClient, JiraIssueSummary } from '../client.js';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'memgrep-jira-'));
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

describe('normalizeJiraHost', () => {
  it('strips path and trailing slash', () => {
    expect(normalizeJiraHost('https://acme.atlassian.net/jira')).toBe(
      'https://acme.atlassian.net',
    );
    expect(normalizeJiraHost('acme.atlassian.net/')).toBe('https://acme.atlassian.net');
  });

  it('rejects empty host', () => {
    expect(() => normalizeJiraHost('')).toThrow(/required/i);
  });
});

describe('resolveJiraConfig', () => {
  it('returns undefined when incomplete', () => {
    const home = tempHome();
    expect(resolveJiraConfig({}, home)).toBeUndefined();
  });

  it('reads from file', () => {
    const home = tempHome();
    writeJiraConfig(
      {
        host: 'https://acme.atlassian.net',
        email: 'dev@acme.com',
        apiToken: 'token-abcdefghijklmnopqrstuvwxyz',
        defaultProject: 'ENG',
      },
      home,
    );
    const resolved = resolveJiraConfig({}, home);
    expect(resolved).toMatchObject({
      host: 'https://acme.atlassian.net',
      email: 'dev@acme.com',
      defaultProject: 'ENG',
      source: 'file',
    });
    expect(resolved?.configPath).toBe(jiraConfigPath(home));
  });

  it('lets env override file', () => {
    const home = tempHome();
    writeJiraConfig(
      {
        host: 'https://acme.atlassian.net',
        email: 'dev@acme.com',
        apiToken: 'token-abcdefghijklmnopqrstuvwxyz',
      },
      home,
    );
    const resolved = resolveJiraConfig(
      {
        JIRA_HOST: 'https://other.atlassian.net',
        JIRA_EMAIL: 'other@acme.com',
        JIRA_API_TOKEN: 'env-token-abcdefghijklmnopqrst',
        JIRA_DEFAULT_PROJECT: 'OPS',
      },
      home,
    );
    expect(resolved).toMatchObject({
      host: 'https://other.atlassian.net',
      email: 'other@acme.com',
      apiToken: 'env-token-abcdefghijklmnopqrst',
      defaultProject: 'OPS',
      source: 'mixed',
    });
  });

  it('resolves from env only', () => {
    const home = tempHome();
    const resolved = resolveJiraConfig(
      {
        JIRA_HOST: 'https://env.atlassian.net',
        JIRA_EMAIL: 'env@acme.com',
        JIRA_API_TOKEN: 'env-only-token-abcdefghijkl',
      },
      home,
    );
    expect(resolved?.source).toBe('env');
    expect(resolved?.host).toBe('https://env.atlassian.net');
  });

  it('throws on corrupt config file', () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(jiraConfigPath(home), '{not-json', 'utf8');
    expect(() => resolveJiraConfig({}, home)).toThrow(/Invalid jira config/);
  });
});

describe('plainTextToAdf / summarizeIssue', () => {
  it('builds ADF paragraphs', () => {
    const doc = plainTextToAdf('line1\nline2');
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0]?.content[0]?.text).toBe('line1');
  });

  it('summarizes issue payload', () => {
    const summary = summarizeIssue({
      key: 'ENG-1',
      fields: {
        summary: 'Fix login',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        project: { key: 'ENG' },
        assignee: { displayName: 'Ada' },
      },
    });
    expect(summary).toEqual({
      key: 'ENG-1',
      summary: 'Fix login',
      status: 'In Progress',
      issueType: 'Bug',
      project: 'ENG',
      assignee: 'Ada',
      updated: undefined,
    });
  });
});

describe('JiraTools', () => {
  function mockClient(overrides: Partial<JiraClient> = {}): JiraClient {
    const base = {
      defaultProject: 'ENG',
      myself: vi.fn(),
      search: vi.fn(),
      getIssue: vi.fn(),
      createIssue: vi.fn(),
      addComment: vi.fn(),
      listTransitions: vi.fn(),
      transition: vi.fn(),
      listProjects: vi.fn(),
      ...overrides,
    };
    return base as unknown as JiraClient;
  }

  it('formats search results', async () => {
    const issues: JiraIssueSummary[] = [
      {
        key: 'ENG-1',
        summary: 'Fix login',
        status: 'Open',
        issueType: 'Bug',
        project: 'ENG',
      },
    ];
    const client = mockClient({
      search: vi.fn().mockResolvedValue(issues),
    });
    const tools = new JiraTools(new JiraService(client));
    const result = await tools.search({ jql: 'project = ENG' });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('ENG-1: Fix login');
  });

  it('returns isError on failure', async () => {
    const client = mockClient({
      getIssue: vi.fn().mockRejectedValue(new Error('Jira API GET /issue/X failed (HTTP 404)')),
    });
    const tools = new JiraTools(new JiraService(client));
    const result = await tools.getIssue({ key: 'X' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/404/);
  });

  it('requires project when creating without default', async () => {
    const client = mockClient({ defaultProject: undefined });
    const tools = new JiraTools(new JiraService(client));
    const result = await tools.createIssue({ summary: 'No project' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Project is required/);
  });

  it('resolves transition by name', async () => {
    const client = mockClient({
      listTransitions: vi.fn().mockResolvedValue([
        { id: '31', name: 'Done', to: 'Done' },
        { id: '21', name: 'In Progress', to: 'In Progress' },
      ]),
      transition: vi.fn().mockResolvedValue(undefined),
      getIssue: vi.fn().mockResolvedValue({
        key: 'ENG-1',
        summary: 'Fix login',
        status: 'Done',
        issueType: 'Bug',
        project: 'ENG',
        raw: {},
      }),
    });
    const tools = new JiraTools(new JiraService(client));
    const result = await tools.transition({ key: 'ENG-1', transition: 'done' });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('Done');
    expect(client.transition).toHaveBeenCalledWith('ENG-1', '31');
  });
});
