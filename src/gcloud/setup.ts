import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { defaultHome } from '../memory/store.js';
import { expandHomePath } from '../telegram/config.js';
import { GcloudClient } from './client.js';
import {
  gcloudConfigPath,
  readGcloudConfig,
  redactPath,
  writeGcloudConfig,
  type GcloudConfig,
} from './config.js';
import { GcloudService } from './service.js';

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function saveVerifiedConfig(input: {
  home: string;
  projectId: string;
  credentialsPath?: string;
  defaultZone?: string;
}): Promise<GcloudConfig> {
  console.log('Validating credentials...');
  const credentialsPath = input.credentialsPath
    ? expandHomePath(input.credentialsPath)
    : undefined;
  const client = new GcloudClient({
    projectId: input.projectId,
    credentialsPath,
    defaultZone: input.defaultZone,
    configPath: gcloudConfigPath(input.home),
    source: 'file',
  });
  const service = new GcloudService(client);
  const me = await service.verify();

  console.log(
    `Connected to project ${me.projectName || me.projectId}` +
      (me.projectName && me.projectName !== me.projectId ? ` (${me.projectId})` : '') +
      (me.lifecycleState ? ` [${me.lifecycleState}]` : ''),
  );

  const config = writeGcloudConfig(
    {
      projectId: input.projectId,
      credentialsPath: credentialsPath ?? '',
      defaultZone: input.defaultZone ?? '',
    },
    input.home,
  );

  console.log(`\nSaved → ${gcloudConfigPath(input.home)}`);
  if (config.credentialsPath) {
    console.log(`Credentials: ${redactPath(config.credentialsPath)}`);
  } else {
    console.log('Credentials: Application Default Credentials (ADC)');
  }
  if (config.defaultZone) {
    console.log(`Default zone: ${config.defaultZone}`);
  }
  console.log(
    'gcloud tools will appear on memgrep MCP after restart (node dist/cli.js serve / telegram).',
  );
  return config;
}

/**
 * Onboarding for Google Cloud (project + optional SA JSON / ADC).
 * When projectId is provided via env, skips prompts.
 */
export async function runGcloudSetup(options: {
  home?: string;
  existingProjectId?: string;
  existingCredentialsPath?: string;
  existingDefaultZone?: string;
} = {}): Promise<GcloudConfig> {
  const home = options.home ?? defaultHome();
  const existing = readGcloudConfig(home);

  const nonInteractiveProject = options.existingProjectId?.trim() || '';
  if (nonInteractiveProject) {
    console.log('memgrep gcloud setup (non-interactive)');
    console.log('-------------------------------------');
    return saveVerifiedConfig({
      home,
      projectId: nonInteractiveProject,
      credentialsPath:
        options.existingCredentialsPath?.trim() ||
        existing?.credentialsPath,
      defaultZone: options.existingDefaultZone?.trim() || existing?.defaultZone,
    });
  }

  const rl = createInterface({ input, output });
  try {
    console.log('memgrep gcloud setup');
    console.log('-------------------');
    console.log('Uses Application Default Credentials or a service-account JSON key.');
    console.log('Scopes: cloud-platform.read-only (logs + GCE inspect).\n');

    const projectHint = existing?.projectId || '';
    const projectAnswer = await prompt(
      rl,
      projectHint ? `GCP project id [${projectHint}]: ` : 'GCP project id: ',
    );
    const projectId = projectAnswer || projectHint;
    if (!projectId) {
      throw new Error('GCP project id is required.');
    }

    const credsHint =
      options.existingCredentialsPath ||
      existing?.credentialsPath ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      '';
    let credentialsPath: string | undefined;
    if (credsHint) {
      const reuse = await prompt(
        rl,
        `Credentials path already known (${redactPath(expandHomePath(credsHint))}). Keep it? [Y/n]: `,
      );
      if (reuse.toLowerCase() !== 'n' && reuse.toLowerCase() !== 'no') {
        credentialsPath = expandHomePath(credsHint);
        console.log('Keeping existing credentials path (or ADC env).');
      }
    }
    if (credentialsPath === undefined) {
      const credsAnswer = await prompt(
        rl,
        'Service account JSON path (optional, blank = ADC): ',
      );
      credentialsPath = credsAnswer ? expandHomePath(credsAnswer) : undefined;
    }

    const zoneHint = options.existingDefaultZone || existing?.defaultZone || '';
    const zoneAnswer = await prompt(
      rl,
      zoneHint
        ? `Default Compute zone (optional) [${zoneHint}]: `
        : 'Default Compute zone (optional, e.g. africa-south1-a): ',
    );
    const defaultZone = zoneAnswer || zoneHint || undefined;

    return saveVerifiedConfig({
      home,
      projectId,
      credentialsPath,
      defaultZone,
    });
  } finally {
    rl.close();
  }
}
