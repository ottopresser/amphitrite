import type { PoseidonServerConfig } from './config';

export type HealthResponse = Record<string, string>;

export type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  checks: Array<{ name: string; ready: boolean; detail: string }>;
};

export type VmListItem = {
  fields: Record<string, string>;
};

export type VmListResponse = {
  raw: string;
  items: VmListItem[];
};

export type CommandResult = {
  command: string[];
  return_code: number;
  stdout: string;
  stderr: string;
};

export type VmInfoResponse = {
  vm_name: string;
  result: CommandResult;
};

export type VmConfigResponse = {
  vm_name: string;
  config_path: string;
  config: Record<string, string>;
};

export type VmActionResponse = {
  vm_name: string;
  action: string;
  result: CommandResult;
};

export type VmDetachMediaResponse = {
  vm_name: string;
  removed_keys: string[];
  removed_media: string[];
  config_updated: boolean;
};

export type HostSummarySection = {
  details: Record<string, unknown>;
  command_results: Record<string, CommandResult>;
};

export type HostSummaryResponse = {
  host: HostSummarySection;
  memory: HostSummarySection;
  disk: HostSummarySection;
  network: HostSummarySection;
};

export type VmCreateRequest = {
  vm_name: string;
  resources: {
    cpu: number;
    memory: string;
  };
  disk: {
    size: string;
    storage_target: string;
  };
  network: {
    switch: string;
    interface_type?: string;
  };
  boot: {
    source_type: 'template' | 'iso' | 'img';
    source: string;
  };
  options?: {
    start_after_create?: boolean;
    validate_only?: boolean;
    auto_start_on_boot?: boolean;
  };
};

export type VmMetricsResponse = {
  vm_name: string;
  state: string;
  configured_cpu?: number;
  configured_memory?: string;
  cpu_percent?: number;
  resident_memory_bytes?: number;
  uptime?: string;
  network?: Array<{
    interface: string;
    switch?: string;
    rx_bytes?: number;
    tx_bytes?: number;
    rx_packets?: number;
    tx_packets?: number;
  }>;
  scope_note: string;
};

export type NetworkInventoryResponse = {
  switches: Array<Record<string, string>>;
  interfaces: Array<Record<string, unknown>>;
  command_results: Record<string, CommandResult>;
};

export type OperationRecord = {
  operation_id: string;
  timestamp_epoch: number;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  client: string;
};

export type VmDiskItem = {
  index: number;
  name: string;
  device_type: string;
  emulation?: string;
  options?: string;
};

export type VmCreateResponse = {
  operation: string;
  status: string;
  vm_name: string;
  warnings?: Array<{
    code?: string;
    message?: string;
  }>;
  checks: Record<string, unknown>;
  result: {
    created: boolean;
    started: boolean;
  };
};

export type VmDeleteResponse = {
  operation: string;
  status: string;
  vm_name: string;
  result: {
    stopped: boolean;
    definition_deleted: boolean;
    disks_destroyed: boolean;
  };
};

export type BootMediaUploadResponse = {
  media_dir: string;
  item: {
    file_name: string;
    file_path: string;
    size_bytes: number;
    modified_epoch: number;
    checksum_sha256?: string;
  };
};

export type BootMediaItem = {
  file_name: string;
  file_path: string;
  size_bytes: number;
  modified_epoch: number;
  checksum_sha256?: string;
};

export type BootMediaListResponse = {
  media_dir: string;
  items: BootMediaItem[];
};

export type BootMediaDeleteResponse = {
  media_dir: string;
  file_name: string;
  file_path: string;
  deleted: boolean;
};

export type ServerOverview = {
  serverId: string;
  serverName: string;
  baseUrl: string;
  health: 'ok' | 'error';
  healthData: HealthResponse | null;
  hostSummary: HostSummaryResponse | null;
  vms: VmListItem[];
  error: string | null;
  lastUpdated: string;
};

function parseVmStateFromInfo(stdout: string): string {
  const match = /^\s+state:\s+(\S+)/m.exec(stdout);
  return match ? match[1].toLowerCase() : 'unknown';
}

