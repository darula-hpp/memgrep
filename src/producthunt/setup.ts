import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { ProductHuntClient } from './client.js';
import {
  fetchClientCredentialsToken,
  productHuntConfigPath,
  readProductHuntConfig,
  redactToken,
  writeProductHuntConfig,
  type ProductHuntConfig,
} from './config.js';
import { ProductHuntService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  token: string;
  apiKey?: string;
  apiSecret?: string;
}): Promise<ProductHuntConfig> {
  console.log('Validating credentials...');
  const client = new ProductHuntClient({
    token: input.token,
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    configPath: productHuntConfigPath(input.home),
    source: 'file',
  });
  const service = new ProductHuntService(client);
  const verified = await service.verify();
  console.log(
    verified.samplePost
      ? `Connected (sample post: ${verified.samplePost})`
      : 'Connected to Product Hunt API',
  );

  const config = writeProductHuntConfig(
    {
      token: input.token,
      apiKey: input.apiKey ?? '',
      apiSecret: input.apiSecret ?? '',
    },
    input.home,
  );

  console.log(`\nSaved → ${productHuntConfigPath(input.home)}`);
  console.log(
    'Product Hunt tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).',
  );
  return config;
}

/**
 * Onboarding for Product Hunt API credentials.
 * Prefer a Developer Token from https://api.producthunt.com/v2/oauth/applications
 * When token + optional key/secret are provided via env, skips prompts.
 */
export async function runProductHuntSetup(options: {
  home?: string;
  existingToken?: string;
  existingApiKey?: string;
  existingApiSecret?: string;
} = {}): Promise<ProductHuntConfig> {
  const home = options.home ?? defaultHome();
  const existing = readProductHuntConfig(home);

  let token = options.existingToken?.trim() || '';
  const apiKey = options.existingApiKey?.trim() || '';
  const apiSecret = options.existingApiSecret?.trim() || '';

  if (!token && apiKey && apiSecret) {
    console.log('memgrep producthunt setup (non-interactive via API key/secret)');
    token = await fetchClientCredentialsToken(apiKey, apiSecret);
    return saveVerifiedConfig({ home, token, apiKey, apiSecret });
  }

  if (token) {
    console.log('memgrep producthunt setup (non-interactive)');
    console.log('------------------------------------------');
    return saveVerifiedConfig({
      home,
      token,
      apiKey: apiKey || existing?.apiKey,
      apiSecret: apiSecret || existing?.apiSecret,
    });
  }

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep producthunt setup');
    console.log('-------------------------');
    console.log('Create an app + Developer Token at:');
    console.log('  https://api.producthunt.com/v2/oauth/applications\n');
    console.log('Prefer a Developer Token (does not expire).');
    console.log('Or paste API key + secret to use client_credentials.\n');

    let nextToken = '';
    if (existing?.token) {
      const reuse = await prompt(
        rl,
        `Token already saved (${redactToken(existing.token)}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        nextToken = existing.token;
        console.log('Keeping existing token.');
      }
    }
    if (!nextToken) {
      nextToken = await prompt(rl, 'Paste Developer Token (or leave blank to use API key/secret): ');
    }

    let nextKey = existing?.apiKey || '';
    let nextSecret = existing?.apiSecret || '';
    if (!nextToken) {
      nextKey = (await prompt(rl, nextKey ? `API key [${redactToken(nextKey)}]: ` : 'API key: ')) || nextKey;
      nextSecret =
        (await prompt(
          rl,
          nextSecret ? `API secret [${redactToken(nextSecret)}]: ` : 'API secret: ',
        )) || nextSecret;
      if (!nextKey || !nextSecret) {
        throw new Error('Provide a Developer Token, or both API key and secret.');
      }
      console.log('Fetching client_credentials token...');
      nextToken = await fetchClientCredentialsToken(nextKey, nextSecret);
    } else {
      const wantKeys = await prompt(rl, 'Also save API key/secret for later? [y/N]: ');
      if (wantKeys.toLowerCase() === 'y' || wantKeys.toLowerCase() === 'yes') {
        nextKey =
          (await prompt(rl, nextKey ? `API key [${redactToken(nextKey)}]: ` : 'API key: ')) ||
          nextKey;
        nextSecret =
          (await prompt(
            rl,
            nextSecret ? `API secret [${redactToken(nextSecret)}]: ` : 'API secret: ',
          )) || nextSecret;
      }
    }

    return saveVerifiedConfig({
      home,
      token: nextToken,
      apiKey: nextKey || undefined,
      apiSecret: nextSecret || undefined,
    });
  } finally {
    rl.close();
  }
}
