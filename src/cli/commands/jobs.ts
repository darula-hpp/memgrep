import type { Command } from 'commander';
import { fail } from '../lib/errors.js';

async function loadDotenv(): Promise<void> {
  const { config } = await import('dotenv');
  config({ quiet: true });
}

function openService() {
  return import('../../jobs/store.js').then(async ({ JobStore }) => {
    const { JobsService } = await import('../../jobs/service.js');
    const store = JobStore.open();
    const service = new JobsService({ store });
    return { store, service };
  });
}

export function registerJobsCommand(program: Command): void {
  const jobs = program.command('jobs').description('Schedule playbook runs (cron + Cursor + memgrep memory)');

  jobs
    .command('add')
    .description('Create a scheduled job that runs a playbook via Cursor')
    .requiredOption('--name <name>', 'job name')
    .requiredOption('--cron <expr>', '5-field cron (e.g. "0 9 * * 1-5")')
    .requiredOption('--prompt <text>', 'task prompt at fire time')
    .requiredOption('--cwd <dir>', 'working directory for the Cursor agent')
    .option('--playbook <id>', 'playbook chat id from memgrep remember/ingest', (v) => Number(v))
    .option('--playbook-query <text>', 'semantic query to find the playbook')
    .option('--model <id>', 'Cursor model id')
    .option('--profile <name>', 'telegram profile for credentials + notify', 'default')
    .option('--mode <mode>', 'notify | auto', 'notify')
    .option(
      '--executor <kind>',
      'cursor (default, run on hub) or edge (Cursor turn on edge node)',
      'cursor',
    )
    .option('--requires <req>', 'optional: edge (fail if edge node offline)')
    .option('--disabled', 'create disabled', false)
    .action(
      async (opts: {
        name: string;
        cron: string;
        prompt: string;
        cwd: string;
        playbook?: number;
        playbookQuery?: string;
        model?: string;
        profile: string;
        mode: string;
        executor: string;
        requires?: string;
        disabled?: boolean;
      }) => {
        if (opts.playbook == null && !opts.playbookQuery) {
          fail('Provide --playbook <id> or --playbook-query <text>.');
        }
        if (opts.mode !== 'notify' && opts.mode !== 'auto') {
          fail('--mode must be notify or auto');
        }
        if (opts.executor !== 'cursor' && opts.executor !== 'edge') {
          fail('--executor must be cursor or edge');
        }
        if (opts.requires && opts.requires !== 'edge' && opts.requires !== 'mac-edge') {
          fail('--requires must be edge (or omit)');
        }
        const { store, service } = await openService();
        try {
          const job = service.add({
            name: opts.name,
            cron: opts.cron,
            prompt: opts.prompt,
            cwd: opts.cwd,
            playbookId: opts.playbook,
            playbookQuery: opts.playbookQuery,
            model: opts.model,
            telegramProfile: opts.profile,
            mode: opts.mode,
            executor: opts.executor,
            requires:
              opts.requires === 'edge' ||
              opts.requires === 'mac-edge' ||
              opts.executor === 'edge'
                ? 'edge'
                : undefined,
            enabled: !opts.disabled,
          });
          console.log(`Created ${job.name} (${job.id})`);
          console.log(
            `next=${job.nextRunAt} mode=${job.mode} executor=${job.executor}` +
              (job.requires ? ` requires=${job.requires}` : ''),
          );
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        } finally {
          store.close();
        }
      },
    );

  jobs
    .command('list')
    .description('List scheduled jobs')
    .action(async () => {
      const { store, service } = await openService();
      try {
        console.log(service.formatList().text);
      } finally {
        store.close();
      }
    });

  jobs
    .command('show')
    .description('Show one job')
    .argument('<idOrName>', 'job id or name')
    .action(async (idOrName: string) => {
      const { store, service } = await openService();
      try {
        const result = service.formatShow(idOrName);
        if (result.isError) fail(result.text);
        console.log(result.text);
      } finally {
        store.close();
      }
    });

  jobs
    .command('enable')
    .description('Enable a job')
    .argument('<idOrName>', 'job id or name')
    .action(async (idOrName: string) => {
      const { store, service } = await openService();
      try {
        const job = service.enable(idOrName, true);
        console.log(`Enabled ${job.name}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      } finally {
        store.close();
      }
    });

  jobs
    .command('disable')
    .description('Disable a job')
    .argument('<idOrName>', 'job id or name')
    .action(async (idOrName: string) => {
      const { store, service } = await openService();
      try {
        const job = service.enable(idOrName, false);
        console.log(`Disabled ${job.name}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      } finally {
        store.close();
      }
    });

  jobs
    .command('remove')
    .description('Delete a job')
    .argument('<idOrName>', 'job id or name')
    .action(async (idOrName: string) => {
      const { store, service } = await openService();
      try {
        const job = service.remove(idOrName);
        console.log(`Removed ${job.name} (${job.id})`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      } finally {
        store.close();
      }
    });

  jobs
    .command('logs')
    .description('Show recent runs for a job')
    .argument('<idOrName>', 'job id or name')
    .option('-n, --limit <n>', 'max runs', (v) => Number(v), 10)
    .action(async (idOrName: string, opts: { limit: number }) => {
      const { store, service } = await openService();
      try {
        const result = service.formatLogs(idOrName, opts.limit);
        if (result.isError) fail(result.text);
        console.log(result.text);
      } finally {
        store.close();
      }
    });

  jobs
    .command('run')
    .description('Run a job once now (starts Cursor agent)')
    .argument('<idOrName>', 'job id or name')
    .option('--mcp-url <url>', 'use existing MCP HTTP instead of embedding one')
    .action(async (idOrName: string, opts: { mcpUrl?: string }) => {
      await loadDotenv();
      const { createRunnableJobsService } = await import('../../jobs/daemon.js');
      const { service, close } = await createRunnableJobsService({
        mcpUrl: opts.mcpUrl,
      });
      try {
        const { job, result } = await service.runNow(idOrName);
        if (!result.ok) {
          console.error(`FAILED ${job.name}: ${result.error}`);
          if (result.summary) console.log(result.summary);
          process.exitCode = 1;
        } else {
          console.log(`OK ${job.name}`);
          console.log(result.summary);
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      } finally {
        await close();
      }
    });

  jobs
    .command('daemon')
    .description('Run the jobs scheduler (tick loop)')
    .option('--mcp-url <url>', 'use existing MCP HTTP')
    .option('--tick <ms>', 'tick interval ms', (v) => Number(v), 30_000)
    .action(async (opts: { mcpUrl?: string; tick: number }) => {
      await loadDotenv();
      const { JobsDaemon } = await import('../../jobs/daemon.js');
      const { installTelegramProcessGuards } = await import('../../telegram/process-guards.js');
      installTelegramProcessGuards();

      const daemon = new JobsDaemon({
        mcpUrl: opts.mcpUrl,
        tickMs: opts.tick,
      });
      await daemon.start();

      const shutdown = async () => {
        console.error('memgrep jobs: shutting down…');
        await daemon.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });

  jobs
    .command('install')
    .description('Install a macOS LaunchAgent for the jobs daemon')
    .action(async () => {
      if (process.platform !== 'darwin') fail('LaunchAgent install is only supported on macOS.');
      const { installJobsLaunchdService } = await import('../../jobs/launchd.js');
      try {
        const status = installJobsLaunchdService();
        console.log(`Installed LaunchAgent: ${status.label}`);
        console.log(`plist: ${status.plistPath}`);
        console.log(`log: ${status.logPath}`);
        console.log(`loaded: ${status.loaded}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  jobs
    .command('uninstall')
    .description('Remove the jobs LaunchAgent')
    .action(async () => {
      if (process.platform !== 'darwin') fail('LaunchAgent uninstall is only supported on macOS.');
      const { uninstallJobsLaunchdService } = await import('../../jobs/launchd.js');
      const status = uninstallJobsLaunchdService();
      console.log(status.installed ? `Still present: ${status.plistPath}` : 'Removed jobs LaunchAgent.');
    });

  jobs
    .command('service')
    .description('Show jobs LaunchAgent status')
    .action(async () => {
      const { getJobsLaunchdStatus } = await import('../../jobs/launchd.js');
      const status = getJobsLaunchdStatus();
      console.log(`label: ${status.label}`);
      console.log(`installed: ${status.installed}`);
      console.log(`loaded: ${status.loaded}`);
      console.log(`plist: ${status.plistPath}`);
      console.log(`log: ${status.logPath}`);
      if (status.programArgs) {
        console.log(`args: ${status.programArgs.join(' ')}`);
      }
    });
}
