import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { UpstashClient } from './client.js';
import {
  readUpstashConfig,
  redactToken,
  upstashConfigPath,
  writeUpstashConfig,
  type UpstashConfig,
} from './config.js';
import { UpstashService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  restUrl: string;
  token: string;
}): Promise<UpstashConfig> {
  console.log('Validating credentials...');
  const client = new UpstashClient({
    restUrl: input.restUrl,
    token: input.token,
    configPath: upstashConfigPath(input.home),
    source: 'file',
  });
  const service = new UpstashService(client);
  const me = await service.verify();
  console.log(`Connected (${me.pong}) → ${me.restUrl} (dbsize=${me.dbsize})`);

  const config = writeUpstashConfig(
    {
      restUrl: input.restUrl,
      token: input.token,
    },
    input.home,
  );

  console.log(`\nSaved → ${upstashConfigPath(input.home)}`);
  console.log(
    'Upstash tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).',
  );
  return config;
}

/**
 * Onboarding for Upstash Redis REST URL + token.
 * When both are provided (e.g. via env), skips prompts.
 */
export async function runUpstashSetup(options: {
  home?: string;
  existingRestUrl?: string;
  existingToken?: string;
} = {}): Promise<UpstashConfig> {
  const home = options.home ?? defaultHome();
  const existing = readUpstashConfig(home);

  const nonInteractiveUrl = options.existingRestUrl?.trim() || '';
  const nonInteractiveToken = options.existingToken?.trim() || '';

  if (nonInteractiveUrl && nonInteractiveToken) {
    console.log('memgrep upstash setup (non-interactive)');
    console.log('---------------------------------------');
    return saveVerifiedConfig({
      home,
      restUrl: nonInteractiveUrl,
      token: nonInteractiveToken,
    });
  }

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep upstash setup');
    console.log('---------------------');
    console.log('In the Upstash console → your Redis database → REST API:');
    console.log('  copy UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN\n');

    const defaultUrl = options.existingRestUrl || existing?.restUrl || '';
    const urlAnswer = await prompt(
      rl,
      defaultUrl ? `REST URL [${defaultUrl}]: ` : 'REST URL: ',
    );
    const restUrl = urlAnswer || defaultUrl;
    if (!restUrl) {
      throw new Error('Upstash REST URL is required.');
    }

    let token = '';
    if (existing?.token) {
      const reuse = await prompt(
        rl,
        `Token already saved (${redactToken(existing.token)}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        token = existing.token;
        console.log('Keeping existing token.');
      }
    }
    if (!token) {
      token = await prompt(rl, 'Paste REST token: ');
    }
    if (!token) {
      throw new Error('Upstash REST token is required.');
    }

    return saveVerifiedConfig({ home, restUrl, token });
  } finally {
    rl.close();
  }
}
