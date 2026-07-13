import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { JiraClient } from './client.js';
import {
  jiraConfigPath,
  normalizeJiraHost,
  readJiraConfig,
  redactToken,
  writeJiraConfig,
  type JiraConfig,
} from './config.js';
import { JiraService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  host: string;
  email: string;
  apiToken: string;
  defaultProject?: string;
}): Promise<JiraConfig> {
  const host = normalizeJiraHost(input.host);
  console.log('Validating credentials...');
  const client = new JiraClient({
    host,
    email: input.email,
    apiToken: input.apiToken,
    defaultProject: input.defaultProject,
    configPath: jiraConfigPath(input.home),
    source: 'file',
  });
  const service = new JiraService(client);
  const me = await service.verify();
  console.log(`Connected as ${me.displayName}${me.emailAddress ? ` <${me.emailAddress}>` : ''}`);

  const config = writeJiraConfig(
    {
      host,
      email: input.email,
      apiToken: input.apiToken,
      defaultProject: input.defaultProject ?? '',
    },
    input.home,
  );

  console.log(`\nSaved → ${jiraConfigPath(input.home)}`);
  if (config.defaultProject) {
    console.log(`Default project: ${config.defaultProject}`);
  }
  console.log('Jira tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).');
  return config;
}

/**
 * Onboarding for Atlassian Cloud Jira credentials.
 * When host + email + token are provided (e.g. via env), skips prompts.
 */
export async function runJiraSetup(options: {
  home?: string;
  existingHost?: string;
  existingEmail?: string;
  existingApiToken?: string;
  existingDefaultProject?: string;
} = {}): Promise<JiraConfig> {
  const home = options.home ?? defaultHome();
  const existing = readJiraConfig(home);

  const nonInteractiveHost = options.existingHost?.trim() || '';
  const nonInteractiveEmail = options.existingEmail?.trim() || '';
  const nonInteractiveToken = options.existingApiToken?.trim() || '';
  if (nonInteractiveHost && nonInteractiveEmail && nonInteractiveToken) {
    console.log('memgrep jira setup (non-interactive)');
    console.log('------------------------------------');
    return saveVerifiedConfig({
      home,
      host: nonInteractiveHost,
      email: nonInteractiveEmail,
      apiToken: nonInteractiveToken,
      defaultProject: options.existingDefaultProject?.trim() || existing?.defaultProject,
    });
  }

  const rl = createInterface({ input, output });

  try {
    console.log('memgrep jira setup');
    console.log('------------------');
    console.log('Atlassian Cloud: create an API token at');
    console.log('  https://id.atlassian.com/manage-profile/security/api-tokens\n');

    const defaultHost = options.existingHost || existing?.host || '';
    const hostAnswer = await prompt(
      rl,
      defaultHost ? `Jira host [${defaultHost}]: ` : 'Jira host (e.g. https://your-domain.atlassian.net): ',
    );
    const host = hostAnswer || defaultHost;
    if (!host) {
      throw new Error('Jira host is required.');
    }

    const defaultEmail = options.existingEmail || existing?.email || '';
    const emailAnswer = await prompt(
      rl,
      defaultEmail ? `Email [${defaultEmail}]: ` : 'Atlassian account email: ',
    );
    const email = emailAnswer || defaultEmail;
    if (!email) {
      throw new Error('Email is required.');
    }

    let apiToken = options.existingApiToken?.trim() || '';
    if (!apiToken && existing?.apiToken) {
      const reuse = await prompt(
        rl,
        `API token already saved (${redactToken(existing.apiToken)}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() === 'n' || reuse.toLowerCase() === 'no') {
        apiToken = await prompt(rl, 'Paste Jira API token: ');
      } else {
        apiToken = existing.apiToken;
        console.log('Keeping existing API token.');
      }
    }
    if (!apiToken) {
      apiToken = await prompt(rl, 'Paste Jira API token: ');
    }
    if (!apiToken) {
      throw new Error('API token is required.');
    }

    const defaultProjectHint =
      options.existingDefaultProject || existing?.defaultProject || '';
    const projectAnswer = await prompt(
      rl,
      defaultProjectHint
        ? `Default project key (optional) [${defaultProjectHint}]: `
        : 'Default project key (optional, e.g. ENG): ',
    );
    const defaultProject = projectAnswer || defaultProjectHint || undefined;

    return saveVerifiedConfig({
      home,
      host,
      email,
      apiToken,
      defaultProject,
    });
  } finally {
    rl.close();
  }
}