async function requestPoseidon<T>(
  server: PoseidonServerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...server.headers,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`.trim());
  }

  return (await response.json()) as T;
}

export function fetchHealth(server: PoseidonServerConfig): Promise<HealthResponse> {
  return requestPoseidon<HealthResponse>(server, '/health');
}

export function fetchReadiness(server: PoseidonServerConfig): Promise<ReadinessResponse> {
  return requestPoseidon<ReadinessResponse>(server, '/ready');
}

export function fetchVmList(server: PoseidonServerConfig): Promise<VmListResponse> {
  return requestPoseidon<VmListResponse>(server, '/v1/vms');
}

export function fetchHostSummary(server: PoseidonServerConfig): Promise<HostSummaryResponse> {
  return requestPoseidon<HostSummaryResponse>(server, '/v1/host/summary');
}

export function fetchVmMetrics(
  server: PoseidonServerConfig,
  vmName?: string,
): Promise<{ items: VmMetricsResponse[] } | VmMetricsResponse> {
  return requestPoseidon(
    server,
    vmName ? `/v1/vms/${encodeURIComponent(vmName)}/metrics` : '/v1/vms/metrics',
  );
}

export function fetchNetworks(server: PoseidonServerConfig): Promise<NetworkInventoryResponse> {
  return requestPoseidon<NetworkInventoryResponse>(server, '/v1/networks');
}

export function fetchOperations(
  server: PoseidonServerConfig,
  limit: number,
): Promise<{ items: OperationRecord[] }> {
  return requestPoseidon(server, `/v1/operations?limit=${Math.max(1, Math.min(1000, limit))}`);
}

export function fetchVmInfo(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<VmInfoResponse> {
  return requestPoseidon<VmInfoResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}`,
  );
}

export function fetchVmConfig(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<VmConfigResponse> {
  return requestPoseidon<VmConfigResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/config`,
  );
}

export function performVmAction(
  server: PoseidonServerConfig,
  vmName: string,
  action: 'start' | 'stop' | 'restart',
): Promise<VmActionResponse> {
  return requestPoseidon<VmActionResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/${action}`,
    { method: 'POST' },
  );
}

export function performVmStop(
  server: PoseidonServerConfig,
  vmName: string,
  force: boolean,
): Promise<VmActionResponse> {
  const qs = force ? '?force=true' : '';
  return requestPoseidon<VmActionResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/stop${qs}`,
    { method: 'POST' },
  );
}

export function detachVmMedia(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<VmDetachMediaResponse> {
  return requestPoseidon<VmDetachMediaResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/detach-media`,
    { method: 'POST' },
  );
}

