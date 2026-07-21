import type { Command } from 'commander';
import { fail } from '../lib/errors.js';
import {
  edgeConfigPath,
  edgeHubConfigPath,
  ensureEdgeHubToken,
  parseToolsList,
  writeEdgeConfig,
} from '../../edge/config.js';
import { EdgeClient } from '../../edge/client.js';
import {
  detectEdgeBackend,
  formatEdgeServiceStatus,
  getEdgeServiceStatus,
  installEdgeService,
  uninstallEdgeService,
} from '../../edge/service.js';
import { defaultHome } from '../../memory/store.js';

export function registerEdgeCommand(program: Command): void {
  const edge = program
    .command('edge')
    .description(
      'Edge node runtime: pair with a cloud memgrep hub, proxy local tools, sync memory up',
    );

  edge
    .command('token')
    .description('Hub: create or show the edge pairing token (~/.memgrep/edge-hub.json)')
    .action(() => {
      try {
        const home = defaultHome();
        const cfg = ensureEdgeHubToken(home);
        console.log(`token: ${cfg.token}`);
        console.log(`created: ${cfg.createdAt}`);
        console.log(`file: ${edgeHubConfigPath(home)}`);
        console.log('');
        console.log('On the edge host (laptop / desktop):');
        console.log(
          `  memgrep edge pair <https://your-hub-host/mcp> --token ${cfg.token}`,
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  edge
    .command('pair')
    .description('Edge host: save hub URL + token to ~/.memgrep/edge.json')
    .argument('<hub-url>', 'Cloud hub URL (http(s)://host/mcp or ws(s)://host/edge)')
    .requiredOption('--token <token>', 'Pairing token from memgrep edge token on the hub')
    .option(
      '--tools <list>',
      'Comma tools to enable',
      'edge_ping,edge_run,edge_loop_run,edge_cursor_run',
    )
    .option('--no-sync', 'Disable edge → cloud memory sync')
    .action(
      (
        hubUrl: string,
        opts: { token: string; tools?: string; sync?: boolean },
      ) => {
        try {
          const home = defaultHome();
          const cfg = writeEdgeConfig(
            {
              hubUrl,
              token: opts.token,
              tools: parseToolsList(opts.tools),
              syncMemory: opts.sync !== false,
            },
            home,
          );
          console.log(`paired device=${cfg.deviceId}`);
          console.log(`hub: ${cfg.hubUrl}`);
          console.log(`tools: ${cfg.tools.join(',') || '(none)'}`);
          console.log(`syncMemory: ${cfg.syncMemory}`);
          console.log(`file: ${edgeConfigPath(home)}`);
          console.log('');
          console.log(
            `Next: memgrep edge install   # backend=${detectEdgeBackend()}  (or: memgrep edge daemon)`,
          );
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      },
    );

  edge
    .command('daemon')
    .description('Foreground edge client (background service runs this)')
    .action(async () => {
      try {
        const { runEdgeDaemon } = await import('../../edge/daemon.js');
        await runEdgeDaemon();
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  edge
    .command('install')
    .description(
      'Install background edge service (LaunchAgent / systemd --user / Windows Startup)',
    )
    .option('--tools <list>', 'Update enabled tools (edge_ping,edge_run)')
    .option('--no-sync', 'Disable memory sync in edge.json')
    .action((opts: { tools?: string; sync?: boolean }) => {
      try {
        const status = installEdgeService({
          tools: opts.tools ? parseToolsList(opts.tools) : undefined,
          syncMemory: opts.sync === false ? false : undefined,
        });
        for (const line of formatEdgeServiceStatus(status)) console.log(line);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  edge
    .command('uninstall')
    .description('Remove background edge service')
    .action(() => {
      try {
        const status = uninstallEdgeService();
        for (const line of formatEdgeServiceStatus(status)) console.log(line);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  edge
    .command('service')
    .description('Show background service + pair status')
    .action(() => {
      try {
        const status = getEdgeServiceStatus();
        for (const line of formatEdgeServiceStatus(status)) console.log(line);
        const live = new EdgeClient().getStatus();
        console.log(`paired: ${live.paired}`);
        console.log(`connected (this process): ${live.connected}`);
        console.log(`syncedHashes: ${live.syncedHashCount}`);
        if (live.lastError) console.log(`lastError: ${live.lastError}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

  edge
    .command('status')
    .description('Show local pair status or in-process hub presence')
    .action(async () => {
      try {
        const { getEdgeHub } = await import('../../edge/hub.js');
        const hub = getEdgeHub();
        if (hub) {
          console.log(JSON.stringify(hub.getPresence(), null, 2));
          return;
        }
        console.log(JSON.stringify(new EdgeClient().getStatus(), null, 2));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });
}
