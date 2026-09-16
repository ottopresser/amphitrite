export type VmSection = {
  type: string;
  fields: Record<string, string>;
};

export type ParsedVmInfo = {
  vmName: string;
  overview: Record<string, string>;
  sections: VmSection[];
};

export type VmVncEndpoint = {
  host: string;
  port: number;
  sourceLine: string;
};

export function parseVmInfoStdout(stdout: string, vmName: string): ParsedVmInfo {
  const lines = stdout.split('\n');
  const overview: Record<string, string> = {};
  const sections: VmSection[] = [];
  let currentSection: VmSection | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();

    // Skip separators, blank lines, and the VM header line
    if (!trimmed || /^-{3,}$/.test(trimmed) || /^Virtual Machine:/i.test(trimmed)) {
      continue;
    }

    // 4-space (section field)
    if (raw.startsWith('    ') && !raw.startsWith('     ')) {
      const m = raw.match(/^    ([^:]+):\s*(.*)$/);
      if (m && currentSection) {
        currentSection.fields[m[1].trim()] = m[2].trim();
      }
      continue;
    }

    // 2-space (top-level field or section header)
    if (raw.startsWith('  ') && !raw.startsWith('   ')) {
      const fieldMatch = raw.match(/^  ([^:]+):\s+(.*)$|^  ([^:]+):\s*$/);
      if (fieldMatch) {
        const key = (fieldMatch[1] ?? fieldMatch[3]).trim();
        const val = (fieldMatch[2] ?? '').trim();
        overview[key] = val;
        currentSection = null;
        continue;
      }

      // Bare section header (no colon + value on the same line)
      if (trimmed) {
        currentSection = { type: trimmed, fields: {} };
        sections.push(currentSection);
      }
    }
  }

  return { vmName, overview, sections };
}

/** Extract the human-readable part from a string like "17217122304 (16.034G)" */
export function humanSize(raw: string): string {
  const m = raw.match(/\(([^)]+)\)/);
  return m ? m[1] : raw;
}

/** Extract raw byte integer from a string like "107374182400 (100.000G)" */
export function rawBytes(raw: string): number {
  const m = raw.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Usage percentage, clamped 0-100 */
export function usagePercent(usedRaw: string, totalRaw: string): number {
  const used = rawBytes(usedRaw);
  const total = rawBytes(totalRaw);
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
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

/** Try to extract a VNC host/port pair from vm info stdout. */
export function extractVmVncEndpoint(
  stdout: string,
  fallbackHost: string,
): VmVncEndpoint | null {
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
          sourceLine: line.trim(),
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
          sourceLine: line.trim(),
        };
      }
    }
  }

  return null;
}
