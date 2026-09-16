import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

export type PoseidonServerConfig = {
  id: string;
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
};

export type PublicServerConfig = Omit<PoseidonServerConfig, 'headers'>;

export type EditableServerConfig = PublicServerConfig & {
  hasApiKey: boolean;
  hasAdminToken: boolean;
};

export type ServerSettingsInput = {
  id: string;
  name: string;
  baseUrl: string;
  xApiKey?: string;
  xAdminToken?: string;
  clearApiKey?: boolean;
  clearAdminToken?: boolean;
};

export type DefaultCredentialsInput = {
  xApiKey?: string;
  xAdminToken?: string;
  clearApiKey?: boolean;
  clearAdminToken?: boolean;
};

export type CredentialDefaults = {
  xApiKey?: string;
  xAdminToken?: string;
};

export type SettingsSummary = {
  servers: EditableServerConfig[];
  defaultsHasApiKey: boolean;
  defaultsHasAdminToken: boolean;
  needsOnboarding: boolean;
};

export type ExportedSettings = {
  version: 1;
  exportedAt: string;
  defaults: CredentialDefaults;
  servers: PoseidonServerConfig[];
};

type StoredSettings = {
  defaults: CredentialDefaults;
  servers: PoseidonServerConfig[];
};

const configFilePath = path.resolve(process.cwd(), 'data', 'poseidon-servers.json');

const fallbackServers: PoseidonServerConfig[] = [
  {
    id: 'vmhost1',
    name: 'vmhost1.home.lan',
    baseUrl: 'http://vmhost1.home.lan:8000',
    headers: {},
  },
];

function normalizeServer(input: PoseidonServerConfig): PoseidonServerConfig {
  return {
    id: input.id.trim(),
    name: input.name.trim(),
    baseUrl: input.baseUrl.replace(/\/$/, ''),
    headers: Object.fromEntries(
      Object.entries(input.headers ?? {})
        .map(([key, value]) => [key.toLowerCase().trim(), value.trim()])
        .filter(([, value]) => value.length > 0),
    ),
  };
}

function normalizeDefaults(input: CredentialDefaults | undefined): CredentialDefaults {
  return {
    ...(input?.xApiKey?.trim() ? { xApiKey: input.xApiKey.trim() } : {}),
    ...(input?.xAdminToken?.trim() ? { xAdminToken: input.xAdminToken.trim() } : {}),
  };
}

function loadPersistedSettings(): StoredSettings | null {
  if (!existsSync(configFilePath)) {
    return null;
  }

  const raw = readFileSync(configFilePath, 'utf8');

  try {
    const parsed = JSON.parse(raw) as PoseidonServerConfig[] | StoredSettings;

    if (Array.isArray(parsed)) {
      return {
        defaults: {},
        servers: parsed.map(normalizeServer),
      };
    }

    if (!Array.isArray(parsed.servers)) {
      throw new Error('Expected a servers array.');
    }

    return {
      defaults: normalizeDefaults(parsed.defaults),
      servers: parsed.servers.map(normalizeServer),
    };
  } catch (error) {
    throw new Error(`Unable to parse persisted Poseidon server config: ${String(error)}`);
  }
}

function parseEnvServers(): PoseidonServerConfig[] {
  const raw = process.env.POSEIDON_SERVERS;

  if (!raw) {
    return fallbackServers;
  }

  try {
    const parsed = JSON.parse(raw) as PoseidonServerConfig[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallbackServers;
    }

    return parsed.map(normalizeServer);
  } catch (error) {
    throw new Error(`Unable to parse POSEIDON_SERVERS: ${String(error)}`);
  }
}

function hasCredentialData(settings: StoredSettings): boolean {
  if (settings.defaults.xApiKey || settings.defaults.xAdminToken) {
    return true;
  }

  return settings.servers.some(
    (server) => Boolean(server.headers['x-api-key']) || Boolean(server.headers['x-admin-token']),
  );
}

let storedSettings = loadPersistedSettings() ?? {
  defaults: {},
  servers: parseEnvServers(),
};

function persistServers(): void {
  mkdirSync(path.dirname(configFilePath), { recursive: true });
  writeFileSync(configFilePath, `${JSON.stringify(storedSettings, null, 2)}\n`, 'utf8');
}

function validateInput(input: ServerSettingsInput): void {
  if (!input.id.trim()) {
    throw new Error('Server id is required.');
  }

  if (!input.name.trim()) {
    throw new Error('Server name is required.');
  }

  if (!/^https?:\/\//.test(input.baseUrl.trim())) {
    throw new Error('Base URL must start with http:// or https://');
  }
}

