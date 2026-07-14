import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { NeonClient } from './client.js';
import {
  neonConfigPath,
  readNeonConfig,
  redactToken,
  writeNeonConfig,
  type NeonConfig,
} from './config.js';
import { NeonService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  apiKey: string;
  defaultProjectId?: string;
}): Promise<NeonConfig> {
  console.log('Validating credentials...');
  const client = new NeonClient({
    apiKey: input.apiKey,
    defaultProjectId: input.defaultProjectId,
    configPath: neonConfigPath(input.home),
    source: 'file',
  });
  const service = new NeonService(client);
  const me = await service.verify();
  const defaultProjectId = input.defaultProjectId || me.projectId;

  if (me.email || me.name || me.id) {
    console.log(`Connected as ${me.email || me.name || me.id}`);
  } else if (me.projectName || me.projectId) {
    console.log(
      `Connected to project ${me.projectName || me.projectId}` +
        (me.projectId ? ` (${me.projectId})` : ''),
    );
  } else {
    console.log(`Connected (${me.projectCount} project(s) visible)`);
  }

  const config = writeNeonConfig(
    {
      apiKey: input.apiKey,
      defaultProjectId: defaultProjectId ?? '',
    },
    input.home,
  );

  console.log(`\nSaved → ${neonConfigPath(input.home)}`);
  if (config.defaultProjectId) {
    console.log(`Default project: ${config.defaultProjectId}`);
  }
  console.log(
    'Neon tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).',
  );
  return config;
}

/**
 * Onboarding for Neon API key.
 * When apiKey is provided via env, skips prompts.
 */
export async function runNeonSetup(options: {
  home?: string;
  existingApiKey?: string;
  existingDefaultProjectId?: string;
} = {}): Promise<NeonConfig> {
  const home = options.home ?? defaultHome();
  const existing = readNeonConfig(home);

  const nonInteractiveKey = options.existingApiKey?.trim() || '';
  if (nonInteractiveKey) {
    console.log('memgrep neon setup (non-interactive)');
    console.log('------------------------------------');
    return saveVerifiedConfig({
      home,
      apiKey: nonInteractiveKey,
      defaultProjectId:
        options.existingDefaultProjectId?.trim() || existing?.defaultProjectId,
    });
  }

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep neon setup');
    console.log('------------------');
    console.log('Create an API key at:');
    console.log('  https://console.neon.tech/app/settings/api-keys');
    console.log('Project-scoped keys: pass the Neon project id (e.g. holy-violet-56502803).\n');

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
      apiKey = await prompt(rl, 'Paste Neon API key: ');
    }
    if (!apiKey) {
      throw new Error('Neon API key is required.');
    }

    const defaultHint =
      options.existingDefaultProjectId || existing?.defaultProjectId || '';
    const projectAnswer = await prompt(
      rl,
      defaultHint
        ? `Default project id (optional) [${defaultHint}]: `
        : 'Default project id (optional): ',
    );
    const defaultProjectId = projectAnswer || defaultHint || undefined;

    return saveVerifiedConfig({ home, apiKey, defaultProjectId });
  } finally {
    rl.close();
  }
}
