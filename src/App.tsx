import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Moon, Plus, RefreshCw, Settings, Sun, Trash2, Upload } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { HostOperationsPanel, VmMetricsPanel, VmOperationsPanel } from './PoseidonPanels';
import { extractVmVncEndpoint, humanSize, parseVmInfoStdout, usagePercent } from './vmInfoParser';
import type {
  BootMediaDeleteResponse,
  BootMediaItem,
  BootMediaListResponse,
  BootMediaUploadResponse,
  DefaultCredentialsInput,
  EditableServerConfig,
  ExportedSettings,
  HostSummarySection,
  ServerOverview,
  ServerSettingsInput,
  SettingsSummary,
  VmActionResponse,
  VmCreateRequest,
  VmCreateResponse,
  VmConfigResponse,
  VmDeleteResponse,
  VmInfoResponse,
  VmListItem,
} from './types';

type Selection = {
  serverId: string;
  vmName?: string;
};

const emptySettingsForm: ServerSettingsInput = {
  id: '',
  name: '',
  baseUrl: 'http://',
  xApiKey: '',
  xAdminToken: '',
  clearApiKey: false,
  clearAdminToken: false,
};

const emptyDefaultsForm: DefaultCredentialsInput = {
  xApiKey: '',
  xAdminToken: '',
  clearApiKey: false,
  clearAdminToken: false,
};

function getField(fields: Record<string, string>, keys: string[]): string {
  const entries = Object.entries(fields);

  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === key);

    if (match) {
      return match[1];
    }
  }

  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey.toLowerCase().includes(key));

    if (match) {
      return match[1];
    }
  }

  return 'Unknown';
}

function getVmName(item: VmListItem): string {
  return getField(item.fields, ['vm_name', 'name', 'vm']);
}

function formatFleetVmName(name: string): string {
  return name.replace(/-/g, '.');
}

function getToggleLabel(isExpanded: boolean): string {
  return isExpanded ? 'Collapse host' : 'Expand host';
}

function getVmState(item: VmListItem): string {
  // Prefer the resolved state injected by the server; fall back to the raw LIST field
  const resolved = item.fields['RESOLVED_STATE'];
  if (resolved && resolved !== 'unknown') return resolved;
  return getField(item.fields, ['state', 'status']);
}

function getStateClass(state: string): string {
  const s = state.toLowerCase();
  if (s === 'running') return 'state-badge state-badge--running';
  if (s === 'stopped' || s === 'stop') return 'state-badge state-badge--stopped';
  if (s.startsWith('stop')) return 'state-badge state-badge--stopping';
  if (s.startsWith('start') || s === 'starting') return 'state-badge state-badge--starting';
  if (s === 'locked') return 'state-badge state-badge--locked';
  return 'state-badge state-badge--unknown';
}

function getVmCpu(item: VmListItem): string {
  return getField(item.fields, ['cpu', 'cpus', 'vcpu', 'vcpus']);
}