function buildHeaders(
  current: PoseidonServerConfig | undefined,
  input: ServerSettingsInput,
): Record<string, string> {
  const headers = { ...(current?.headers ?? {}) };

  if (input.clearApiKey) {
    delete headers['x-api-key'];
  } else if (input.xApiKey?.trim()) {
    headers['x-api-key'] = input.xApiKey.trim();
  }

  if (input.clearAdminToken) {
    delete headers['x-admin-token'];
  } else if (input.xAdminToken?.trim()) {
    headers['x-admin-token'] = input.xAdminToken.trim();
  }

  return headers;
}

function getEffectiveHeaders(server: PoseidonServerConfig): Record<string, string> {
  return {
    ...(storedSettings.defaults.xApiKey
      ? { 'x-api-key': storedSettings.defaults.xApiKey }
      : {}),
    ...(storedSettings.defaults.xAdminToken
      ? { 'x-admin-token': storedSettings.defaults.xAdminToken }
      : {}),
    ...server.headers,
  };
}

export function getServerConfig(serverId: string): PoseidonServerConfig {
  const server = storedSettings.servers.find((entry) => entry.id === serverId);

  if (!server) {
    throw new Error(`Unknown server '${serverId}'.`);
  }

  return {
    ...server,
    headers: getEffectiveHeaders(server),
  };
}

export function getPublicServerConfigs(): PublicServerConfig[] {
  return storedSettings.servers.map(({ headers: _headers, ...server }) => server);
}

export function getEditableServerConfigs(): EditableServerConfig[] {
  return storedSettings.servers.map(({ headers, ...server }) => ({
    ...server,
    hasApiKey: Boolean(headers['x-api-key']),
    hasAdminToken: Boolean(headers['x-admin-token']),
  }));
}

export function getSettingsSummary(): SettingsSummary {
  return {
    servers: getEditableServerConfigs(),
    defaultsHasApiKey: Boolean(storedSettings.defaults.xApiKey),
    defaultsHasAdminToken: Boolean(storedSettings.defaults.xAdminToken),
    needsOnboarding: !storedSettings.defaults.xApiKey && !storedSettings.defaults.xAdminToken,
  };
}

export function updateDefaultCredentials(input: DefaultCredentialsInput): SettingsSummary {
  const defaults = { ...storedSettings.defaults };

  if (input.clearApiKey) {
    delete defaults.xApiKey;
  } else if (input.xApiKey?.trim()) {
    defaults.xApiKey = input.xApiKey.trim();
  }

  if (input.clearAdminToken) {
    delete defaults.xAdminToken;
  } else if (input.xAdminToken?.trim()) {
    defaults.xAdminToken = input.xAdminToken.trim();
  }

  storedSettings = {
    ...storedSettings,
    defaults: normalizeDefaults(defaults),
  };
  persistServers();
  return getSettingsSummary();
}

export function exportSettings(): ExportedSettings {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    defaults: { ...storedSettings.defaults },
    servers: storedSettings.servers.map((server) => ({
      ...server,
      headers: { ...server.headers },
    })),
  };
}

export function importSettings(payload: unknown): SettingsSummary {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Imported settings must be an object.');
  }

  const parsed = payload as Partial<ExportedSettings & StoredSettings>;

  if (!Array.isArray(parsed.servers)) {
    throw new Error('Imported settings must include a servers array.');
  }

  storedSettings = {
    defaults: normalizeDefaults(parsed.defaults),
    servers: parsed.servers.map(normalizeServer),
  };
  persistServers();
  return getSettingsSummary();
}

export function saveServerConfig(
  input: ServerSettingsInput,
  existingServerId?: string,
): EditableServerConfig[] {
  validateInput(input);

  const current = existingServerId
    ? storedSettings.servers.find((entry) => entry.id === existingServerId)
    : undefined;
  const normalized = normalizeServer({
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    headers: buildHeaders(current, input),
  });

  const duplicate = storedSettings.servers.find(
    (entry) => entry.id === normalized.id && entry.id !== existingServerId,
  );

  if (duplicate) {
    throw new Error(`A server with id '${normalized.id}' already exists.`);
  }

  if (current) {
    storedSettings = {
      ...storedSettings,
      servers: storedSettings.servers.map((entry) =>
        entry.id === existingServerId ? normalized : entry,
      ),
    };
  } else {
    storedSettings = {
      ...storedSettings,
      servers: [...storedSettings.servers, normalized],
    };
  }

  persistServers();
  return getEditableServerConfigs();
}

export function deleteServerConfig(serverId: string): EditableServerConfig[] {
  const nextServers = storedSettings.servers.filter((entry) => entry.id !== serverId);

  if (nextServers.length === storedSettings.servers.length) {
    throw new Error(`Unknown server '${serverId}'.`);
  }

  storedSettings = {
    ...storedSettings,
    servers: nextServers,
  };
  persistServers();
  return getEditableServerConfigs();
}
