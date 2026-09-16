export type PublicServerConfig = {
  id: string;
  name: string;
  baseUrl: string;
};

export type EditableServerConfig = PublicServerConfig & {
  hasApiKey: boolean;
  hasAdminToken: boolean;
};

export type ServerSettingsInput = {
  id: string;
  name: string;
  baseUrl: string;
  xApiKey: string;
  xAdminToken: string;
  clearApiKey: boolean;
  clearAdminToken: boolean;
};

export type DefaultCredentialsInput = {
  xApiKey: string;
  xAdminToken: string;
  clearApiKey: boolean;
  clearAdminToken: boolean;
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
  defaults: {
    xApiKey?: string;
    xAdminToken?: string;
  };
  servers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    headers: Record<string, string>;
  }>;
};

export type VmListItem = {
  fields: Record<string, string>;
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

export type ServerOverview = {
  serverId: string;
  serverName: string;
  baseUrl: string;
  health: 'ok' | 'error';
  healthData: Record<string, string> | null;
  hostSummary: HostSummaryResponse | null;
  vms: VmListItem[];
  error: string | null;
  lastUpdated: string;
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
  };
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
