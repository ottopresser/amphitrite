import { useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  Copy,
  Database,
  Disc3,
  GitPullRequestArrow,
  HardDrive,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';

type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  checks: Array<{ name: string; ready: boolean; detail: string }>;
};

type VmMetrics = {
  vm_name: string;
  state: string;
  configured_cpu?: number;
  configured_memory?: string;
  cpu_percent?: number | null;
  resident_memory_bytes?: number | null;
  uptime?: string;
  network?: Array<{
    interface: string;
    switch?: string;
    rx_bytes?: number;
    tx_bytes?: number;
  }>;
  scope_note: string;
};

type NetworkInventory = {
  switches: Array<Record<string, string>>;
  interfaces: Array<Record<string, unknown>>;
};

type Operation = {
  operation_id: string;
  timestamp_epoch: number;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number | null;
  client: string;
};

type VmDisk = {
  index: number;
  name: string;
  device_type: string;
  emulation?: string;
  options?: string;
};

type BootMediaItem = {
  file_name: string;
  file_path: string;
  size_bytes: number;
};

type VmDetachMediaResponse = {
  vm_name: string;
  removed_keys: string[];
  removed_media: string[];
  config_updated: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function bytes(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function LoadingButton({ loading }: { loading: boolean }) {
  return <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={16} />;
}

export function VmMetricsPanel({ serverId, vmName }: { serverId: string; vmName: string }) {
  const path = `/api/servers/${encodeURIComponent(serverId)}/vms/${encodeURIComponent(vmName)}/metrics`;
  const [metrics, setMetrics] = useState<VmMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setMetrics(await api<VmMetrics>(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load live metrics.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [serverId, vmName]);

  return (
    <section className="vm-metrics-panel">
      <div className="ops-section__heading">
        <Activity size={17} />
        <h3>Live metrics</h3>
        <button className="icon-button" disabled={loading} onClick={() => void refresh()} title="Refresh live metrics" type="button">
          <LoadingButton loading={loading} />
        </button>
      </div>
      {error ? <p className="callout callout--error">{error}</p> : null}
      <div className="inventory-grid inventory-grid--metrics">
        <div><span className="metric-label">State</span><strong>{metrics?.state ?? 'n/a'}</strong></div>
        <div><span className="metric-label">CPU usage</span><strong>{typeof metrics?.cpu_percent === 'number' ? `${metrics.cpu_percent.toFixed(1)}%` : 'n/a'}</strong></div>
        <div><span className="metric-label">Resident memory</span><strong>{bytes(metrics?.resident_memory_bytes)}</strong></div>
        <div><span className="metric-label">Uptime</span><strong>{metrics?.uptime ?? 'n/a'}</strong></div>
      </div>
    </section>
  );
}

export function HostOperationsPanel({ serverId }: { serverId: string }) {
  const encodedServer = encodeURIComponent(serverId);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [metrics, setMetrics] = useState<VmMetrics[]>([]);
  const [networks, setNetworks] = useState<NetworkInventory | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [readyPayload, metricsPayload, networkPayload, operationPayload] = await Promise.all([
        api<ReadinessResponse>(`/api/servers/${encodedServer}/readiness`),
        api<{ items: VmMetrics[] }>(`/api/servers/${encodedServer}/metrics`),
        api<NetworkInventory>(`/api/servers/${encodedServer}/networks`),
        api<{ items: Operation[] }>(`/api/servers/${encodedServer}/operations?limit=50`),
      ]);
      setReadiness(readyPayload);
      setMetrics(metricsPayload.items);
      setNetworks(networkPayload);
      setOperations(operationPayload.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load host operations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [serverId]);

  return (
    <div className="ops-stack">
      <div className="ops-toolbar">
        <div>
          <span className="section-kicker">Live API</span>
          <h3>Host operations</h3>
        </div>
        <button className="icon-button" disabled={loading} onClick={() => void refresh()} title="Refresh host data" type="button">
          <LoadingButton loading={loading} />
        </button>
      </div>
      {error ? <p className="callout callout--error">{error}</p> : null}

      <section className="ops-section">
        <div className="ops-section__heading"><Activity size={17} /><h4>Readiness</h4></div>
        <div className="readiness-list">
          {readiness?.checks.map((check) => (
            <div className="readiness-row" key={check.name}>
              <span className={check.ready ? 'status-dot status-dot--ok' : 'status-dot status-dot--error'} />
              <strong>{check.name}</strong>
              <span>{check.detail}</span>
            </div>
          )) ?? <span className="muted">Loading checks...</span>}
        </div>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><Activity size={17} /><h4>VM telemetry</h4></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>VM</th><th>State</th><th>CPU</th><th>Memory</th><th>Uptime</th></tr></thead>
            <tbody>
              {metrics.map((item) => (
                <tr key={item.vm_name}>
                  <td><strong>{item.vm_name}</strong></td><td>{item.state}</td>
                  <td>{typeof item.cpu_percent === 'number' ? `${item.cpu_percent.toFixed(1)}%` : 'n/a'}</td>
                  <td>{bytes(item.resident_memory_bytes)}</td><td>{item.uptime ?? 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><Network size={17} /><h4>Network inventory</h4></div>
        <div className="inventory-grid">
          <div><span className="metric-label">Switches</span><strong>{networks?.switches.length ?? 0}</strong></div>
          <div><span className="metric-label">Interfaces</span><strong>{networks?.interfaces.length ?? 0}</strong></div>
        </div>
        <div className="chip-list">
          {networks?.switches.map((item, index) => (
            <span className="data-chip" key={String(item['name'] ?? item['switch'] ?? index)}>
              {String(item['name'] ?? item['switch'] ?? `switch ${index + 1}`)}
            </span>
          ))}
        </div>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><GitPullRequestArrow size={17} /><h4>Recent operations</h4></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>
              {operations.map((item) => (
                <tr key={item.operation_id}>
                  <td>{new Date(item.timestamp_epoch * 1000).toLocaleTimeString()}</td>
                  <td><span className={`method method--${item.method.toLowerCase()}`}>{item.method}</span></td>
                  <td><code>{item.path}</code></td><td>{item.status_code}</td>
                  <td>{typeof item.duration_ms === 'number' ? `${item.duration_ms.toFixed(1)} ms` : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function VmOperationsPanel({ serverId, vmName, onChanged }: {
  serverId: string;
  vmName: string;
  onChanged: (message: string) => void;
}) {
  const root = `/api/servers/${encodeURIComponent(serverId)}/vms/${encodeURIComponent(vmName)}`;
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [disks, setDisks] = useState<VmDisk[]>([]);
  const [isoMedia, setIsoMedia] = useState<BootMediaItem[]>([]);
  const [diskImages, setDiskImages] = useState<BootMediaItem[]>([]);
  const [attachedMedia, setAttachedMedia] = useState<string[]>([]);
  const [selectedMedia, setSelectedMedia] = useState('');
  const [selectedDiskImage, setSelectedDiskImage] = useState('');
  const [imageEmulation, setImageEmulation] = useState<'virtio-blk' | 'ahci-hd'>('virtio-blk');
  const [snapshotName, setSnapshotName] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [diskSize, setDiskSize] = useState('10G');
  const [diskType, setDiskType] = useState<'file' | 'zvol' | 'sparse-zvol'>('file');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [snapshotPayload, diskPayload, mediaPayload, configPayload] = await Promise.all([
        api<{ items: string[] }>(`${root}/snapshots`),
        api<{ items: VmDisk[] }>(`${root}/disks`),
        api<{ items: BootMediaItem[] }>(`/api/servers/${encodeURIComponent(serverId)}/boot-media`),
        api<{ config: Record<string, string> }>(`${root}/config`),
      ]);
      setSnapshots(snapshotPayload.items);
      setDisks(diskPayload.items);
      const isoItems = mediaPayload.items.filter((item) => item.file_name.toLowerCase().endsWith('.iso'));
      const imageItems = mediaPayload.items.filter((item) => item.file_name.toLowerCase().endsWith('.img'));
      setIsoMedia(isoItems);
      setDiskImages(imageItems);
      setSelectedMedia((current) => current && isoItems.some((item) => item.file_name === current)
        ? current
        : isoItems[0]?.file_name ?? '');
      setSelectedDiskImage((current) => current && imageItems.some((item) => item.file_name === current)
        ? current
        : imageItems[0]?.file_name ?? '');
      const removable = Object.entries(configPayload.config)
        .filter(([key, value]) => /^disk\d+_type$/.test(key) && value === 'ahci-cd')
        .map(([key]) => configPayload.config[key.replace(/_type$/, '_name')])
        .filter((value): value is string => Boolean(value));
      setAttachedMedia(removable);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load VM operations.');
    } finally {
      setLoading(false);
    }
  }

  async function mutate(label: string, path: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      await api(path, init);
      onChanged(`${label} completed for ${vmName}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
    } finally {
      setBusy(null);
    }
  }

  async function attachMedia() {
    if (!selectedMedia) return;
    setBusy('Media attachment');
    setError(null);
    setNotice(null);
    try {
      await api(`${root}/attach-media`, {
        method: 'POST',
        body: JSON.stringify({ file_name: selectedMedia }),
      });
      onChanged(`${selectedMedia} attached to ${vmName}. Restart the VM if it is running.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Media attachment failed.');
    } finally {
      setBusy(null);
    }
  }

  async function detachMedia() {
    setBusy('Media detach');
    setError(null);
    setNotice(null);
    try {
      const payload = await api<VmDetachMediaResponse>(`${root}/detach-media`, { method: 'POST' });
      if (!payload.config_updated || payload.removed_media.length === 0) {
        setNotice('No removable media is attached to this VM.');
      } else {
        onChanged(`Detached ${payload.removed_media.join(', ')} from ${vmName}.`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Media detach failed.');
    } finally {
      setBusy(null);
    }
  }

  async function attachDiskImage() {
    if (!selectedDiskImage) return;
    setBusy('Disk image attachment');
    setError(null);
    setNotice(null);
    try {
      await api(`${root}/attach-disk-image`, {
        method: 'POST',
        body: JSON.stringify({
          file_name: selectedDiskImage,
          emulation: imageEmulation,
        }),
      });
      onChanged(`${selectedDiskImage} attached to ${vmName} as ${imageEmulation}. Restart the VM if it is running.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Disk image attachment failed.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => { void refresh(); }, [serverId, vmName]);

  return (
    <div className="ops-stack">
      <div className="ops-toolbar">
        <div><span className="section-kicker">Poseidon API</span><h3>VM operations</h3></div>
        <button className="icon-button" disabled={loading} onClick={() => void refresh()} title="Refresh VM operations" type="button">
          <LoadingButton loading={loading} />
        </button>
      </div>
      {error ? <p className="callout callout--error">{error}</p> : null}
      {notice ? <p className="callout callout--info">{notice}</p> : null}

      <section className="ops-section">
        <div className="ops-section__heading"><Disc3 size={17} /><h4>Removable media</h4></div>
        <div className="media-status">
          <span className="metric-label">Attached</span>
          <strong>{attachedMedia.length > 0 ? attachedMedia.join(', ') : 'None'}</strong>
        </div>
        <div className="media-controls">
          <select aria-label="Uploaded ISO" onChange={(event) => setSelectedMedia(event.target.value)} value={selectedMedia}>
            {isoMedia.length === 0 ? <option value="">No uploaded ISO files</option> : null}
            {isoMedia.map((item) => <option key={item.file_name} value={item.file_name}>{item.file_name}</option>)}
          </select>
          <button className="button button--small" disabled={busy !== null || !selectedMedia} onClick={() => void attachMedia()} type="button">
            Attach ISO
          </button>
          <button className="button button--ghost button--small" disabled={busy !== null || attachedMedia.length === 0} onClick={() => void detachMedia()} type="button">
            Detach media
          </button>
        </div>
        <p className="field-hint">Media changes update the VM definition. Restart a running VM to apply them.</p>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><Camera size={17} /><h4>Snapshots</h4></div>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          void mutate('Snapshot creation', `${root}/snapshots`, { method: 'POST', body: JSON.stringify({ snapshot_name: snapshotName || undefined }) });
        }}>
          <input onChange={(event) => setSnapshotName(event.target.value)} placeholder="Snapshot name (optional)" value={snapshotName} />
          <button className="button button--small" disabled={busy !== null} type="submit"><Plus size={15} />Create</button>
        </form>
        <div className="resource-list">
          {snapshots.map((name) => (
            <div className="resource-row" key={name}>
              <div><Camera size={16} /><code>{name}</code></div>
              <div className="resource-row__actions">
                <button className="icon-button" disabled={busy !== null} onClick={() => void mutate('Snapshot rollback', `${root}/snapshots/rollback`, { method: 'POST', body: JSON.stringify({ snapshot_name: name }) })} title={`Roll back to ${name}`} type="button"><RotateCcw size={15} /></button>
                <button className="icon-button icon-button--danger" disabled={busy !== null} onClick={() => void mutate('Snapshot deletion', `${root}/snapshots/${encodeURIComponent(name)}`, { method: 'DELETE' })} title={`Delete ${name}`} type="button"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
          {!loading && snapshots.length === 0 ? <span className="muted">No snapshots found.</span> : null}
        </div>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><Copy size={17} /><h4>Clone VM</h4></div>
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          if (cloneName.trim()) void mutate('VM clone', `${root}/clone`, { method: 'POST', body: JSON.stringify({ new_vm_name: cloneName.trim() }) });
        }}>
          <input onChange={(event) => setCloneName(event.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" placeholder="New VM name" required value={cloneName} />
          <button className="button button--small" disabled={busy !== null} type="submit"><Copy size={15} />Clone</button>
        </form>
      </section>

      <section className="ops-section">
        <div className="ops-section__heading"><Database size={17} /><h4>Virtual disks</h4></div>
        <div className="disk-operation">
          <span className="metric-label">Attach existing image</span>
          <div className="disk-image-controls">
            <select aria-label="Uploaded disk image" onChange={(event) => setSelectedDiskImage(event.target.value)} value={selectedDiskImage}>
              {diskImages.length === 0 ? <option value="">No uploaded IMG files</option> : null}
              {diskImages.map((item) => <option key={item.file_name} value={item.file_name}>{item.file_name}</option>)}
            </select>
            <select aria-label="Disk image emulation" onChange={(event) => setImageEmulation(event.target.value as typeof imageEmulation)} value={imageEmulation}>
              <option value="virtio-blk">VirtIO block</option>
              <option value="ahci-hd">AHCI disk</option>
            </select>
            <button className="button button--small" disabled={busy !== null || !selectedDiskImage} onClick={() => void attachDiskImage()} type="button">
              Attach image
            </button>
          </div>
        </div>
        <div className="disk-operation">
          <span className="metric-label">Create empty disk</span>
        <form className="inline-form inline-form--disk" onSubmit={(event) => {
          event.preventDefault();
          void mutate('Disk addition', `${root}/disks`, { method: 'POST', body: JSON.stringify({ device_type: diskType, size: diskSize }) });
        }}>
          <select onChange={(event) => setDiskType(event.target.value as typeof diskType)} value={diskType}>
            <option value="file">File</option><option value="zvol">ZFS volume</option><option value="sparse-zvol">Sparse ZFS volume</option>
          </select>
          <input onChange={(event) => setDiskSize(event.target.value)} pattern="[0-9.]+[KMGTP]?(I?B)?" placeholder="10G" required value={diskSize} />
          <button className="button button--small" disabled={busy !== null} type="submit"><Plus size={15} />Add disk</button>
        </form>
        </div>
        <div className="resource-list">
          {disks.map((disk) => (
            <div className="resource-row" key={disk.index}>
              <div><HardDrive size={16} /><span><strong>disk{disk.index}</strong> <span className="muted">{disk.name} · {disk.device_type}{disk.emulation ? ` · ${disk.emulation}` : ''}</span></span></div>
              <button className="icon-button icon-button--danger" disabled={busy !== null} onClick={() => void mutate('Disk detach', `${root}/disks/${disk.index}`, { method: 'DELETE' })} title={`Detach disk ${disk.index}; data is preserved`} type="button"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}