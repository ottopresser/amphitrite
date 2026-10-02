import express from 'express';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  deleteServerConfig,
  exportSettings,
  getEditableServerConfigs,
  getPublicServerConfigs,
  getServerConfig,
  getSettingsSummary,
  importSettings,
  saveServerConfig,
  updateDefaultCredentials,
} from './config';
import {
  addVmDisk,
  attachVmDiskImage,
  attachVmMedia,
  cloneVm,
  createVmConsoleToken,
  createVmSnapshot,
  createVm,
  deleteBootMedia,
  deleteVmSnapshot,
  deleteVm,
  detachVmMedia,
  detachVmDisk,
  configureVm,
  fetchNetworks,
  fetchOperations,
  fetchReadiness,
  fetchServerOverview,
  fetchVmConfig,
  fetchVmDisks,
  fetchVmInfo,
  fetchVmIpAddress,
  fetchVmMetrics,
  fetchVmSnapshots,
  getApiKey,
  openVmConsole,
  performVmAction,
  performVmStop,
  rollbackVmSnapshot,
  listBootMedia,
  uploadBootMedia,
} from './poseidon';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

const app = express();
const port = Number(process.env.PORT ?? 8787);

type ConsoleUpstreamAttempt = {
  name: string;
  url: string;
  headers?: Record<string, string>;
};

type VncEndpoint = {
  host: string;
  port: number;
};

function isExpectedRestartStopError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('not running')
    || lowered.includes('already stopped')
    || lowered.includes('is stopped')
    || lowered.includes('state: stopped')
  );
}

function parseStateFromInfo(stdout: string): string {
  const match = /^\s+state:\s+(\S+)/m.exec(stdout);
  return match ? match[1].toLowerCase() : 'unknown';
}

async function waitForVmStopped(serverId: string, vmName: string): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const vmInfo = await fetchVmInfo(getServerConfig(serverId), vmName);
      const state = parseStateFromInfo(vmInfo.result.stdout);
      if (state !== 'running' && state !== 'starting') {
        return true;
      }
    } catch {
      // Keep polling through transient errors while the guest transitions.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

async function connectConsoleUpstream(
  attempts: ConsoleUpstreamAttempt[],
): Promise<{ socket: WebSocket; attemptName: string }> {
  let lastError = 'No console upstream attempts were made.';

  for (const attempt of attempts) {
    const result = await new Promise<
      | { ok: true; socket: WebSocket }
      | { ok: false; error: string }
    >((resolve) => {
      const upstream = new WebSocket(attempt.url, {
        headers: attempt.headers,
      });

      const cleanup = () => {
        upstream.removeAllListeners('open');
        upstream.removeAllListeners('unexpected-response');
        upstream.removeAllListeners('error');
      };

      upstream.once('open', () => {
        cleanup();
        resolve({ ok: true, socket: upstream });
      });

      upstream.once('unexpected-response', (_req, res) => {
        cleanup();
        const status = res.statusCode ?? 'unknown';
        const detail = `upgrade rejected (${status}) via ${attempt.name}`;
        resolve({ ok: false, error: detail });
      });

      upstream.once('error', (err) => {
        cleanup();
        const msg = err instanceof Error ? err.message : String(err);
        resolve({ ok: false, error: `${msg} via ${attempt.name}` });
      });
    });

    if (result.ok) {
      return { socket: result.socket, attemptName: attempt.name };
    }

    lastError = result.error;
  }

  throw new Error(lastError);
}

function normalizeVncHost(host: string, fallbackHost: string): string {
  const lowered = host.toLowerCase();
  if (
    lowered === '0.0.0.0'
    || lowered === '127.0.0.1'
    || lowered === 'localhost'
    || lowered === '::'
    || lowered === '::1'
  ) {
    return fallbackHost;
  }
  return host;
}

function getHostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '127.0.0.1';
  }
}

function extractVncEndpoint(stdout: string, fallbackHost: string): VncEndpoint | null {
  const lines = stdout.split('\n');

  for (const line of lines) {
    if (!/vnc/i.test(line)) {
      continue;
    }

    const hostPort = line.match(/((?:\d{1,3}\.){3}\d{1,3}|localhost|[a-zA-Z0-9.-]+):(\d{2,5})/);
    if (hostPort) {
      const port = Number(hostPort[2]);
      if (port > 0 && port <= 65535) {
        return {
          host: normalizeVncHost(hostPort[1], fallbackHost),
          port,
        };
      }
    }

    const portOnly = line.match(/\bport\s*(?:=|:)?\s*(\d{2,5})\b/i) ?? line.match(/:(\d{2,5})\b/);
    if (portOnly) {
      const port = Number(portOnly[1]);
      if (port > 0 && port <= 65535) {
        return {
          host: fallbackHost,
          port,
        };
      }
    }
  }

  return null;
}