export async function attachVmMedia(
  server: PoseidonServerConfig,
  vmName: string,
  fileName: string,
): Promise<VmActionResponse & { media: BootMediaItem; disk_index: number }> {
  const [media, vmConfig] = await Promise.all([
    listBootMedia(server),
    fetchVmConfig(server, vmName),
  ]);
  const item = media.items.find((candidate) => candidate.file_name === fileName);

  if (!item) {
    throw new Error(`Uploaded media not found: ${fileName}`);
  }

  if (!item.file_name.toLowerCase().endsWith('.iso')) {
    throw new Error('Only ISO files can be attached as removable VM media.');
  }

  const usedIndexes = Object.keys(vmConfig.config)
    .map((key) => /^disk(\d+)_/.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  const diskIndex = usedIndexes.length > 0 ? Math.max(...usedIndexes) + 1 : 0;
  const result = await configureVm(server, vmName, [
    `disk${diskIndex}_type=ahci-cd`,
    `disk${diskIndex}_name=${item.file_path}`,
  ]);

  return { ...result, media: item, disk_index: diskIndex };
}

export async function attachVmDiskImage(
  server: PoseidonServerConfig,
  vmName: string,
  fileName: string,
  emulation: 'virtio-blk' | 'ahci-hd',
): Promise<VmActionResponse & { media: BootMediaItem; disk_index: number }> {
  const [media, vmConfig] = await Promise.all([
    listBootMedia(server),
    fetchVmConfig(server, vmName),
  ]);
  const item = media.items.find((candidate) => candidate.file_name === fileName);

  if (!item) {
    throw new Error(`Uploaded disk image not found: ${fileName}`);
  }

  if (!item.file_name.toLowerCase().endsWith('.img')) {
    throw new Error('Only IMG files can be attached as existing VM disks.');
  }

  const usedIndexes = Object.keys(vmConfig.config)
    .map((key) => /^disk(\d+)_/.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  const diskIndex = usedIndexes.length > 0 ? Math.max(...usedIndexes) + 1 : 0;
  const result = await configureVm(server, vmName, [
    `disk${diskIndex}_type=${emulation}`,
    `disk${diskIndex}_name=${item.file_path}`,
  ]);

  return { ...result, media: item, disk_index: diskIndex };
}

export function openVmConsole(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<VmActionResponse> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/console`, {
    method: 'POST',
  });
}

export function createVmConsoleToken(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<{
  vm_name: string;
  token_type: string;
  token: string;
  expires_in_seconds: number;
  expires_at_epoch: number;
  ws_path: string;
}> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/console/token`, {
    method: 'POST',
  });
}

export function fetchVmSnapshots(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<{ vm_name: string; items: string[] }> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/snapshots`);
}

export function createVmSnapshot(
  server: PoseidonServerConfig,
  vmName: string,
  payload: { snapshot_name?: string; force?: boolean },
): Promise<VmActionResponse> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function rollbackVmSnapshot(
  server: PoseidonServerConfig,
  vmName: string,
  payload: { snapshot_name: string; destroy_newer?: boolean },
): Promise<VmActionResponse> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/snapshots/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteVmSnapshot(
  server: PoseidonServerConfig,
  vmName: string,
  snapshotName: string,
): Promise<VmActionResponse> {
  return requestPoseidon(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/snapshots/${encodeURIComponent(snapshotName)}`,
    { method: 'DELETE' },
  );
}

export function cloneVm(
  server: PoseidonServerConfig,
  vmName: string,
  payload: { new_vm_name: string; snapshot_name?: string },
): Promise<{ source_vm_name: string; new_vm_name: string; result: CommandResult }> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function fetchVmDisks(
  server: PoseidonServerConfig,
  vmName: string,
): Promise<{ vm_name: string; items: VmDiskItem[] }> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/disks`);
}

export function addVmDisk(
  server: PoseidonServerConfig,
  vmName: string,
  payload: { device_type?: 'file' | 'zvol' | 'sparse-zvol'; size: string },
): Promise<VmActionResponse> {
  return requestPoseidon(server, `/v1/vms/${encodeURIComponent(vmName)}/disks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function detachVmDisk(
  server: PoseidonServerConfig,
  vmName: string,
  diskIndex: number,
): Promise<{
  vm_name: string;
  disk_index: number;
  removed_keys: string[];
  data_preserved: boolean;
}> {
  return requestPoseidon(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}/disks/${diskIndex}`,
    { method: 'DELETE' },
  );
}

export function createVm(
  server: PoseidonServerConfig,
  payload: VmCreateRequest,
): Promise<VmCreateResponse> {
  return requestPoseidon<VmCreateResponse>(server, '/v1/vms/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function deleteVm(
  server: PoseidonServerConfig,
  vmName: string,
  force: boolean,
  destroyDisks: boolean,
): Promise<VmDeleteResponse> {
  const params = new URLSearchParams();
  if (force) params.set('force', 'true');
  if (destroyDisks) params.set('destroy_disks', 'true');
  const query = params.toString();

  return requestPoseidon<VmDeleteResponse>(
    server,
    `/v1/vms/${encodeURIComponent(vmName)}${query ? `?${query}` : ''}`,
    { method: 'DELETE' },
  );
}

export async function uploadBootMedia(
  server: PoseidonServerConfig,
  bodyStream: NodeJS.ReadableStream,
  contentType: string,
  overwrite: boolean,
): Promise<BootMediaUploadResponse> {
  const query = overwrite ? '?overwrite=true' : '';
  const response = await fetch(`${server.baseUrl}/v1/boot-media/upload${query}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...server.headers,
      'Content-Type': contentType,
    },
    body: bodyStream as unknown as BodyInit,
    // Required by Node fetch for streaming request bodies.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`.trim());
  }

  return (await response.json()) as BootMediaUploadResponse;
}

