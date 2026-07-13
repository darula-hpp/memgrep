import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { PostHogClient } from './client.js';
import {
  DEFAULT_POSTHOG_HOST,
  normalizePostHogHost,
  posthogConfigPath,
  readPostHogConfig,
  redactToken,
  writePostHogConfig,
  type PostHogConfig,
} from './config.js';
import { PostHogService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  host: string;
  apiKey: string;
  projectId: string;
}): Promise<PostHogConfig> {
  const host = normalizePostHogHost(input.host);
  console.log('Validating credentials...');
  const client = new PostHogClient({
    host,
    apiKey: input.apiKey,
    projectId: input.projectId,
    configPath: posthogConfigPath(input.home),
    source: 'file',
  });
  const service = new PostHogService(client);
  const project = await service.verify();
  console.log(`Connected to project ${project.name || project.id} (id=${project.id})`);

  const config = writePostHogConfig(
    {
      host,
      apiKey: input.apiKey,
      projectId: input.projectId,
    },
    input.home,
  );

  console.log(`\nSaved → ${posthogConfigPath(input.home)}`);
  console.log(
    'PostHog tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).',
  );
  return config;
}

/**
 * Onboarding for PostHog personal API key + project id.
 * When host/key/project are provided (e.g. via env), skips prompts.
 */
export async function runPostHogSetup(options: {
  home?: string;
  existingHost?: string;
  existingApiKey?: string;
  existingProjectId?: string;
} = {}): Promise<PostHogConfig> {
  const home = options.home ?? defaultHome();
  const existing = readPostHogConfig(home);

  const nonInteractiveHost = options.existingHost?.trim() || '';
  const nonInteractiveKey = options.existingApiKey?.trim() || '';
  const nonInteractiveProject = options.existingProjectId?.trim() || '';

  if (nonInteractiveKey && nonInteractiveProject) {
    console.log('memgrep posthog setup (non-interactive)');
    console.log('---------------------------------------');
    return saveVerifiedConfig({
      home,
      host: nonInteractiveHost || existing?.host || DEFAULT_POSTHOG_HOST,
      apiKey: nonInteractiveKey,
      projectId: nonInteractiveProject,
    });
  }

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep posthog setup');
    console.log('---------------------');
    console.log('Create a personal API key with Query Read + Feature Flag Read at:');
    console.log('  https://app.posthog.com/settings/user-api-keys');
    console.log('Project id: Project settings → Project ID (or /project/<id>/ in the URL)\n');

    const defaultHost = options.existingHost || existing?.host || DEFAULT_POSTHOG_HOST;
    const hostAnswer = await prompt(rl, `PostHog host [${defaultHost}]: `);
    const host = hostAnswer || defaultHost;

    let apiKey = '';
    if (existing?.apiKey) {
      const reuse = await prompt(
        rl,
        `API key already saved (${redactToken(existing.apiKey)}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        apiKey = existing.apiKey;
        console.log('Keeping existing API key.');
      }
    }
    if (!apiKey) {
      apiKey = await prompt(rl, 'Paste personal API key: ');
    }
    if (!apiKey) {
      throw new Error('Personal API key is required.');
    }

    const defaultProject = options.existingProjectId || existing?.projectId || '';
    const projectAnswer = await prompt(
      rl,
      defaultProject ? `Project id [${defaultProject}]: ` : 'Project id: ',
    );
    const projectId = projectAnswer || defaultProject;
    if (!projectId) {
      throw new Error('Project id is required.');
    }

    return saveVerifiedConfig({ home, host, apiKey, projectId });
  } finally {
    rl.close();
  }
}