app.use(express.json());

app.get('/api/settings', (_request, response) => {
  response.json(getSettingsSummary());
});

app.get('/api/settings/servers', (_request, response) => {
  response.json({ servers: getEditableServerConfigs() });
});

app.put('/api/settings/defaults', (request, response) => {
  try {
    response.json(updateDefaultCredentials(request.body));
  } catch (error) {
    response.status(400).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.get('/api/settings/export', (_request, response) => {
  response.json(exportSettings());
});

app.post('/api/settings/import', (request, response) => {
  try {
    response.json(importSettings(request.body));
  } catch (error) {
    response.status(400).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/settings/servers', (request, response) => {
  try {
    const servers = saveServerConfig(request.body);
    response.status(201).json({ servers });
  } catch (error) {
    response.status(400).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.put('/api/settings/servers/:serverId', (request, response) => {
  try {
    const servers = saveServerConfig(request.body, request.params.serverId);
    response.json({ servers });
  } catch (error) {
    response.status(400).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.delete('/api/settings/servers/:serverId', (request, response) => {
  try {
    const servers = deleteServerConfig(request.params.serverId);
    response.json({ servers });
  } catch (error) {
    response.status(404).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.get('/api/servers', (_request, response) => {
  response.json({ servers: getPublicServerConfigs() });
});

app.get('/api/overview', async (_request, response) => {
  const configs = getPublicServerConfigs();
  const overviews = await Promise.all(
    configs.map(({ id }) => fetchServerOverview(getServerConfig(id))),
  );
  response.json({ servers: overviews });
});

app.get('/api/servers/:serverId/readiness', async (request, response) => {
  try {
    response.json(await fetchReadiness(getServerConfig(request.params.serverId)));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/metrics', async (request, response) => {
  try {
    response.json(await fetchVmMetrics(getServerConfig(request.params.serverId)));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/networks', async (request, response) => {
  try {
    response.json(await fetchNetworks(getServerConfig(request.params.serverId)));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/operations', async (request, response) => {
  try {
    const limit = Number(request.query['limit'] ?? 100);
    response.json(await fetchOperations(getServerConfig(request.params.serverId), limit));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/vms/metrics', async (request, response) => {
  try {
    response.json(await fetchVmMetrics(getServerConfig(request.params.serverId)));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/vms/:vmName', async (request, response) => {
  try {
    const payload = await fetchVmInfo(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.get('/api/servers/:serverId/vms/:vmName/ip', async (request, response) => {
  try {
    response.json(await fetchVmIpAddress(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/vms/:vmName/config', async (request, response) => {
  try {
    const payload = await fetchVmConfig(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.get('/api/servers/:serverId/vms/:vmName/metrics', async (request, response) => {
  try {
    response.json(await fetchVmMetrics(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/console', async (request, response) => {
  try {
    response.json(await openVmConsole(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/console/token', async (request, response) => {
  try {
    response.json(await createVmConsoleToken(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/vms/:vmName/snapshots', async (request, response) => {
  try {
    response.json(await fetchVmSnapshots(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/snapshots', async (request, response) => {
  try {
    response.json(await createVmSnapshot(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      request.body,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/snapshots/rollback', async (request, response) => {
  try {
    response.json(await rollbackVmSnapshot(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      request.body,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.delete('/api/servers/:serverId/vms/:vmName/snapshots/:snapshotName', async (request, response) => {
  try {
    response.json(await deleteVmSnapshot(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      request.params.snapshotName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/clone', async (request, response) => {
  try {
    response.status(201).json(await cloneVm(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      request.body,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.get('/api/servers/:serverId/vms/:vmName/disks', async (request, response) => {
  try {
    response.json(await fetchVmDisks(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/disks', async (request, response) => {
  try {
    response.status(201).json(await addVmDisk(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      request.body,
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.delete('/api/servers/:serverId/vms/:vmName/disks/:diskIndex', async (request, response) => {
  try {
    response.json(await detachVmDisk(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      Number(request.params.diskIndex),
    ));
  } catch (error) {
    response.status(502).json({ detail: error instanceof Error ? error.message : 'Unexpected error' });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/actions/:action', async (request, response) => {
  try {
    const action = request.params.action;

    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      response.status(400).json({ detail: `Unsupported action '${action}'.` });
      return;
    }

    const server = getServerConfig(request.params.serverId);
    const vmName = request.params.vmName;

    if (action === 'restart') {
      // Restart is always implemented explicitly as stop -> start.
      let stopResult: unknown = null;
      try {
        const stopPayload = await performVmStop(server, vmName, false);
        stopResult = stopPayload.result;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!isExpectedRestartStopError(detail)) {
          response.status(502).json({ detail: `Restart failed during stop: ${detail}` });
          return;
        }
      }

      let stopped = await waitForVmStopped(request.params.serverId, vmName);

      if (!stopped) {
        try {
          await performVmStop(server, vmName, true);
          stopped = await waitForVmStopped(request.params.serverId, vmName);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          response.status(502).json({ detail: `Restart failed during force-stop: ${detail}` });
          return;
        }
      }

      if (!stopped) {
        response.status(502).json({ detail: 'Restart failed: VM did not reach stopped state in time.' });
        return;
      }

      const startPayload = await performVmAction(server, vmName, 'start');
      response.json({
        vm_name: vmName,
        action: 'restart',
        result: startPayload.result,
        restart: {
          stop: stopResult,
          start: startPayload.result,
        },
      });
      return;
    }

    const payload = await performVmAction(server, vmName, action);
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/stop', async (request, response) => {
  try {
    const force = request.query['force'] === 'true';
    const payload = await performVmStop(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      force,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/detach-media', async (request, response) => {
  try {
    const payload = await detachVmMedia(
      getServerConfig(request.params.serverId),
      request.params.vmName,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/attach-media', async (request, response) => {
  try {
    const fileName = typeof request.body?.file_name === 'string'
      ? request.body.file_name.trim()
      : '';
    if (!fileName) {
      response.status(400).json({ detail: 'file_name is required.' });
      return;
    }
    response.json(await attachVmMedia(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      fileName,
    ));
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/attach-disk-image', async (request, response) => {
  try {
    const fileName = typeof request.body?.file_name === 'string'
      ? request.body.file_name.trim()
      : '';
    const emulation = request.body?.emulation;
    if (!fileName) {
      response.status(400).json({ detail: 'file_name is required.' });
      return;
    }
    if (emulation !== 'virtio-blk' && emulation !== 'ahci-hd') {
      response.status(400).json({ detail: 'emulation must be virtio-blk or ahci-hd.' });
      return;
    }
    response.json(await attachVmDiskImage(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      fileName,
      emulation,
    ));
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/:vmName/configure', async (request, response) => {
  try {
    const body = request.body as { options?: string[]; settings?: string[] };
    const options = Array.isArray(body.options)
      ? body.options
      : Array.isArray(body.settings)
        ? body.settings
        : [];
    console.log('[vm-configure] incoming configure request', {
      serverId: request.params.serverId,
      vmName: request.params.vmName,
      options,
      body,
    });
    const payload = await configureVm(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      options,
    );
    response.json(payload);
  } catch (error) {
    console.error('[vm-configure] configure error', {
      serverId: request.params.serverId,
      vmName: request.params.vmName,
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/vms/create', async (request, response) => {
  try {
    const payload = await createVm(
      getServerConfig(request.params.serverId),
      request.body,
    );
    response.status(201).json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.delete('/api/servers/:serverId/vms/:vmName', async (request, response) => {
  try {
    const force = request.query['force'] === 'true';
    const destroyDisks = request.query['destroy_disks'] === 'true';
    const payload = await deleteVm(
      getServerConfig(request.params.serverId),
      request.params.vmName,
      force,
      destroyDisks,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.post('/api/servers/:serverId/boot-media/upload', async (request, response) => {
  try {
    const contentType = request.headers['content-type'];

    if (!contentType) {
      response.status(400).json({ detail: 'Missing Content-Type header.' });
      return;
    }

    const overwrite = request.query['overwrite'] === 'true';
    const payload = await uploadBootMedia(
      getServerConfig(request.params.serverId),
      request,
      contentType,
      overwrite,
    );
    response.status(201).json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.get('/api/servers/:serverId/boot-media', async (request, response) => {
  try {
    const payload = await listBootMedia(getServerConfig(request.params.serverId));
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

app.delete('/api/servers/:serverId/boot-media/:fileName', async (request, response) => {
  try {
    const payload = await deleteBootMedia(
      getServerConfig(request.params.serverId),
      request.params.fileName,
    );
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      detail: error instanceof Error ? error.message : 'Unexpected error',
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'));
  });
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://localhost`);
  const match = url.pathname.match(/^\/api\/servers\/([^/]+)\/vms\/([^/]+)\/(console|vnc)\/ws$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const serverId = decodeURIComponent(match[1]);
  const vmName = decodeURIComponent(match[2]);
  const transport = match[3];

  if (transport === 'vnc') {
    wss.handleUpgrade(request, socket, head, (clientWs) => {
      void (async () => {
        try {
          const serverConfig = getServerConfig(serverId);
          const vmInfo = await fetchVmInfo(serverConfig, vmName);
          const fallbackHost = getHostFromBaseUrl(serverConfig.baseUrl);
          const endpoint = extractVncEndpoint(vmInfo.result.stdout, fallbackHost);

          if (!endpoint) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1011, 'No VNC endpoint found in VM info output.');
            }
            return;
          }

          const upstream = createConnection({ host: endpoint.host, port: endpoint.port });

          upstream.on('data', (chunk) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(chunk, { binary: true });
            }
          });

          upstream.on('error', (error) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              const message = error instanceof Error ? error.message : 'VNC upstream TCP error';
              clientWs.close(1011, message);
            }
          });

          upstream.on('close', () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1000);
            }
          });

          clientWs.on('message', (data, isBinary) => {
            if (upstream.destroyed) {
              return;
            }

            if (Buffer.isBuffer(data)) {
              upstream.write(data);
              return;
            }

            if (data instanceof ArrayBuffer) {
              upstream.write(Buffer.from(data));
              return;
            }

            if (Array.isArray(data)) {
              upstream.write(Buffer.concat(data));
              return;
            }

            if (!isBinary && typeof data === 'string') {
              upstream.write(data);
            }
          });

          clientWs.on('close', () => {
            if (!upstream.destroyed) {
              upstream.end();
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unexpected VNC proxy error';
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, message);
          }
        }
      })();
    });
    return;
  }

  wss.handleUpgrade(request, socket, head, (clientWs) => {
    try {
      const serverConfig = getServerConfig(serverId);
      const apiKey = getApiKey(serverConfig);
      const wsBase = serverConfig.baseUrl.replace(/^http/i, 'ws');
      const encodedVm = encodeURIComponent(vmName);
      const encodedApiKey = encodeURIComponent(apiKey);
      const adminToken = serverConfig.headers['x-admin-token'];

      const attempts: ConsoleUpstreamAttempt[] = [
        {
          name: 'query-api-key /console/ws',
          url: `${wsBase}/v1/vms/${encodedVm}/console/ws?api_key=${encodedApiKey}`,
        },
        {
          name: 'header-api-key /console/ws',
          url: `${wsBase}/v1/vms/${encodedVm}/console/ws`,
          headers: { 'x-api-key': apiKey },
        },
        {
          name: 'query-api-key /console',
          url: `${wsBase}/v1/vms/${encodedVm}/console?api_key=${encodedApiKey}`,
        },
        {
          name: 'header-api-key /console',
          url: `${wsBase}/v1/vms/${encodedVm}/console`,
          headers: { 'x-api-key': apiKey },
        },
      ];

      if (adminToken) {
        attempts.push({
          name: 'header-admin-token /console/ws',
          url: `${wsBase}/v1/vms/${encodedVm}/console/ws`,
          headers: { 'x-admin-token': adminToken },
        });
      }

      void (async () => {
        try {
          const { socket: upstream, attemptName } = await connectConsoleUpstream(attempts);

          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'connected', attempt: attemptName }));
          }

          upstream.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data);
            }
          });

          clientWs.on('message', (data) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data);
            }
          });

          upstream.on('close', (code) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              // 1005/1006 are reserved internal codes that cannot be sent via ws.close()
              const safeCode = (code === 1005 || code === 1006) ? 1000 : code;
              clientWs.close(safeCode);
            }
          });

          clientWs.on('close', (code) => {
            if (upstream.readyState === WebSocket.OPEN) {
              const safeCode = (code === 1005 || code === 1006) ? 1000 : code;
              upstream.close(safeCode);
            }
          });

          upstream.on('error', (err) => {
            const msg = err instanceof Error ? err.message : 'Upstream error';
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'error', message: msg }));
              clientWs.close(1011);
            }
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown console upstream error';
          const unsupported = message.includes('upgrade rejected (404)');
          const detail = unsupported
            ? 'Console endpoint is not available on this Poseidon host/version.'
            : `Console connection failed: ${message}`;
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: detail }));
            clientWs.close(1011);
          }
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Configuration error';
      clientWs.send(JSON.stringify({ type: 'error', message: msg }));
      clientWs.close(1011);
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Amphitrite server listening on http://127.0.0.1:${port}`);
});