export function listBootMedia(
  server: PoseidonServerConfig,
): Promise<BootMediaListResponse> {
  return requestPoseidon<BootMediaListResponse>(server, '/v1/boot-media');
}

export function deleteBootMedia(
  server: PoseidonServerConfig,
  fileName: string,
): Promise<BootMediaDeleteResponse> {
  return requestPoseidon<BootMediaDeleteResponse>(
    server,
    `/v1/boot-media/${encodeURIComponent(fileName)}`,
    { method: 'DELETE' },
  );
}

export type VmConfigureResponse = VmActionResponse;

export function configureVm(
  server: PoseidonServerConfig,
  vmName: string,
  options: string[],
): Promise<VmConfigureResponse> {
  return (async () => {
    const response = await fetch(`${server.baseUrl}/v1/vms/${encodeURIComponent(vmName)}/configure`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...server.headers,
        'Content-Type': 'application/json',
      },
      // Support Poseidon variants that read either `settings` or legacy `options`.
      body: JSON.stringify({ settings: options, options }),
    });

    if (response.ok) {
      return (await response.json()) as VmConfigureResponse;
    }

    const body = await response.text();
    if (/Vi's standard input and output must be a terminal/i.test(body) || /Usage:\s+vm/m.test(body)) {
      throw new Error(
        'This Poseidon host exposes /configure but runs vm-bhyve interactive mode, which cannot be used via API. Use host-side `vm set ...` directly or upgrade Poseidon to a non-interactive configure implementation.',
      );
    }

    throw new Error(`${response.status} ${response.statusText}: ${body}`.trim());
  })();
}

/** Returns the API key that should be used for this server (default or host-specific). */
export function getApiKey(server: PoseidonServerConfig): string {
  return server.headers['x-api-key'] ?? '';
}

export async function fetchServerOverview(
  server: PoseidonServerConfig,
): Promise<ServerOverview> {
  const timestamp = new Date().toISOString();
  const [healthResult, vmListResult, hostSummaryResult] = await Promise.allSettled([
    fetchHealth(server),
    fetchVmList(server),
    fetchHostSummary(server),
  ]);

  const healthData = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const rawVmList = vmListResult.status === 'fulfilled' ? vmListResult.value.items : [];
  const hostSummary = hostSummaryResult.status === 'fulfilled' ? hostSummaryResult.value : null;
  const vmError =
    vmListResult.status === 'rejected'
      ? vmListResult.reason instanceof Error
        ? vmListResult.reason.message
        : 'Unexpected VM inventory error'
      : null;
  const hostSummaryError =
    hostSummaryResult.status === 'rejected'
      ? hostSummaryResult.reason instanceof Error
        ? hostSummaryResult.reason.message
        : 'Unexpected host summary error'
      : null;
  const healthError =
    healthResult.status === 'rejected'
      ? healthResult.reason instanceof Error
        ? healthResult.reason.message
        : 'Unexpected healthcheck error'
      : null;

  const vmInfoResults = await Promise.allSettled(
    rawVmList.map((vm) => {
      const name = vm.fields['NAME'] ?? vm.fields['name'] ?? '';
      return name ? fetchVmInfo(server, name) : Promise.reject(new Error('no name'));
    }),
  );

  const vmList = rawVmList.map((vm, idx) => {
    const infoResult = vmInfoResults[idx];
    const resolvedState =
      infoResult.status === 'fulfilled'
        ? parseVmStateFromInfo(infoResult.value.result.stdout)
        : 'unknown';
    return {
      fields: {
        ...vm.fields,
        RESOLVED_STATE: resolvedState,
      },
    };
  });

  return {
    serverId: server.id,
    serverName: server.name,
    baseUrl: server.baseUrl,
    health: healthData ? 'ok' : 'error',
    healthData,
    hostSummary,
    vms: vmList,
    error: [healthError, vmError, hostSummaryError].filter(Boolean).join(' | ') || null,
    lastUpdated: timestamp,
  };
}
