import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { DocsService, type EditorLock } from './service.js';
import { EDITOR_CSS, EDITOR_HTML, EDITOR_JS } from './web/assets.js';

export const DEFAULT_DOCS_EDITOR_PORT = 8791;
export const DEFAULT_DOCS_EDITOR_HOST = '127.0.0.1';

export type DocsEditorHandle = {
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
};

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createDocsEditorApp(service: DocsService): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(EDITOR_HTML);
  });
  app.get('/styles.css', (_req, res) => {
    res.type('css').send(EDITOR_CSS);
  });
  app.get('/app.js', (_req, res) => {
    res.type('js').send(EDITOR_JS);
  });

  app.get('/api/docs', (_req, res) => {
    try {
      res.json({ docs: service.listDocs() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/doc/:name', async (req, res) => {
    try {
      const doc = await service.getDoc(req.params.name);
      res.json(doc);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/doc/:name', async (req, res) => {
    try {
      const context = req.body?.context;
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        res.status(400).json({ error: 'Expected JSON body { context: object }' });
        return;
      }
      const saved = await service.saveDoc(req.params.name, context as Record<string, unknown>);
      res.json(saved);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, cwd: service.templatesDir });
  });

  return app;
}

/**
 * Start (or reuse) the localhost docs editor for this project cwd.
 */
export async function startDocsEditor(options: {
  cwd?: string;
  port?: number;
  host?: string;
  name?: string;
}): Promise<DocsEditorHandle & { reused: boolean }> {
  const cwd = options.cwd ?? process.cwd();
  const service = new DocsService(cwd);
  service.setup();

  const host = options.host ?? DEFAULT_DOCS_EDITOR_HOST;
  const preferredPort = options.port ?? DEFAULT_DOCS_EDITOR_PORT;

  const existing = service.readEditorLock();
  if (existing && existing.cwd === cwd && processAlive(existing.pid)) {
    const url = options.name
      ? `${existing.url.replace(/\/$/, '')}/?name=${encodeURIComponent(options.name)}`
      : existing.url;
    return {
      url,
      port: existing.port,
      host: existing.host,
      reused: true,
      close: async () => undefined,
    };
  }

  const app = createDocsEditorApp(service);
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(preferredPort, host, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://${host}:${address.port}`;
  const url = options.name
    ? `${baseUrl}/?name=${encodeURIComponent(options.name)}`
    : `${baseUrl}/`;

  const lock: EditorLock = {
    pid: process.pid,
    port: address.port,
    host,
    url: baseUrl + '/',
    cwd,
    startedAt: new Date().toISOString(),
  };
  service.writeEditorLock(lock);

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        service.clearEditorLock();
        if (err) reject(err);
        else resolve();
      });
    });

  const onExit = () => {
    try {
      service.clearEditorLock();
    } catch {
      // ignore
    }
  };
  process.once('exit', onExit);
  process.once('SIGINT', () => {
    void close().finally(() => process.exit(0));
  });

  return { url, port: address.port, host, reused: false, close };
}

export type { Server };