function VmDetailPanel({ detail }: { detail: VmInfoResponse }) {
  if (detail.result.return_code !== 0) {
    return (
      <div className="vm-detail">
        <p className="callout callout--error">
          Command exited with code {detail.result.return_code}.
          {detail.result.stderr ? ` ${detail.result.stderr}` : ''}
        </p>
      </div>
    );
  }

  const p = parseVmInfoStdout(detail.result.stdout, detail.vm_name);
  const rawState = p.overview['state'] ?? '';
  const stateWord = rawState.split(/\s+/)[0] ?? 'unknown';

  const nics = p.sections.filter((s) => s.type === 'network-interface');
  const disks = p.sections.filter((s) => s.type === 'virtual-disk');
  const consolePorts = p.sections.find((s) => s.type === 'console-ports');

  return (
    <div className="vm-detail">
      {/* Overview */}
      <section className="vm-detail__section">
        <h3 className="vm-detail__section-title">Overview</h3>
        <div className="vm-detail__overview-grid">
          <div className="vm-detail__stat">
            <span className="vm-detail__label">State</span>
            <span className={getStateClass(stateWord)}>
              {stateWord}
            </span>
          </div>
          {p.overview['cpu'] ? (
            <div className="vm-detail__stat">
              <span className="vm-detail__label">CPU</span>
              <strong>{p.overview['cpu']} vCPU</strong>
            </div>
          ) : null}
          {p.overview['memory'] ? (
            <div className="vm-detail__stat">
              <span className="vm-detail__label">Memory</span>
              <strong>{p.overview['memory']}</strong>
            </div>
          ) : null}
          {p.overview['memory-resident'] ? (
            <div className="vm-detail__stat">
              <span className="vm-detail__label">Resident</span>
              <strong>{humanSize(p.overview['memory-resident'])}</strong>
            </div>
          ) : null}
          {p.overview['loader'] ? (
            <div className="vm-detail__stat">
              <span className="vm-detail__label">Loader</span>
              <strong>{p.overview['loader']}</strong>
            </div>
          ) : null}
          {p.overview['datastore'] ? (
            <div className="vm-detail__stat">
              <span className="vm-detail__label">Datastore</span>
              <strong>{p.overview['datastore']}</strong>
            </div>
          ) : null}
        </div>
      </section>

      {/* Console ports */}
      {consolePorts && Object.keys(consolePorts.fields).length > 0 ? (
        <section className="vm-detail__section">
          <h3 className="vm-detail__section-title">Console</h3>
          <div className="vm-detail__cards">
            <div className="vm-detail__card">
              <div className="vm-detail__fields">
                {Object.entries(consolePorts.fields).map(([key, val]) => (
                  <div className="vm-detail__field" key={key}>
                    <span className="vm-detail__label">{key}</span>
                    <code>{val}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Network interfaces */}
      {nics.length > 0 ? (
        <section className="vm-detail__section">
          <h3 className="vm-detail__section-title">Network</h3>
          <div className="vm-detail__cards">
            {nics.map((nic) => (
              <div className="vm-detail__card" key={nic.fields['number'] ?? nic.fields['emulation']}>
                <div className="vm-detail__card-title">
                  Interface {nic.fields['number']}
                  {nic.fields['emulation'] ? <span className="tag">{nic.fields['emulation']}</span> : null}
                </div>
                <div className="vm-detail__fields">
                  {nic.fields['virtual-switch'] ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">Switch</span>
                      <strong>{nic.fields['virtual-switch']}</strong>
                    </div>
                  ) : null}
                  {nic.fields['active-device'] && nic.fields['active-device'] !== '-' ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">Device</span>
                      <code>{nic.fields['active-device']}</code>
                    </div>
                  ) : null}
                  {nic.fields['fixed-mac-address'] ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">MAC</span>
                      <code>{nic.fields['fixed-mac-address']}</code>
                    </div>
                  ) : null}
                  {nic.fields['bridge'] ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">Bridge</span>
                      <code>{nic.fields['bridge']}</code>
                    </div>
                  ) : null}
                  {extractNicIpAddresses(nic.fields).length > 0 ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">IP Addresses</span>
                      <code>{extractNicIpAddresses(nic.fields).join(', ')}</code>
                    </div>
                  ) : null}
                </div>
                {nic.fields['bytes-in'] ?? nic.fields['bytes-out'] ? (
                  <div className="vm-detail__traffic">
                    <div className="vm-detail__traffic-row">
                      <span>↓ In</span>
                      <strong>{humanSize(nic.fields['bytes-in'] ?? '-')}</strong>
                    </div>
                    <div className="vm-detail__traffic-row">
                      <span>↑ Out</span>
                      <strong>{humanSize(nic.fields['bytes-out'] ?? '-')}</strong>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Virtual disks */}
      {disks.length > 0 ? (
        <section className="vm-detail__section">
          <h3 className="vm-detail__section-title">Storage</h3>
          <div className="vm-detail__cards">
            {disks.map((disk) => {
              const pct =
                disk.fields['bytes-size'] && disk.fields['bytes-used']
                  ? usagePercent(disk.fields['bytes-used'], disk.fields['bytes-size'])
                  : null;
              return (
                <div className="vm-detail__card" key={disk.fields['number'] ?? disk.fields['system-path']}>
                  <div className="vm-detail__card-title">
                    Disk {disk.fields['number']}
                    {disk.fields['emulation'] ? <span className="tag">{disk.fields['emulation']}</span> : null}
                  </div>
                  {disk.fields['system-path'] ? (
                    <div className="vm-detail__field">
                      <span className="vm-detail__label">Path</span>
                      <code className="vm-detail__path">{disk.fields['system-path']}</code>
                    </div>
                  ) : null}
                  <div className="vm-detail__fields">
                    {disk.fields['bytes-size'] ? (
                      <div className="vm-detail__field">
                        <span className="vm-detail__label">Size</span>
                        <strong>{humanSize(disk.fields['bytes-size'])}</strong>
                      </div>
                    ) : null}
                    {disk.fields['bytes-used'] ? (
                      <div className="vm-detail__field">
                        <span className="vm-detail__label">Used</span>
                        <strong>{humanSize(disk.fields['bytes-used'])}</strong>
                      </div>
                    ) : null}
                  </div>
                  {pct !== null ? (
                    <div className="vm-detail__usage">
                      <div className="vm-detail__usage-bar">
                        <div
                          className={`vm-detail__usage-fill${pct >= 90 ? ' vm-detail__usage-fill--critical' : pct >= 70 ? ' vm-detail__usage-fill--warning' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="vm-detail__usage-pct">{pct}%</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type ConfigureFormState = { cpu: string; memory: string; loader: string };
type DiskFormState = { type: string; path: string };
type NicFormState = { type: string; switch: string; mac: string };

function VmConfigurePanel({
  serverId,
  vmName,
  currentInfo,
  onDone,
}: {
  serverId: string;
  vmName: string;
  currentInfo: VmInfoResponse | null;
  onDone: (msg: string) => void;
}) {
  const parsed = useMemo(
    () => (currentInfo ? parseVmInfoStdout(currentInfo.result.stdout, currentInfo.vm_name) : null),
    [currentInfo],
  );

  const [form, setForm] = useState<ConfigureFormState>({ cpu: '', memory: '', loader: '' });
  const [disks, setDisks] = useState<DiskFormState[]>([]);
  const [nics, setNics] = useState<NicFormState[]>([]);
  const [extra, setExtra] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cmdOutput, setCmdOutput] = useState<string | null>(null);

  // Pre-populate when VM detail loads (may arrive after mount)
  useEffect(() => {
    if (!parsed) return;
    setForm({
      cpu: parsed.overview['cpu'] ?? '',
      memory: parsed.overview['memory'] ?? '',
      loader: parsed.overview['loader'] ?? '',
    });
    const parsedDisks = parsed.sections.filter((s) => s.type === 'virtual-disk');
    setDisks(
      parsedDisks.map((d) => ({
        type: d.fields['emulation'] ?? '',
        path: d.fields['system-path'] ?? '',
      })),
    );
    const parsedNics = parsed.sections.filter((s) => s.type === 'network-interface');
    setNics(
      parsedNics.map((n) => ({
        type: n.fields['emulation'] ?? '',
        switch: n.fields['virtual-switch'] ?? '',
        mac: n.fields['fixed-mac-address'] ?? '',
      })),
    );
  }, [parsed]);

  function setDiskField(idx: number, key: keyof DiskFormState, value: string) {
    setDisks((prev) => prev.map((d, i) => (i === idx ? { ...d, [key]: value } : d)));
  }

  function setNicField(idx: number, key: keyof NicFormState, value: string) {
    setNics((prev) => prev.map((n, i) => (i === idx ? { ...n, [key]: value } : n)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCmdOutput(null);

    const settings: string[] = [];
    const currentCpu = (current?.['cpu'] ?? '').trim();
    const currentMemory = (current?.['memory'] ?? '').trim();
    const currentLoader = (current?.['loader'] ?? '').trim();

    const nextCpu = form.cpu.trim();
    const nextMemory = form.memory.trim();
    const nextLoader = form.loader.trim();

    if (nextCpu && nextCpu !== currentCpu) settings.push(`cpu=${nextCpu}`);
    if (nextMemory && nextMemory !== currentMemory) settings.push(`memory=${nextMemory}`);
    if (nextLoader && nextLoader !== currentLoader) settings.push(`loader=${nextLoader}`);
    const parsedDisksRef = parsed?.sections.filter((s) => s.type === 'virtual-disk') ?? [];
    disks.forEach((d, i) => {
      const orig = parsedDisksRef[i];
      if (d.type.trim() && d.type.trim() !== (orig?.fields['emulation'] ?? '').trim())
        settings.push(`disk${i}_type=${d.type.trim()}`);
      if (d.path.trim() && d.path.trim() !== (orig?.fields['system-path'] ?? '').trim())
        settings.push(`disk${i}_path=${d.path.trim()}`);
    });

    const parsedNicsRef = parsed?.sections.filter((s) => s.type === 'network-interface') ?? [];
    nics.forEach((n, i) => {
      const orig = parsedNicsRef[i];
      if (n.type.trim() && n.type.trim() !== (orig?.fields['emulation'] ?? '').trim())
        settings.push(`network${i}_type=${n.type.trim()}`);
      if (n.switch.trim() && n.switch.trim() !== (orig?.fields['virtual-switch'] ?? '').trim())
        settings.push(`network${i}_switch=${n.switch.trim()}`);
      if (n.mac.trim() && n.mac.trim() !== (orig?.fields['fixed-mac-address'] ?? '').trim())
        settings.push(`network${i}_mac=${n.mac.trim()}`);
    });

    extra.split('\n').forEach((line) => {
      const t = line.trim();
      if (t) settings.push(t);
    });

    if (settings.length === 0) {
      setError('No changes to apply.');
      setBusy(false);
      return;
    }

    try {
      const encodedServer = encodeURIComponent(serverId);
      const encodedVm = encodeURIComponent(vmName);
      const endpoint = 'configure';
      let result: VmActionResponse | null = null;

      console.debug('[vm-configure] submit', {
        serverId,
        vmName,
        settings,
        endpoint,
      });

      const url = `/api/servers/${encodedServer}/vms/${encodedVm}/${endpoint}`;
      console.debug('[vm-configure] request', {
        endpoint,
        url,
        settings,
      });
      const res = await fetch(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          // Keep legacy payload key for compatibility while preferring settings naming.
          body: JSON.stringify({ settings, options: settings }),
        },
      );

      const raw = await res.text();
      let payload: VmActionResponse | { detail?: string } | null = null;
      if (raw.trim().length > 0) {
        try {
          payload = JSON.parse(raw) as VmActionResponse | { detail?: string };
        } catch {
          payload = null;
        }
      }

      console.debug('[vm-configure] response', {
        endpoint,
        status: res.status,
        ok: res.ok,
        raw,
      });

      if (!res.ok) {
        const detail = payload && 'detail' in payload ? payload.detail : null;
        throw new Error(detail ?? (raw.trim() || `${res.status} ${res.statusText}`));
      }

      result = payload as VmActionResponse;

      if (!result) {
        throw new Error('No response payload received from VM settings endpoint.');
      }

      const out = [result.result.stdout, result.result.stderr].filter(Boolean).join('\n').trim();
      if (result.result.return_code !== 0) {
        setError(`Command exited ${result.result.return_code}.`);
        if (out) setCmdOutput(out);
      } else {
        if (out) setCmdOutput(out);
        onDone('VM settings applied. Restart the VM for changes to take effect.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  }

  const current = parsed?.overview;
  const parsedDisks = parsed?.sections.filter((s) => s.type === 'virtual-disk') ?? [];
  const parsedNics = parsed?.sections.filter((s) => s.type === 'network-interface') ?? [];

  return (
    <form className="vm-configure" onSubmit={(e) => void submit(e)}>
      {error ? <p className="callout callout--error">{error}</p> : null}
      {cmdOutput ? (
        <pre className="vm-configure__output">{cmdOutput}</pre>
      ) : null}

      {/* Compute */}
      <div className="vm-configure__section">
        <h4 className="vm-configure__section-title">Compute</h4>
        <div className="vm-configure__row">
          <label className="field">
            <span>
              CPU cores
              {current?.['cpu'] ? (
                <span className="field__current"> · current: {current['cpu']}</span>
              ) : null}
            </span>
            <input
              type="number"
              min={1}
              max={256}
              placeholder="e.g. 2"
              value={form.cpu}
              onChange={(e) => setForm((f) => ({ ...f, cpu: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>
              Memory
              {current?.['memory'] ? (
                <span className="field__current"> · current: {current['memory']}</span>
              ) : null}
            </span>
            <input
              placeholder="e.g. 4G or 2048M"
              value={form.memory}
              onChange={(e) => setForm((f) => ({ ...f, memory: e.target.value }))}
            />
          </label>
        </div>
      </div>

      {/* Boot */}
      <div className="vm-configure__section">
        <h4 className="vm-configure__section-title">Boot</h4>
        <label className="field">
          <span>
            Loader
            {current?.['loader'] ? (
              <span className="field__current"> · current: {current['loader']}</span>
            ) : null}
          </span>
          <select
            value={form.loader}
            onChange={(e) => setForm((f) => ({ ...f, loader: e.target.value }))}
          >
            <option value="">— unchanged —</option>
            <option value="bhyveload">bhyveload (FreeBSD)</option>
            <option value="grub">GRUB</option>
            <option value="uefi">UEFI</option>
            <option value="uefi-csm">UEFI-CSM</option>
          </select>
        </label>
      </div>

      {/* Storage */}
      {disks.length > 0 ? (
        <div className="vm-configure__section">
          <h4 className="vm-configure__section-title">Storage</h4>
          {disks.map((disk, i) => (
            <div key={i} className="vm-configure__device-card">
              <div className="vm-configure__device-label">
                Disk {parsedDisks[i]?.fields['number'] ?? i}
                {parsedDisks[i]?.fields['emulation'] ? (
                  <span className="tag">{parsedDisks[i].fields['emulation']}</span>
                ) : null}
              </div>
              <div className="vm-configure__row">
                <label className="field">
                  <span>Emulation type</span>
                  <select
                    value={disk.type}
                    onChange={(e) => setDiskField(i, 'type', e.target.value)}
                  >
                    <option value="">— unchanged —</option>
                    <option value="ahci-hd">ahci-hd (SATA)</option>
                    <option value="ahci-cd">ahci-cd (CD-ROM)</option>
                    <option value="nvme">nvme</option>
                    <option value="virtio-blk">virtio-blk</option>
                  </select>
                </label>
                <label className="field">
                  <span>
                    Image path
                    {parsedDisks[i]?.fields['system-path'] ? (
                      <span className="field__current"> · {parsedDisks[i].fields['system-path']}</span>
                    ) : null}
                  </span>
                  <input
                    placeholder="/vm/name/disk0.img"
                    value={disk.path}
                    onChange={(e) => setDiskField(i, 'path', e.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Networking */}
      {nics.length > 0 ? (
        <div className="vm-configure__section">
          <h4 className="vm-configure__section-title">Networking</h4>
          {nics.map((nic, i) => (
            <div key={i} className="vm-configure__device-card">
              <div className="vm-configure__device-label">
                Interface {parsedNics[i]?.fields['number'] ?? i}
                {parsedNics[i]?.fields['emulation'] ? (
                  <span className="tag">{parsedNics[i].fields['emulation']}</span>
                ) : null}
              </div>
              <div className="vm-configure__row vm-configure__row--3">
                <label className="field">
                  <span>Driver</span>
                  <select
                    value={nic.type}
                    onChange={(e) => setNicField(i, 'type', e.target.value)}
                  >
                    <option value="">— unchanged —</option>
                    <option value="virtio-net">virtio-net</option>
                    <option value="e1000">e1000</option>
                    <option value="e1000e">e1000e</option>
                  </select>
                </label>
                <label className="field">
                  <span>
                    Virtual switch
                    {parsedNics[i]?.fields['virtual-switch'] ? (
                      <span className="field__current"> · {parsedNics[i].fields['virtual-switch']}</span>
                    ) : null}
                  </span>
                  <input
                    placeholder="public"
                    value={nic.switch}
                    onChange={(e) => setNicField(i, 'switch', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>
                    MAC address
                    {parsedNics[i]?.fields['fixed-mac-address'] ? (
                      <span className="field__current"> · {parsedNics[i].fields['fixed-mac-address']}</span>
                    ) : null}
                  </span>
                  <input
                    placeholder="auto or XX:XX:XX:XX:XX:XX"
                    value={nic.mac}
                    onChange={(e) => setNicField(i, 'mac', e.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Advanced */}
      <div className="vm-configure__section">
        <button
          className="vm-configure__toggle"
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? '▾' : '▸'} Advanced options
        </button>
        {showAdvanced ? (
          <label className="field" style={{ marginTop: 10 }}>
            <span>Raw key=value pairs, one per line</span>
            <textarea
              className="vm-action-form__textarea"
              placeholder={'disk0_size=50G\nnetwork0_type=e1000'}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="vm-configure__footer">
        <button className="button" disabled={busy} type="submit">
          {busy ? 'Applying…' : 'Apply settings'}
        </button>
        <span className="vm-configure__hint">Most changes take effect after the VM is restarted.</span>
      </div>
    </form>
  );
}

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  disconnect: () => void;
  sendCtrlAltDel: () => void;
  focus?: () => void;
  addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => void;
};

function VmConsolePanel({
  serverId,
  vmName,
  hasVnc,
}: {
  serverId: string;
  vmName: string;
  hasVnc: boolean;
}) {
  const [vncConnecting, setVncConnecting] = useState(false);
  const [vncConnected, setVncConnected] = useState(false);
  const [vncError, setVncError] = useState<string | null>(null);
  const vncTargetRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  function createTerm() {
    if (termRef.current || !termContainerRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Space Mono', 'Courier New', monospace",
      theme: {
        background: '#02060c',
        foreground: '#c9dde8',
        cursor: '#63e5a1',
        selectionBackground: 'rgba(99,229,161,0.25)',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termContainerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;
  }

  function disposeTerm() {
    termRef.current?.dispose();
    termRef.current = null;
    fitAddonRef.current = null;
  }


  function disconnectVnc() {
    const rfb = rfbRef.current;
    if (rfb) {
      rfb.disconnect();
      rfbRef.current = null;
    }
    setVncConnected(false);
    setVncConnecting(false);
  }

  function sendCtrlAltDelete() {
    const rfb = rfbRef.current;
    if (!rfb) {
      setVncError('No active VNC session. Connect first.');
      return;
    }

    try {
      rfb.sendCtrlAltDel();
      rfb.focus?.();
      setVncError(null);
    } catch (error) {
      setVncError(error instanceof Error ? error.message : 'Failed to send Ctrl+Alt+Del.');
    }
  }

  async function connectVnc() {
    if (!hasVnc || vncConnecting || vncConnected || rfbRef.current || !vncTargetRef.current) {
      return;
    }

    setVncError(null);
    setVncConnecting(true);

    try {
      const mod = await import('@novnc/novnc');
      const RFB = mod.default as unknown as {
        new (
          target: HTMLElement,
          url: string,
          options?: Record<string, unknown>,
        ): RfbInstance;
      };

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/api/servers/${encodeURIComponent(serverId)}/vms/${encodeURIComponent(vmName)}/vnc/ws`;

      const rfb = new RFB(vncTargetRef.current, url, {
        credentials: {},
      });

      rfb.scaleViewport = true;
      rfb.resizeSession = true;

      rfb.addEventListener('connect', () => {
        setVncConnecting(false);
        setVncConnected(true);
        setVncError(null);
      });

      rfb.addEventListener('disconnect', (event: Event) => {
        const custom = event as Event & { detail?: { clean?: boolean } };
        setVncConnecting(false);
        setVncConnected(false);
        if (custom.detail && custom.detail.clean === false) {
          setVncError('VNC session disconnected unexpectedly.');
        }
        rfbRef.current = null;
      });

      rfbRef.current = rfb;
      rfb.focus?.();
    } catch (error) {
      setVncConnecting(false);
      setVncConnected(false);
      setVncError(error instanceof Error ? error.message : 'Unable to launch VNC viewer.');
    }
  }

  function connect() {
    if (ws || connecting) return;
    setConnecting(true);
    createTerm();
    const term = termRef.current!;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/servers/${encodeURIComponent(serverId)}/vms/${encodeURIComponent(vmName)}/console/ws`;
    const sock = new WebSocket(url);
    sock.binaryType = 'arraybuffer';

    // Forward terminal keypresses to the server
    term.onData((data) => {
      if (sock.readyState === WebSocket.OPEN) sock.send(data);
    });

    sock.onopen = () => {
      setConnecting(false);
      setConnected(true);
    };
    sock.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
        return;
      }

      if (event.data instanceof Blob) {
        const bytes = new Uint8Array(await event.data.arrayBuffer());
        term.write(bytes);
        return;
      }

      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      try {
        const msg = JSON.parse(raw) as { type: string; message?: string };
        if (msg.type === 'connected') {
          term.writeln('\x1b[2;32m-- console session established --\x1b[0m');
          // Send a CR to trigger the terminal to display its current prompt
          sock.send('\r');
          return;
        }
        if (msg.type === 'error') {
          term.writeln(`\x1b[1;31mError: ${msg.message ?? 'unknown'}\x1b[0m`);
          return;
        }
      } catch {
        // Not a control envelope; pass through to terminal.
      }
      term.write(raw);
    };
    sock.onclose = (event) => {
      setConnecting(false);
      setConnected(false);
      const detail = event.reason
        ? `Connection closed (${event.code}): ${event.reason}`
        : `Connection closed (${event.code}).`;
      term.writeln(`\r\n\x1b[2;33m-- ${detail} --\x1b[0m`);
      setWs(null);
    };
    sock.onerror = () => {
      setConnecting(false);
      term.writeln('\r\n\x1b[1;31m-- WebSocket error --\x1b[0m');
    };
    setWs(sock);
  }

  function disconnect() {
    ws?.close();
    setWs(null);
    setConnecting(false);
    setConnected(false);
  }

  useEffect(() => {
    return () => {
      disconnectVnc();
      disposeTerm();
    };
  }, []);

  useEffect(() => {
    return () => {
      ws?.close();
    };
  }, [ws]);

  return (
    <div className="vm-console">
      {hasVnc ? (
        <div className="vm-vnc">
          <div className="vm-console__toolbar">
            {!vncConnected ? (
              <button className="button" disabled={vncConnecting} onClick={() => void connectVnc()} type="button">
                {vncConnecting ? 'Launching VNC…' : 'Launch VNC viewer'}
              </button>
            ) : (
              <>
                <button className="button button--ghost" onClick={sendCtrlAltDelete} type="button">
                  Send Ctrl+Alt+Del
                </button>
                <button className="button button--ghost" onClick={disconnectVnc} type="button">Disconnect VNC</button>
              </>
            )}
          </div>

          {vncError ? <p className="callout callout--error">{vncError}</p> : null}

          <div className="vm-vnc__viewport-wrap">
            <div className="vm-vnc__viewport" ref={vncTargetRef} />
            {!vncConnected && !vncConnecting ? (
              <span className="vm-console__placeholder">VNC viewer is ready. Click Launch VNC viewer.</span>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="vm-console__toolbar">
            {!connected ? (
              <button className="button" disabled={connecting} onClick={connect} type="button">
                {connecting ? 'Connecting…' : 'Connect to console'}
              </button>
            ) : (
              <button className="button button--ghost" onClick={disconnect} type="button">Disconnect</button>
            )}
            {termRef.current ? (
              <button
                className="button button--ghost"
                onClick={() => termRef.current?.clear()}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div
            className="vm-console__xterm"
            ref={termContainerRef}
          >
            {!termRef.current ? (
              <span className="vm-console__placeholder">No output yet. Connect to start a console session.</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function getVmMemory(item: VmListItem): string {
  return getField(item.fields, ['memory', 'mem', 'ram']);
}

function estimateRunningVmCount(vms: VmListItem[]): number {
  return vms.filter((vm) => /run|start|up|active/i.test(getVmState(vm))).length;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBytesValue(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'n/a';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatEpochSeconds(epoch: number): string {
  if (!Number.isFinite(epoch)) {
    return 'n/a';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epoch * 1000));
}

function getHostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '127.0.0.1';
  }
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function pickSummaryValue(details: Record<string, unknown>, keys: string[]): unknown {
  const entries = Object.entries(details);
  for (const key of keys) {
    const needle = key.toLowerCase();
    const exact = entries.find(([entryKey]) => entryKey.toLowerCase() === needle);
    if (exact) return parseJsonLike(exact[1]);
  }

  for (const key of keys) {
    const needle = key.toLowerCase();
    const partial = entries.find(([entryKey]) => entryKey.toLowerCase().includes(needle));
    if (partial) return parseJsonLike(partial[1]);
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  const parsed = parseJsonLike(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  const parsed = parseJsonLike(value);
  return Array.isArray(parsed) ? parsed : [];
}

function toAddressList(value: unknown): string[] {
  const entries = toArray(value)
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => {
      const family = toText(item['family']);
      const address = toText(item['address']);
      if (!address) return null;
      return family ? `${address} (${family})` : address;
    })
    .filter((item): item is string => Boolean(item));

  return entries;
}

function extractNicIpAddresses(fields: Record<string, string>): string[] {
  const isIpv4 = (value: string): boolean => {
    const m = value.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
    if (!m) return false;
    return value.split('.').every((part) => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  };

  const isMac = (value: string): boolean => {
    return /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value)
      || /^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/.test(value);
  };

  const isIpv6 = (value: string): boolean => {
    const normalized = value.includes('%') ? value.split('%')[0] : value;
    if (!normalized.includes(':')) return false;
    if (isMac(normalized)) return false;
    return /^[0-9a-fA-F:]+$/.test(normalized);
  };

  const extractIpTokens = (value: string): string[] => {
    const tokens = value
      .split(/[\s,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    return tokens
      .map((token) => token.replace(/^\[|\]$/g, ''))
      .map((token) => token.split('/')[0])
      .filter((token) => isIpv4(token) || isIpv6(token));
  };

  const candidates = Object.entries(fields)
    .filter(([key, value]) => {
      const k = key.toLowerCase();
      if (!value || value === '-') return false;
      if (k.includes('mac')) return false;
      return k.includes('ip') || k.includes('inet') || k.includes('addr');
    })
    .map(([, value]) => value.trim())
    .filter(Boolean);

  const ips = candidates.flatMap((value) => extractIpTokens(value));
  return Array.from(new Set(ips));
}

function parsePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace('%', '').trim();
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(payload?.detail ?? `${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('amphitrite-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [servers, setServers] = useState<EditableServerConfig[]>([]);
  const [settingsSummary, setSettingsSummary] = useState<SettingsSummary>({
    servers: [],
    defaultsHasApiKey: false,
    defaultsHasAdminToken: false,
    needsOnboarding: false,
  });
  const [overview, setOverview] = useState<ServerOverview[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<VmInfoResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<VmActionResponse | null>(null);
  const [settingsForm, setSettingsForm] = useState<ServerSettingsInput>(emptySettingsForm);
  const [defaultsForm, setDefaultsForm] = useState<DefaultCredentialsInput>(emptyDefaultsForm);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'hosts'>('general');
  const [activeInspectorTab, setActiveInspectorTab] = useState<'info' | 'operate' | 'set' | 'console'>('info');
  const [configureMessage, setConfigureMessage] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [isCreateVmOpen, setIsCreateVmOpen] = useState(false);
  const [isDeleteVmOpen, setIsDeleteVmOpen] = useState(false);
  const [isManageMediaOpen, setIsManageMediaOpen] = useState(false);
  const [manageMediaServerId, setManageMediaServerId] = useState('');
  const [createVmBusy, setCreateVmBusy] = useState(false);
  const [deleteVmBusy, setDeleteVmBusy] = useState(false);
  const [uploadBusyServerId, setUploadBusyServerId] = useState<string | null>(null);
  const [loadingBootMediaServerId, setLoadingBootMediaServerId] = useState<string | null>(null);
  const [deletingBootMediaKey, setDeletingBootMediaKey] = useState<string | null>(null);
  const [bootMediaByServerId, setBootMediaByServerId] = useState<Record<string, BootMediaItem[]>>({});
  const [fleetMessage, setFleetMessage] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [createVmForm, setCreateVmForm] = useState<{
    serverId: string;
    vmName: string;
    cpu: string;
    memory: string;
    diskSize: string;
    storageTarget: string;
    networkSwitch: string;
    interfaceType: string;
    bootloader: '' | 'bhyveload' | 'grub' | 'uefi' | 'uefi-csm';
    bootSourceType: 'template' | 'iso' | 'img';
    bootSource: string;
    startAfterCreate: boolean;
    validateOnly: boolean;
  }>({
    serverId: '',
    vmName: '',
    cpu: '2',
    memory: '2048',
    diskSize: '20480',
    storageTarget: 'default',
    networkSwitch: 'public',
    interfaceType: 'virtio-net',
    bootloader: '',
    bootSourceType: 'template',
    bootSource: 'default',
    startAfterCreate: true,
    validateOnly: false,
  });
  const [deleteVmForm, setDeleteVmForm] = useState<{
    serverId: string;
    vmName: string;
    confirmVmName: string;
    force: boolean;
    destroyDisks: boolean;
  }>({
    serverId: '',
    vmName: '',
    confirmVmName: '',
    force: false,
    destroyDisks: false,
  });
  const manageMediaInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshOverview() {
    setLoadingOverview(true);

    try {
      const [summaryPayload, overviewPayload] = await Promise.all([
        readJson<SettingsSummary>('/api/settings'),
        readJson<{ servers: ServerOverview[] }>('/api/overview'),
      ]);
      setSettingsSummary(summaryPayload);
      setServers(summaryPayload.servers);
      setOverview(overviewPayload.servers);
    } finally {
      setLoadingOverview(false);
    }
  }

  function resetSettingsForm() {
    setEditingServerId(null);
    setSettingsForm(emptySettingsForm);
    setSettingsError(null);
    setSettingsMessage(null);
  }

  function startEditing(server: EditableServerConfig) {
    setIsSettingsOpen(true);
    setActiveSettingsTab('general');
    setEditingServerId(server.id);
    setSettingsError(null);
    setSettingsMessage(null);
    setSettingsForm({
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      xApiKey: '',
      xAdminToken: '',
      clearApiKey: false,
      clearAdminToken: false,
    });
  }

  async function saveDefaultCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const payload = await readJson<SettingsSummary>('/api/settings/defaults', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(defaultsForm),
      });

      setSettingsSummary(payload);
      setServers(payload.servers);
      setDefaultsForm(emptyDefaultsForm);
      setSettingsMessage('Default credentials updated.');
      await refreshOverview();
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const endpoint = editingServerId
        ? `/api/settings/servers/${encodeURIComponent(editingServerId)}`
        : '/api/settings/servers';
      const method = editingServerId ? 'PUT' : 'POST';
      const payload = await readJson<{ servers: EditableServerConfig[] }>(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settingsForm),
      });

      setServers(payload.servers);
      setSettingsMessage(editingServerId ? 'Server settings updated.' : 'Server added.');
      resetSettingsForm();
      await refreshOverview();
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setSavingSettings(false);
    }
  }

  async function removeServer(serverId: string) {
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const payload = await readJson<{ servers: EditableServerConfig[] }>(
        `/api/settings/servers/${encodeURIComponent(serverId)}`,
        { method: 'DELETE' },
      );

      if (selected?.serverId === serverId) {
        setSelected(null);
        setDetail(null);
        setDetailError(null);
      }

      setServers(payload.servers);
      setSettingsMessage('Server removed.');
      if (editingServerId === serverId) {
        resetSettingsForm();
      }
      await refreshOverview();
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setSavingSettings(false);
    }
  }

  async function exportConfig() {
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const payload = await readJson<ExportedSettings>('/api/settings/export');
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `amphitrite-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSettingsMessage('Host config exported.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unexpected error');
    }
  }

  async function importConfig(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ExportedSettings;
      const payload = await readJson<SettingsSummary>('/api/settings/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsed),
      });
      setSettingsSummary(payload);
      setServers(payload.servers);
      setSettingsMessage('Host config imported.');
      await refreshOverview();
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      event.target.value = '';
      setSavingSettings(false);
    }
  }

  async function loadVmDetail(selection: Selection) {
    if (!selection.vmName) {
      setDetail(null);
      setDetailError(null);
      setLoadingDetail(false);
      return;
    }

    setLoadingDetail(true);
    setDetailError(null);
    setActionResult(null);

    try {
      const payload = await readJson<VmInfoResponse>(
        `/api/servers/${encodeURIComponent(selection.serverId)}/vms/${encodeURIComponent(selection.vmName)}`,
      );
      setDetail(payload);
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function runVmAction(action: 'start' | 'stop' | 'restart') {
    if (!selected?.vmName) {
      return;
    }

    setBusyAction(action);
    setActionResult(null);

    try {
      const payload = await readJson<VmActionResponse>(
        `/api/servers/${encodeURIComponent(selected.serverId)}/vms/${encodeURIComponent(selected.vmName)}/actions/${action}`,
        { method: 'POST' },
      );
      setActionResult(payload);
      await Promise.all([refreshOverview(), loadVmDetail(selected)]);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setBusyAction(null);
    }
  }

  function openCreateVmModal() {
    setFleetError(null);
    setFleetMessage(null);
    setCreateVmForm((current) => ({
      ...current,
      serverId: selected?.serverId ?? current.serverId ?? servers[0]?.id ?? '',
    }));
    setIsCreateVmOpen(true);
  }

  function openDeleteVmModal() {
    setFleetError(null);
    setFleetMessage(null);
    setDeleteVmForm((current) => ({
      ...current,
      serverId: selected?.serverId ?? current.serverId ?? servers[0]?.id ?? '',
      vmName: selected?.vmName ?? current.vmName,
      confirmVmName: '',
    }));
    setIsDeleteVmOpen(true);
  }

  async function submitCreateVm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateVmBusy(true);
    setFleetError(null);
    setFleetMessage(null);

    try {
      const cpu = Number(createVmForm.cpu);
      if (!Number.isFinite(cpu) || cpu <= 0) {
        throw new Error('CPU must be a positive integer.');
      }

      const memoryMb = Number(createVmForm.memory);
      if (!Number.isFinite(memoryMb) || memoryMb <= 0) {
        throw new Error('Memory must be a positive integer in MB.');
      }

      const diskMb = Number(createVmForm.diskSize);
      if (!Number.isFinite(diskMb) || diskMb <= 0) {
        throw new Error('Disk size must be a positive integer in MB.');
      }

      const normalizedCpu = Math.trunc(cpu);
      const normalizedMemory = `${Math.trunc(memoryMb)}M`;

      const payload: VmCreateRequest = {
        vm_name: createVmForm.vmName.trim(),
        resources: {
          cpu: normalizedCpu,
          memory: normalizedMemory,
        },
        disk: {
          size: `${Math.trunc(diskMb)}M`,
          storage_target: createVmForm.storageTarget.trim(),
        },
        network: {
          switch: createVmForm.networkSwitch.trim(),
          interface_type: createVmForm.interfaceType.trim() || undefined,
        },
        boot: {
          source_type: createVmForm.bootSourceType,
          source: createVmForm.bootSource.trim(),
        },
        options: {
          start_after_create: createVmForm.startAfterCreate,
          validate_only: createVmForm.validateOnly,
        },
      };

      const result = await readJson<VmCreateResponse>(
        `/api/servers/${encodeURIComponent(createVmForm.serverId)}/vms/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      let bootloaderWarning: string | null = null;
      if (!createVmForm.validateOnly && createVmForm.bootloader) {
        try {
          await readJson<VmActionResponse>(
            `/api/servers/${encodeURIComponent(createVmForm.serverId)}/vms/${encodeURIComponent(createVmForm.vmName.trim())}/configure`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                options: [`loader=${createVmForm.bootloader}`],
              }),
            },
          );
        } catch (error) {
          bootloaderWarning = error instanceof Error ? error.message : 'Unexpected bootloader configure error';
        }
      }

      if (!createVmForm.validateOnly) {
        try {
          const vmName = createVmForm.vmName.trim();
          const vmConfig = await readJson<VmConfigResponse>(
            `/api/servers/${encodeURIComponent(createVmForm.serverId)}/vms/${encodeURIComponent(vmName)}/config`,
          );

          const rootDiskName = vmConfig.config['disk0_name']?.trim() ?? '';
          const rootDiskPath = vmConfig.config['disk0_path']?.trim() ?? '';
          if (!rootDiskName && !rootDiskPath) {
            setFleetError(
              `VM ${result.vm_name} created (${result.status}), but root disk verification failed: disk0 is missing in VM config.`,
            );
          } else {
            setFleetMessage(
              bootloaderWarning
                ? `VM ${result.vm_name} created (${result.status}), but bootloader apply failed: ${bootloaderWarning}`
                : `VM ${result.vm_name} create request succeeded (${result.status}).`,
            );
          }
        } catch (error) {
          setFleetError(
            `VM ${result.vm_name} created (${result.status}), but root disk verification failed: ${error instanceof Error ? error.message : 'Unexpected verification error'}`,
          );
        }
      } else {
        setFleetMessage(
          bootloaderWarning
            ? `VM ${result.vm_name} created (${result.status}), but bootloader apply failed: ${bootloaderWarning}`
            : `VM ${result.vm_name} create request succeeded (${result.status}).`,
        );
      }
      setIsCreateVmOpen(false);
      setSelected({ serverId: createVmForm.serverId, vmName: createVmForm.vmName.trim() });
      await refreshOverview();
      await loadVmDetail({ serverId: createVmForm.serverId, vmName: createVmForm.vmName.trim() });
    } catch (error) {
      setFleetError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setCreateVmBusy(false);
    }
  }

  async function submitDeleteVm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vmName = deleteVmForm.vmName.trim();
    const confirmVmName = deleteVmForm.confirmVmName.trim();

    if (!vmName) {
      setFleetError('Enter a VM name to delete.');
      return;
    }

    if (confirmVmName !== vmName) {
      setFleetError('Confirmation name does not match VM name.');
      return;
    }

    setDeleteVmBusy(true);
    setFleetError(null);
    setFleetMessage(null);

    try {
      const params = new URLSearchParams();
      if (deleteVmForm.force) params.set('force', 'true');
      if (deleteVmForm.destroyDisks) params.set('destroy_disks', 'true');
      const suffix = params.toString() ? `?${params.toString()}` : '';

      const result = await readJson<VmDeleteResponse>(
        `/api/servers/${encodeURIComponent(deleteVmForm.serverId)}/vms/${encodeURIComponent(vmName)}${suffix}`,
        { method: 'DELETE' },
      );

      setFleetMessage(`VM ${result.vm_name} deleted (${result.status}).`);
      setIsDeleteVmOpen(false);

      if (selected?.serverId === deleteVmForm.serverId && selected?.vmName === vmName) {
        setSelected({ serverId: deleteVmForm.serverId });
        setDetail(null);
      }

      await refreshOverview();
    } catch (error) {
      setFleetError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setDeleteVmBusy(false);
    }
  }

  function openManageMediaModal(serverId?: string) {
    setFleetError(null);
    setFleetMessage(null);
    const nextServerId = serverId ?? selected?.serverId ?? servers[0]?.id ?? '';
    setManageMediaServerId(nextServerId);
    setIsManageMediaOpen(true);
    if (nextServerId) {
      void loadBootMedia(nextServerId);
    }
  }

  async function loadBootMedia(serverId: string) {
    setLoadingBootMediaServerId(serverId);

    try {
      const payload = await readJson<BootMediaListResponse>(
        `/api/servers/${encodeURIComponent(serverId)}/boot-media`,
      );
      setBootMediaByServerId((current) => ({
        ...current,
        [serverId]: payload.items,
      }));
    } catch (error) {
      setFleetError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setLoadingBootMediaServerId((current) => (current === serverId ? null : current));
    }
  }

  async function removeBootMedia(serverId: string, fileName: string) {
    const key = `${serverId}:${fileName}`;
    setDeletingBootMediaKey(key);
    setFleetError(null);
    setFleetMessage(null);

    try {
      const payload = await readJson<BootMediaDeleteResponse>(
        `/api/servers/${encodeURIComponent(serverId)}/boot-media/${encodeURIComponent(fileName)}`,
        { method: 'DELETE' },
      );

      setFleetMessage(payload.deleted
        ? `Deleted ${payload.file_name} from ${serverId}.`
        : `Delete call returned without deletion for ${payload.file_name}.`);
      await loadBootMedia(serverId);
    } catch (error) {
      setFleetError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setDeletingBootMediaKey((current) => (current === key ? null : current));
    }
  }

  async function uploadMediaToServer(serverId: string, file: File) {
    setUploadBusyServerId(serverId);
    setFleetError(null);
    setFleetMessage(null);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch(
        `/api/servers/${encodeURIComponent(serverId)}/boot-media/upload`,
        {
          method: 'POST',
          body,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? `${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as BootMediaUploadResponse;
      setFleetMessage(`Uploaded ${payload.item.file_name} to ${serverId}.`);
      await loadBootMedia(serverId);
    } catch (error) {
      setFleetError(error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setUploadBusyServerId(null);
    }
  }

  async function submitManageMediaUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = manageMediaInputRef.current?.files?.[0] ?? null;

    if (!manageMediaServerId) {
      setFleetError('Select a host before uploading media.');
      return;
    }

    if (!file) {
      setFleetError('Choose an ISO or IMG file to upload.');
      return;
    }

    await uploadMediaToServer(manageMediaServerId, file);
    if (manageMediaInputRef.current) {
      manageMediaInputRef.current.value = '';
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('amphitrite-theme', theme);
  }, [theme]);

  useEffect(() => {
    void refreshOverview();
    const interval = window.setInterval(() => {
      void refreshOverview();
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selected) {
      setActiveInspectorTab('info');
      setConfigureMessage(null);
      if (!selected.vmName) {
        setDetail(null);
        setDetailError(null);
        setActionResult(null);
      }
    }
  }, [selected?.serverId, selected?.vmName]);

  useEffect(() => {
    if (!selected) return;
    if (!selected.vmName) return;
    void loadVmDetail(selected);
  }, [selected]);

  useEffect(() => {
    if (!selected?.serverId || selected.vmName) return;
    void loadBootMedia(selected.serverId);
  }, [selected?.serverId, selected?.vmName]);

  const totalVmCount = useMemo(
    () => overview.reduce((total, server) => total + server.vms.length, 0),
    [overview],
  );

  const runningVmCount = useMemo(
    () => overview.reduce((total, server) => total + estimateRunningVmCount(server.vms), 0),
    [overview],
  );

  const failingHosts = useMemo(
    () => overview.filter((server) => server.health === 'error').length,
    [overview],
  );

  const selectedServerName = selected
    ? servers.find((server) => server.id === selected.serverId)?.name ?? selected.serverId
    : null;

  const selectedServerOverview = useMemo(
    () => (selected ? overview.find((server) => server.serverId === selected.serverId) ?? null : null),
    [overview, selected],
  );

  const selectedVmName = selected?.vmName ?? null;
  const selectedHostSummary = selectedServerOverview?.hostSummary ?? null;

  const conciseHostOverview = useMemo(() => {
    if (!selectedHostSummary) return null;

    const host = selectedHostSummary.host.details;
    const memory = selectedHostSummary.memory.details;
    const disk = selectedHostSummary.disk.details;
    const network = selectedHostSummary.network.details;

    const memoryTotal =
      toNumber(pickSummaryValue(memory, ['hw.realmem']))
      ?? toNumber(pickSummaryValue(memory, ['hw.physmem']));
    const memoryFree = toNumber(pickSummaryValue(memory, ['computed.free_bytes']));

    const totals = toObject(pickSummaryValue(disk, ['totals']));
    const zpoolSummary = toObject(pickSummaryValue(disk, ['zpool_summary']));
    const ifaceSummary = toObject(pickSummaryValue(network, ['interface_summary']));
    const routeSummary = toObject(pickSummaryValue(network, ['route_summary']));
    const defaultRoutes = parseJsonLike(pickSummaryValue(network, ['default_routes']));
    const interfaces = toArray(pickSummaryValue(network, ['interfaces']));

    const interfaceCards = interfaces
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => {
        const addresses = toAddressList(entry['addresses']);

        return {
          name: toText(entry['name']) ?? 'unknown',
          status: toText(entry['status']) ?? 'unknown',
          mtu: toNumber(entry['mtu']),
          mac: toText(entry['mac']),
          media: toText(entry['media']),
          description: toText(entry['description']),
          addresses,
        };
      });

    const defaultRouteCount = Array.isArray(defaultRoutes)
      ? defaultRoutes.length
      : defaultRoutes && typeof defaultRoutes === 'object'
        ? 1
        : 0;

    return {
      hostname: toText(pickSummaryValue(host, ['kern.hostname', 'hostname'])) ?? 'Unknown',
      osRelease: toText(pickSummaryValue(host, ['kern.osrelease', 'osrelease'])) ?? 'Unknown',
      cpuCount: toNumber(pickSummaryValue(host, ['hw.ncpu', 'ncpu'])),
      model: toText(pickSummaryValue(host, ['hw.model', 'model'])) ?? 'Unknown',
      machine: toText(pickSummaryValue(host, ['hw.machine', 'machine'])) ?? 'Unknown',
      memoryTotal,
      memoryFree,
      filesystemCount: toNumber(totals?.['filesystem_count'] ?? null),
      diskSizeBytes: toNumber(totals?.['size_bytes'] ?? null),
      diskUsedBytes: toNumber(totals?.['used_bytes'] ?? null),
      diskAvailBytes: toNumber(totals?.['avail_bytes'] ?? null),
      diskCapacityText: toText(totals?.['capacity'] ?? null),
      diskCapacityPct: parsePercent(totals?.['capacity'] ?? null),
      zpoolCount: toNumber(zpoolSummary?.['pool_count'] ?? null),
      interfaceCount: toNumber(ifaceSummary?.['interface_count'] ?? null),
      upInterfaceCount: toNumber(ifaceSummary?.['up_interface_count'] ?? null),
      routeCount: toNumber(routeSummary?.['route_count'] ?? null),
      defaultRouteCount,
      interfaces: interfaceCards,
    };
  }, [selectedHostSummary]);

  const configByServerId = useMemo(
    () => new Map(servers.map((server) => [server.id, server])),
    [servers],
  );

  const selectedVncEndpoint = useMemo(() => {
    if (!selected || !selected.vmName || !detail) {
      return null;
    }

    const serverConfig = configByServerId.get(selected.serverId);
    if (!serverConfig) {
      return null;
    }

    return extractVmVncEndpoint(
      detail.result.stdout,
      getHostFromBaseUrl(serverConfig.baseUrl),
    );
  }, [configByServerId, detail, selected]);

  const createVmMediaOptions = useMemo(() => {
    const serverId = createVmForm.serverId;
    if (!serverId) {
      return [] as BootMediaItem[];
    }

    const items = bootMediaByServerId[serverId] ?? [];
    if (createVmForm.bootSourceType === 'template') {
      return items;
    }

    return items.filter((item) => {
      const name = item.file_name.toLowerCase();
      if (createVmForm.bootSourceType === 'iso') return name.endsWith('.iso');
      if (createVmForm.bootSourceType === 'img') return name.endsWith('.img');
      return true;
    });
  }, [bootMediaByServerId, createVmForm.bootSourceType, createVmForm.serverId]);

  function openSettingsModal() {
    setActiveSettingsTab('general');
    setIsSettingsOpen(true);
  }

  function toggleServerExpanded(serverId: string) {
    setExpandedServers((current) => ({
      ...current,
      [serverId]: current[serverId] === false,
    }));
  }

  function closeSettingsModal() {
    setIsSettingsOpen(false);
    setSettingsError(null);
    setSettingsMessage(null);
    resetSettingsForm();
    setDefaultsForm(emptyDefaultsForm);
  }

  function closeManageMediaModal() {
    setIsManageMediaOpen(false);
    setManageMediaServerId('');
    if (manageMediaInputRef.current) {
      manageMediaInputRef.current.value = '';
    }
  }

  return (
    <div className="shell">
      <div className="shell__glow shell__glow--one" />
      <div className="shell__glow shell__glow--two" />

      <header className="hero">
        <div>
          <p className="eyebrow">Poseidon control surface</p>
          <h1>Amphitrite</h1>
          <p className="hero__copy">Monitor your bhyve estate</p>
        </div>

        <div className="hero__actions">
          <button className="button button--ghost" onClick={() => openManageMediaModal()} type="button">
            <Upload size={16} /> Media
          </button>
          <button className="button button--ghost" onClick={openCreateVmModal} type="button">
            <Plus size={16} /> Add VM
          </button>
          <button className="button button--ghost" onClick={openDeleteVmModal} type="button">
            <Trash2 size={16} /> Delete VM
          </button>
          <button className="button button--ghost button--icon" onClick={openSettingsModal} type="button">
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <button className="button button--ghost" onClick={() => void refreshOverview()}>
            <RefreshCw className={loadingOverview ? 'spin' : ''} size={16} />
            {loadingOverview ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {fleetError ? <p className="callout callout--error">{fleetError}</p> : null}
      {fleetMessage ? <p className="callout callout--success">{fleetMessage}</p> : null}

      {settingsSummary.needsOnboarding ? (
        <section className="onboarding panel">
          <div className="panel__heading">
            <div>
              <h2>Credential setup</h2>
              <p>
                Default admin credentials are not configured yet. Add them once and new
                Poseidon hosts can reuse them automatically.
              </p>
            </div>
          </div>

          <div className="button-row button-row--tight">
            <button className="button" onClick={openSettingsModal} type="button">
              Configure credentials
            </button>
          </div>
        </section>
      ) : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>Configured hosts</span>
          <strong>{servers.length}</strong>
        </article>
        <article className="stat-card">
          <span>Total VMs</span>
          <strong>{totalVmCount}</strong>
        </article>
        <article className="stat-card">
          <span>Estimated running</span>
          <strong>{runningVmCount}</strong>
        </article>
        <article className="stat-card">
          <span>Hosts with errors</span>
          <strong>{failingHosts}</strong>
        </article>
      </section>

      <main className="layout">
        <section className="panel panel--servers">
          <div className="panel__heading">
            <div>
              <h2>Fleet Overview</h2>
              <p>Host health, VM inventory, and status rollups.</p>
            </div>
          </div>

          <div className="server-list">
            {overview.map((server) => (
              <article className="server-card" key={server.serverId}>
                <div className="server-tree">
                  <div className="server-tree__root">
                    <div>
                      <p className="server-tree__label">Host</p>
                      <div className="server-tree__host-title">
                        <button
                          aria-expanded={expandedServers[server.serverId] !== false}
                          aria-label={getToggleLabel(expandedServers[server.serverId] !== false)}
                          className="server-tree__toggle"
                          onClick={() => toggleServerExpanded(server.serverId)}
                          type="button"
                        >
                          <span aria-hidden="true">
                            {expandedServers[server.serverId] !== false ? '▾' : '▸'}
                          </span>
                        </button>
                        <button
                          className={
                            selected?.serverId === server.serverId && !selected?.vmName
                              ? 'server-tree__host-select server-tree__host-select--selected'
                              : 'server-tree__host-select'
                          }
                          onClick={() => setSelected({ serverId: server.serverId })}
                          type="button"
                        >
                          {server.serverName}
                        </button>
                        <span
                          className={`health-pill ${
                            server.health === 'ok' ? 'health-pill--ok' : 'health-pill--error'
                          }`}
                        >
                          {server.health === 'ok' ? 'Healthy' : 'Attention needed'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {server.error ? <p className="callout callout--error">{server.error}</p> : null}

                  {expandedServers[server.serverId] !== false && server.vms.length > 0 ? (
                    <ul className="server-tree__children" aria-label={`${server.serverName} virtual machines`}>
                      {server.vms.map((vm) => {
                        const vmName = getVmName(vm);
                        const isSelected =
                          selected?.serverId === server.serverId && selected.vmName === vmName;
                        const displayName = formatFleetVmName(vmName);

                        return (
                          <li className="server-tree__item" key={`${server.serverId}-${vmName}`}>
                            <button
                              className={
                                isSelected
                                  ? 'server-tree__button server-tree__button--selected'
                                  : 'server-tree__button'
                              }
                              onClick={() => setSelected({ serverId: server.serverId, vmName })}
                              title={vmName}
                              type="button"
                            >
                              <span className="server-tree__node">
                                <span className="server-tree__node-name">{displayName}</span>
                                <span className="server-tree__node-path">{vmName}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : expandedServers[server.serverId] === false ? (
                    <p className="server-tree__collapsed">VMs hidden. Expand this host to view its tree.</p>
                  ) : (
                    <p className="server-tree__empty">No VM inventory returned for this host.</p>
                  )}
                </div>
              </article>
            ))}

            {!loadingOverview && overview.length === 0 ? (
              <article className="empty-state">
                <h3>No hosts configured</h3>
                <p>
                  Add hosts from the settings panel to start monitoring Poseidon nodes.
                </p>
              </article>
            ) : null}
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel panel--detail">
            <div className="panel__heading">
              <div>
                <h2>Host and VM Overview</h2>
                <p>
                  {selectedServerName && selectedVmName
                    ? `${selectedVmName} on ${selectedServerName}`
                    : selectedServerName
                      ? `${selectedServerName} resource summary`
                      : 'Select a host or VM to inspect resources and operations.'}
                </p>
              </div>
            </div>

            {selected && selectedVmName ? (
              <>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={busyAction !== null}
                    onClick={() => void runVmAction('start')}
                  >
                    {busyAction === 'start' ? 'Starting…' : 'Start'}
                  </button>
                  <button
                    className="button button--ghost"
                    disabled={busyAction !== null}
                    onClick={() => void runVmAction('restart')}
                  >
                    {busyAction === 'restart' ? 'Restarting…' : 'Restart'}
                  </button>
                  <button
                    className="button button--ghost button--danger"
                    disabled={busyAction !== null}
                    onClick={() => void runVmAction('stop')}
                  >
                    {busyAction === 'stop' ? 'Stopping…' : 'Stop'}
                  </button>
                </div>

                {detailError ? <p className="callout callout--error">{detailError}</p> : null}

                {actionResult ? (
                  <p className="callout callout--success">
                    {actionResult.action} completed successfully.
                  </p>
                ) : null}

                {configureMessage ? (
                  <p className="callout callout--success">{configureMessage}</p>
                ) : null}

                <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
                  <button
                    aria-selected={activeInspectorTab === 'info'}
                    className={activeInspectorTab === 'info' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                    onClick={() => setActiveInspectorTab('info')}
                    role="tab"
                    type="button"
                  >
                    Info
                  </button>
                  <button
                    aria-selected={activeInspectorTab === 'set'}
                    className={activeInspectorTab === 'set' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                    onClick={() => setActiveInspectorTab('set')}
                    role="tab"
                    type="button"
                  >
                    Configure
                  </button>
                  <button
                    aria-selected={activeInspectorTab === 'operate'}
                    className={activeInspectorTab === 'operate' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                    onClick={() => setActiveInspectorTab('operate')}
                    role="tab"
                    type="button"
                  >
                    Operate
                  </button>
                  <button
                    aria-selected={activeInspectorTab === 'console'}
                    className={activeInspectorTab === 'console' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                    onClick={() => setActiveInspectorTab('console')}
                    role="tab"
                    type="button"
                  >
                    Console
                  </button>
                </div>

                {activeInspectorTab === 'info' ? (
                  <>
                    <VmMetricsPanel serverId={selected.serverId} vmName={selectedVmName} />
                    {loadingDetail ? <p className="detail-placeholder">Loading VM detail…</p> : null}
                    {detail ? <VmDetailPanel detail={detail} /> : null}
                  </>
                ) : null}

                {activeInspectorTab === 'set' && selected ? (
                  <VmConfigurePanel
                    key={`${selected.serverId}/${selected.vmName}`}
                    serverId={selected.serverId}
                    vmName={selectedVmName}
                    currentInfo={detail}
                    onDone={(msg) => {
                      setConfigureMessage(msg);
                      setActiveInspectorTab('info');
                      void loadVmDetail(selected);
                    }}
                  />
                ) : null}

                {activeInspectorTab === 'operate' && selected ? (
                  <VmOperationsPanel
                    key={`${selected.serverId}/${selected.vmName}/operations`}
                    serverId={selected.serverId}
                    vmName={selectedVmName}
                    onChanged={(message) => {
                      setFleetMessage(message);
                      void refreshOverview();
                    }}
                  />
                ) : null}

                {activeInspectorTab === 'console' && selected ? (
                  <VmConsolePanel
                    key={`${selected.serverId}/${selected.vmName}`}
                    hasVnc={Boolean(selectedVncEndpoint)}
                    serverId={selected.serverId}
                    vmName={selectedVmName}
                  />
                ) : null}
              </>
            ) : selected ? (
              <>
                <HostOperationsPanel key={`${selected.serverId}/operations`} serverId={selected.serverId} />

                {!selectedServerOverview ? (
                  <p className="detail-placeholder">Loading host summary…</p>
                ) : null}

                {!selectedHostSummary && selectedServerOverview ? (
                  <p className="callout callout--error">
                    Host summary is not available for this server yet.
                  </p>
                ) : null}

                {conciseHostOverview ? (
                  <div className="vm-detail">
                    <section className="vm-detail__section">
                      <h3 className="vm-detail__section-title">Overview</h3>
                      <div className="vm-detail__overview-grid host-overview-grid">
                        <div className="vm-detail__stat host-overview__hostname">
                          <span className="vm-detail__label">Hostname</span>
                          <strong>{conciseHostOverview.hostname}</strong>
                        </div>
                        <div className="vm-detail__stat">
                          <span className="vm-detail__label">CPU Cores</span>
                          <strong>{conciseHostOverview.cpuCount ?? 'Unknown'}</strong>
                        </div>
                        <div className="vm-detail__stat">
                          <span className="vm-detail__label">Total Memory</span>
                          <strong>
                            {conciseHostOverview.memoryTotal !== null
                              ? formatBytesValue(conciseHostOverview.memoryTotal)
                              : 'Unknown'}
                          </strong>
                        </div>
                        <div className="vm-detail__stat">
                          <span className="vm-detail__label">Free Memory</span>
                          <strong>
                            {conciseHostOverview.memoryFree !== null
                              ? formatBytesValue(conciseHostOverview.memoryFree)
                              : 'Unknown'}
                          </strong>
                        </div>
                        <div className="vm-detail__stat">
                          <span className="vm-detail__label">Filesystems</span>
                          <strong>{conciseHostOverview.filesystemCount ?? 'Unknown'}</strong>
                        </div>
                        <div className="vm-detail__stat">
                          <span className="vm-detail__label">Interfaces Up</span>
                          <strong>
                            {conciseHostOverview.upInterfaceCount !== null
                              ? `${conciseHostOverview.upInterfaceCount}${conciseHostOverview.interfaceCount !== null ? ` / ${conciseHostOverview.interfaceCount}` : ''}`
                              : conciseHostOverview.interfaceCount ?? 'Unknown'}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className="vm-detail__section">
                      <h3 className="vm-detail__section-title">Host</h3>
                      <div className="vm-detail__cards">
                        <article className="vm-detail__card">
                          <div className="vm-detail__fields">
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Operating System</span>
                              <strong>{conciseHostOverview.osRelease}</strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Architecture</span>
                              <strong>{conciseHostOverview.machine}</strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">CPU Model</span>
                              <strong>{conciseHostOverview.model}</strong>
                            </div>
                          </div>
                        </article>
                      </div>
                    </section>

                    <section className="vm-detail__section">
                      <h3 className="vm-detail__section-title">Storage</h3>
                      <div className="vm-detail__cards">
                        <article className="vm-detail__card">
                          <div className="vm-detail__card-title">
                            Disk 0
                            {conciseHostOverview.diskCapacityText ? (
                              <span className="tag">host-summary</span>
                            ) : null}
                          </div>
                          <div className="vm-detail__fields">
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Total</span>
                              <strong>
                                {conciseHostOverview.diskSizeBytes !== null
                                  ? formatBytesValue(conciseHostOverview.diskSizeBytes)
                                  : 'Unknown'}
                              </strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Used</span>
                              <strong>
                                {conciseHostOverview.diskUsedBytes !== null
                                  ? formatBytesValue(conciseHostOverview.diskUsedBytes)
                                  : 'Unknown'}
                              </strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Available</span>
                              <strong>
                                {conciseHostOverview.diskAvailBytes !== null
                                  ? formatBytesValue(conciseHostOverview.diskAvailBytes)
                                  : 'Unknown'}
                              </strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">ZFS Pools</span>
                              <strong>{conciseHostOverview.zpoolCount ?? 'Unknown'}</strong>
                            </div>
                          </div>
                          {conciseHostOverview.diskCapacityPct !== null ? (
                            <div className="vm-detail__usage">
                              <div className="vm-detail__usage-bar">
                                <div
                                  className={`vm-detail__usage-fill${conciseHostOverview.diskCapacityPct >= 90 ? ' vm-detail__usage-fill--critical' : conciseHostOverview.diskCapacityPct >= 70 ? ' vm-detail__usage-fill--warning' : ''}`}
                                  style={{ width: `${Math.max(0, Math.min(100, conciseHostOverview.diskCapacityPct))}%` }}
                                />
                              </div>
                              <span className="vm-detail__usage-pct">{Math.round(conciseHostOverview.diskCapacityPct)}%</span>
                            </div>
                          ) : null}
                        </article>
                      </div>
                    </section>

                    <section className="vm-detail__section">
                      <h3 className="vm-detail__section-title">Network Interfaces</h3>
                      <div className="vm-detail__cards">
                        {conciseHostOverview.interfaces.length > 0 ? conciseHostOverview.interfaces.map((iface, idx) => (
                          <article className="vm-detail__card" key={`${iface.name}-${iface.mac ?? idx}`}>
                            <div className="vm-detail__card-title">
                              {iface.name}
                              <span className="tag">{iface.status}</span>
                            </div>
                            <div className="vm-detail__fields">
                              {iface.addresses.length > 0 ? (
                                <div className="vm-detail__field">
                                  <span className="vm-detail__label">IP Addresses</span>
                                  <code>{iface.addresses.join(', ')}</code>
                                </div>
                              ) : null}
                              {iface.mac ? (
                                <div className="vm-detail__field">
                                  <span className="vm-detail__label">MAC</span>
                                  <code>{iface.mac}</code>
                                </div>
                              ) : null}
                              {iface.mtu !== null ? (
                                <div className="vm-detail__field">
                                  <span className="vm-detail__label">MTU</span>
                                  <strong>{iface.mtu}</strong>
                                </div>
                              ) : null}
                              {iface.media ? (
                                <div className="vm-detail__field">
                                  <span className="vm-detail__label">Media</span>
                                  <strong>{iface.media}</strong>
                                </div>
                              ) : null}
                              {iface.description ? (
                                <div className="vm-detail__field">
                                  <span className="vm-detail__label">Description</span>
                                  <strong>{iface.description}</strong>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        )) : (
                          <article className="vm-detail__card">
                            <p className="detail-placeholder">No interface details reported.</p>
                          </article>
                        )}
                        <article className="vm-detail__card">
                          <div className="vm-detail__fields">
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Routes</span>
                              <strong>{conciseHostOverview.routeCount ?? 'Unknown'}</strong>
                            </div>
                            <div className="vm-detail__field">
                              <span className="vm-detail__label">Default Routes</span>
                              <strong>{conciseHostOverview.defaultRouteCount}</strong>
                            </div>
                          </div>
                        </article>
                      </div>
                    </section>
                  </div>
                ) : null}

                <article className="detail-card">
                  <h3>Boot Media</h3>
                  {loadingBootMediaServerId === selected.serverId ? (
                    <p className="detail-placeholder">Loading uploaded ISO/IMG files…</p>
                  ) : null}

                  {(bootMediaByServerId[selected.serverId] ?? []).length === 0
                    && loadingBootMediaServerId !== selected.serverId ? (
                      <p className="detail-placeholder">No uploaded media found on this host.</p>
                    ) : null}

                  {(bootMediaByServerId[selected.serverId] ?? []).length > 0 ? (
                    <div className="boot-media-list">
                      {(bootMediaByServerId[selected.serverId] ?? []).map((item) => {
                        return (
                          <div className="boot-media-item" key={item.file_name}>
                            <div className="boot-media-item__meta">
                              <strong>{item.file_name}</strong>
                              <span>{formatBytesValue(item.size_bytes)} · {formatEpochSeconds(item.modified_epoch)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </article>
              </>
            ) : (
              <div className="empty-state empty-state--detail">
                <h3>Nothing selected</h3>
                <p>Choose a host or VM from the fleet overview to load details here.</p>
              </div>
            )}
          </section>

        </aside>
      </main>

      {isManageMediaOpen ? (
        <div className="modal-backdrop" onClick={closeManageMediaModal} role="presentation">
          <section
            aria-label="Manage media"
            className="modal panel panel--settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel__heading">
              <div>
                <h2>Manage Media</h2>
                <p>Upload and delete ISO/IMG files for a selected host.</p>
              </div>
              <button
                aria-label="Close media manager"
                className="button button--ghost button--icon button--close"
                onClick={closeManageMediaModal}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <form className="settings-form" onSubmit={(event) => void submitManageMediaUpload(event)}>
              <label className="field">
                <span>Host</span>
                <select
                  required
                  value={manageMediaServerId}
                  onChange={(event) => {
                    const serverId = event.target.value;
                    setManageMediaServerId(serverId);
                    if (serverId) {
                      void loadBootMedia(serverId);
                    }
                  }}
                >
                  <option value="">Select host</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Choose media file</span>
                <input
                  ref={manageMediaInputRef}
                  accept=".iso,.img,application/octet-stream"
                  type="file"
                />
              </label>

              <div className="button-row button-row--tight">
                <button className="button" disabled={!manageMediaServerId || uploadBusyServerId === manageMediaServerId} type="submit">
                  {uploadBusyServerId === manageMediaServerId ? 'Uploading…' : 'Upload media'}
                </button>
              </div>
            </form>

            <section className="settings-section">
              <div className="settings-section__header">
                <h3>Uploaded media</h3>
                <p>
                  {manageMediaServerId
                    ? 'Delete media files that are no longer needed for this host.'
                    : 'Select a host to view media files.'}
                </p>
              </div>

              {manageMediaServerId && loadingBootMediaServerId === manageMediaServerId ? (
                <p className="detail-placeholder">Loading uploaded ISO/IMG files…</p>
              ) : null}

              {manageMediaServerId && (bootMediaByServerId[manageMediaServerId] ?? []).length > 0 ? (
                <div className="boot-media-list">
                  {(bootMediaByServerId[manageMediaServerId] ?? []).map((item) => {
                    const deleteKey = `${manageMediaServerId}:${item.file_name}`;
                    const isDeleting = deletingBootMediaKey === deleteKey;

                    return (
                      <div className="boot-media-item" key={item.file_name}>
                        <div className="boot-media-item__meta">
                          <strong>{item.file_name}</strong>
                          <span>{formatBytesValue(item.size_bytes)} · {formatEpochSeconds(item.modified_epoch)}</span>
                        </div>
                        <button
                          className="button button--ghost button--danger"
                          disabled={isDeleting}
                          onClick={() => void removeBootMedia(manageMediaServerId, item.file_name)}
                          type="button"
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {manageMediaServerId && (bootMediaByServerId[manageMediaServerId] ?? []).length === 0 && loadingBootMediaServerId !== manageMediaServerId ? (
                <p className="detail-placeholder">No uploaded media found on this host.</p>
              ) : null}
            </section>
          </section>
        </div>
      ) : null}

      {isCreateVmOpen ? (
        <div className="modal-backdrop" onClick={() => setIsCreateVmOpen(false)} role="presentation">
          <section
            aria-label="Create VM"
            className="modal panel panel--settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel__heading">
              <div>
                <h2>Add VM</h2>
                <p>Create a VM on the selected Poseidon host.</p>
              </div>
              <button
                aria-label="Close create VM"
                className="button button--ghost button--icon button--close"
                onClick={() => setIsCreateVmOpen(false)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <form className="settings-form" onSubmit={(event) => void submitCreateVm(event)}>
              <label className="field">
                <span>Host</span>
                <select
                  required
                  value={createVmForm.serverId}
                  onChange={(event) => {
                    const serverId = event.target.value;
                    setCreateVmForm((current) => ({ ...current, serverId }));
                    if (serverId) {
                      void loadBootMedia(serverId);
                    }
                  }}
                >
                  <option value="">Select host</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>VM name</span>
                <input
                  required
                  value={createVmForm.vmName}
                  onChange={(event) =>
                    setCreateVmForm((current) => ({ ...current, vmName: event.target.value }))
                  }
                />
              </label>
              <div className="vm-action-form__row">
                <label className="field">
                  <span>CPU cores</span>
                  <input
                    min={1}
                    required
                    type="number"
                    value={createVmForm.cpu}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, cpu: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Memory (MB)</span>
                  <input
                    min={1}
                    required
                    type="number"
                    value={createVmForm.memory}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, memory: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="vm-action-form__row">
                <label className="field">
                  <span>Disk size (MB)</span>
                  <input
                    min={1}
                    required
                    type="number"
                    value={createVmForm.diskSize}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, diskSize: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Storage target</span>
                  <input
                    required
                    value={createVmForm.storageTarget}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, storageTarget: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="vm-action-form__row">
                <label className="field">
                  <span>Virtual switch</span>
                  <input
                    required
                    value={createVmForm.networkSwitch}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, networkSwitch: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Interface type</span>
                  <input
                    value={createVmForm.interfaceType}
                    onChange={(event) =>
                      setCreateVmForm((current) => ({ ...current, interfaceType: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="vm-action-form__row">
                <label className="field">
                  <span>Boot source type</span>
                  <select
                    value={createVmForm.bootSourceType}
                    onChange={(event) => {
                      const nextType = event.target.value as 'template' | 'iso' | 'img';
                      setCreateVmForm((current) => ({
                        ...current,
                        bootSourceType: nextType,
                        bootSource: '',
                      }));
                    }}
                  >
                    <option value="template">template</option>
                    <option value="iso">iso</option>
                    <option value="img">img</option>
                  </select>
                </label>
                <label className="field">
                  <span>Bootloader</span>
                  <select
                    value={createVmForm.bootloader}
                    onChange={(event) => {
                      const bootloader = event.target.value as '' | 'bhyveload' | 'grub' | 'uefi' | 'uefi-csm';
                      setCreateVmForm((current) => ({ ...current, bootloader }));
                    }}
                  >
                    <option value="">Poseidon default</option>
                    <option value="bhyveload">bhyveload</option>
                    <option value="grub">grub</option>
                    <option value="uefi">uefi</option>
                    <option value="uefi-csm">uefi-csm</option>
                  </select>
                </label>
                <label className="field">
                  <span>
                    Boot source
                    {createVmForm.bootSourceType !== 'template'
                      ? ' (uploaded media)'
                      : ''}
                  </span>
                  {createVmForm.bootSourceType === 'template' ? (
                    <input
                      required
                      value={createVmForm.bootSource}
                      onChange={(event) =>
                        setCreateVmForm((current) => ({ ...current, bootSource: event.target.value }))
                      }
                    />
                  ) : (
                    <select
                      required
                      value={createVmForm.bootSource}
                      onChange={(event) =>
                        setCreateVmForm((current) => ({ ...current, bootSource: event.target.value }))
                      }
                    >
                      <option value="">
                        {loadingBootMediaServerId === createVmForm.serverId
                          ? 'Loading uploaded media…'
                          : `Select ${createVmForm.bootSourceType.toUpperCase()} file`}
                      </option>
                      {createVmMediaOptions.map((item) => (
                        <option key={item.file_name} value={item.file_path}>
                          {item.file_name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              </div>

              {createVmForm.bootSourceType !== 'template' ? (
                <div className="button-row button-row--tight">
                  <button
                    className="button button--ghost button--small"
                    disabled={!createVmForm.serverId}
                    onClick={() => void loadBootMedia(createVmForm.serverId)}
                    type="button"
                  >
                    Reload host media
                  </button>
                  {createVmMediaOptions.length === 0 && loadingBootMediaServerId !== createVmForm.serverId ? (
                    <span className="tag">No matching {createVmForm.bootSourceType.toUpperCase()} files found</span>
                  ) : null}
                </div>
              ) : null}
              <label className="field field--checkbox">
                <input
                  checked={createVmForm.startAfterCreate}
                  onChange={(event) =>
                    setCreateVmForm((current) => ({ ...current, startAfterCreate: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Start after create</span>
              </label>
              <label className="field field--checkbox">
                <input
                  checked={createVmForm.validateOnly}
                  onChange={(event) =>
                    setCreateVmForm((current) => ({ ...current, validateOnly: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Validate only (dry run)</span>
              </label>
              <div className="button-row button-row--tight">
                <button className="button" disabled={createVmBusy} type="submit">
                  {createVmBusy ? 'Creating…' : 'Create VM'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isDeleteVmOpen ? (
        <div className="modal-backdrop" onClick={() => setIsDeleteVmOpen(false)} role="presentation">
          <section
            aria-label="Delete VM"
            className="modal panel panel--settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel__heading">
              <div>
                <h2>Delete VM</h2>
                <p>Delete VM definitions and optionally destroy disks.</p>
              </div>
              <button
                aria-label="Close delete VM"
                className="button button--ghost button--icon button--close"
                onClick={() => setIsDeleteVmOpen(false)}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <form className="settings-form" onSubmit={(event) => void submitDeleteVm(event)}>
              <label className="field">
                <span>Host</span>
                <select
                  required
                  value={deleteVmForm.serverId}
                  onChange={(event) =>
                    setDeleteVmForm((current) => ({ ...current, serverId: event.target.value }))
                  }
                >
                  <option value="">Select host</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>VM name</span>
                <input
                  required
                  value={deleteVmForm.vmName}
                  onChange={(event) =>
                    setDeleteVmForm((current) => ({ ...current, vmName: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Confirm VM name</span>
                <input
                  required
                  placeholder="Type the VM name again"
                  value={deleteVmForm.confirmVmName}
                  onChange={(event) =>
                    setDeleteVmForm((current) => ({ ...current, confirmVmName: event.target.value }))
                  }
                />
              </label>
              {deleteVmForm.confirmVmName.trim().length > 0
              && deleteVmForm.confirmVmName.trim() !== deleteVmForm.vmName.trim() ? (
                <p className="callout callout--error">Confirmation must exactly match the VM name.</p>
                ) : null}
              <label className="field field--checkbox">
                <input
                  checked={deleteVmForm.force}
                  onChange={(event) =>
                    setDeleteVmForm((current) => ({ ...current, force: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Force stop if running</span>
              </label>
              <label className="field field--checkbox">
                <input
                  checked={deleteVmForm.destroyDisks}
                  onChange={(event) =>
                    setDeleteVmForm((current) => ({ ...current, destroyDisks: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>Destroy VM disks</span>
              </label>
              <div className="button-row button-row--tight">
                <button
                  className="button button--danger"
                  disabled={
                    deleteVmBusy
                    || deleteVmForm.vmName.trim().length === 0
                    || deleteVmForm.confirmVmName.trim() !== deleteVmForm.vmName.trim()
                  }
                  type="submit"
                >
                  {deleteVmBusy ? 'Deleting…' : 'Delete VM'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="modal-backdrop" onClick={closeSettingsModal} role="presentation">
          <section
            aria-label="Host settings"
            className="modal panel panel--settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel__heading">
              <div>
                <h2>Host settings</h2>
                <p>Manage Poseidon hosts, default credentials, and saved config from the app.</p>
              </div>
              <button
                aria-label="Close settings"
                className="button button--ghost button--icon button--close"
                onClick={closeSettingsModal}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            {settingsError ? <p className="callout callout--error">{settingsError}</p> : null}
            {settingsMessage ? <p className="callout callout--success">{settingsMessage}</p> : null}

            <div className="settings-tabs" role="tablist" aria-label="Settings sections">
              <button
                aria-selected={activeSettingsTab === 'general'}
                className={activeSettingsTab === 'general' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                onClick={() => setActiveSettingsTab('general')}
                role="tab"
                type="button"
              >
                General
              </button>
              <button
                aria-selected={activeSettingsTab === 'hosts'}
                className={activeSettingsTab === 'hosts' ? 'settings-tab settings-tab--active' : 'settings-tab'}
                onClick={() => setActiveSettingsTab('hosts')}
                role="tab"
                type="button"
              >
                Configured hosts
              </button>
            </div>

            {activeSettingsTab === 'general' ? (
              <div className="settings-workspace">
            <section className="settings-section settings-section--appearance">
              <div className="settings-section__header">
                <h3>Appearance</h3>
                <p>Choose the interface contrast that works best for this display.</p>
              </div>
              <label className="theme-switch">
                <Sun aria-hidden="true" size={17} />
                <input
                  aria-label="Use dark theme"
                  checked={theme === 'dark'}
                  onChange={(event) => setTheme(event.target.checked ? 'dark' : 'light')}
                  type="checkbox"
                />
                <span className="theme-switch__track"><span className="theme-switch__thumb" /></span>
                <Moon aria-hidden="true" size={17} />
                <strong>{theme === 'dark' ? 'Dark' : 'Light'}</strong>
              </label>
            </section>

            <div className="settings-grid">
            <section className="settings-section">
              <div className="settings-section__header">
                <h3>Default credentials</h3>
                <div className="config-card__meta">
                  <span className="tag">
                    {settingsSummary.defaultsHasApiKey ? 'Default API key stored' : 'No default API key'}
                  </span>
                  <span className="tag">
                    {settingsSummary.defaultsHasAdminToken
                      ? 'Default admin token stored'
                      : 'No default admin token'}
                  </span>
                </div>
              </div>

              <form className="settings-form settings-form--credentials" onSubmit={(event) => void saveDefaultCredentials(event)}>
                <label className="field">
                  <span>Default x-api-key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Leave blank to keep the stored default key"
                    value={defaultsForm.xApiKey}
                    onChange={(event) =>
                      setDefaultsForm((current) => ({
                        ...current,
                        xApiKey: event.target.value,
                        clearApiKey: false,
                      }))
                    }
                  />
                </label>

                <label className="field field--checkbox">
                  <input
                    type="checkbox"
                    checked={defaultsForm.clearApiKey}
                    onChange={(event) =>
                      setDefaultsForm((current) => ({
                        ...current,
                        clearApiKey: event.target.checked,
                        xApiKey: event.target.checked ? '' : current.xApiKey,
                      }))
                    }
                  />
                  <span>Clear stored default API key</span>
                </label>

                <label className="field">
                  <span>Default x-admin-token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Leave blank to keep the stored default token"
                    value={defaultsForm.xAdminToken}
                    onChange={(event) =>
                      setDefaultsForm((current) => ({
                        ...current,
                        xAdminToken: event.target.value,
                        clearAdminToken: false,
                      }))
                    }
                  />
                </label>

                <label className="field field--checkbox">
                  <input
                    type="checkbox"
                    checked={defaultsForm.clearAdminToken}
                    onChange={(event) =>
                      setDefaultsForm((current) => ({
                        ...current,
                        clearAdminToken: event.target.checked,
                        xAdminToken: event.target.checked ? '' : current.xAdminToken,
                      }))
                    }
                  />
                  <span>Clear stored default admin token</span>
                </label>

                <div className="button-row button-row--tight">
                  <button className="button" disabled={savingSettings} type="submit">
                    {savingSettings ? 'Saving…' : 'Save defaults'}
                  </button>
                </div>
              </form>
            </section>

            <section className="settings-section">
              <div className="settings-section__header">
                <h3>Import or export</h3>
                <p>Export saved hosts and defaults, or import them onto another system.</p>
              </div>

              <div className="button-row button-row--tight">
                <button className="button button--ghost" onClick={() => void exportConfig()} type="button">
                  Export config
                </button>
                <button
                  className="button button--ghost"
                  onClick={() => importInputRef.current?.click()}
                  type="button"
                >
                  Import config
                </button>
                <input
                  ref={importInputRef}
                  accept="application/json"
                  className="visually-hidden"
                  onChange={(event) => void importConfig(event)}
                  type="file"
                />
              </div>
            </section>
            </div>

            <section className="settings-section settings-section--host-form">
              <div className="settings-section__header">
                <h3>{editingServerId ? 'Edit host connection' : 'Add a host'}</h3>
                <p>Connection details and optional host-specific credential overrides.</p>
              </div>
            <form className="settings-form settings-form--host" onSubmit={(event) => void saveSettings(event)}>
              <label className="field">
                <span>Server ID</span>
                <input
                  required
                  value={settingsForm.id}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, id: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Display name</span>
                <input
                  required
                  value={settingsForm.name}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Base URL</span>
                <input
                  required
                  type="url"
                  value={settingsForm.baseUrl}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>x-api-key</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={editingServerId ? 'Leave blank to keep the stored key or default' : 'Optional if a default key is stored'}
                  value={settingsForm.xApiKey}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      xApiKey: event.target.value,
                      clearApiKey: false,
                    }))
                  }
                />
              </label>

              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={settingsForm.clearApiKey}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      clearApiKey: event.target.checked,
                      xApiKey: event.target.checked ? '' : current.xApiKey,
                    }))
                  }
                />
                <span>Clear stored API key</span>
              </label>

              <label className="field">
                <span>x-admin-token</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={editingServerId ? 'Leave blank to keep the stored token or default' : 'Optional if a default token is stored'}
                  value={settingsForm.xAdminToken}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      xAdminToken: event.target.value,
                      clearAdminToken: false,
                    }))
                  }
                />
              </label>

              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={settingsForm.clearAdminToken}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      clearAdminToken: event.target.checked,
                      xAdminToken: event.target.checked ? '' : current.xAdminToken,
                    }))
                  }
                />
                <span>Clear stored admin token</span>
              </label>

              <div className="button-row button-row--tight">
                <button className="button" disabled={savingSettings} type="submit">
                  {savingSettings ? 'Saving…' : editingServerId ? 'Update host' : 'Add host'}
                </button>
                <button
                  className="button button--ghost"
                  disabled={savingSettings}
                  onClick={resetSettingsForm}
                  type="button"
                >
                  Reset
                </button>
              </div>
            </form>
            </section>

              </div>
            ) : null}

            {activeSettingsTab === 'hosts' ? (
            <div className="config-list">
              {servers.map((server) => (
                <article className="config-card" key={server.id}>
                  <div>
                    <h3>{server.name}</h3>
                    <p>{server.baseUrl}</p>
                  </div>
                  <div className="config-card__meta">
                    <span className="tag">{server.id}</span>
                    <span className="tag">{server.hasApiKey ? 'API key stored' : 'No API key'}</span>
                    <span className="tag">
                      {server.hasAdminToken ? 'Admin token stored' : 'No admin token'}
                    </span>
                  </div>
                  <div className="button-row button-row--tight">
                    <button
                      className="button button--ghost"
                      onClick={() => startEditing(server)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="button button--ghost button--danger"
                      disabled={savingSettings}
                      onClick={() => void removeServer(server.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}

              {servers.length === 0 ? (
                <article className="empty-state empty-state--settings">
                  <h3>No configured hosts</h3>
                  <p>Use the General tab to add your first Poseidon host.</p>
                </article>
              ) : null}
            </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
