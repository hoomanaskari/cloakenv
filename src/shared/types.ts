// ── Data types shared between main process (Bun) and WebView (Vite) ─────

export interface ProjectInfo {
  id: string;
  name: string;
  path: string | null;
  secretCount: number;
  updatedAt: number;
}

export interface SecretInfo {
  id: string;
  key: string;
  value: string | null;
  maskedValue: string;
  scope: string;
  version: number;
  sensitive: boolean;
  updatedAt: number;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
  sourceFile: string | null;
  sourceKind: "imported" | "manual";
  secretCount: number;
  updatedAt: number;
}

export type ScopeAccessModeInfo = "allow" | "deny";
export type ScopeAccessModeOverrideInfo = ScopeAccessModeInfo | "inherit";

export interface ScopePolicyInfo {
  id: string | null;
  scope: string;
  sourceFile: string | null;
  sourceKind: "imported" | "manual";
  secretCount: number;
  updatedAt: number;
  isDefaultScope: boolean;
  cliVisibility: ScopeAccessModeInfo;
  adapterVisibility: ScopeAccessModeInfo;
  cliVisibilityOverride: ScopeAccessModeOverrideInfo;
  adapterVisibilityOverride: ScopeAccessModeOverrideInfo;
  restoreFileName: string;
}

export interface ProjectPolicyInfo {
  projectId: string;
  projectName: string;
  defaultScope: string;
  defaultCliVisibility: ScopeAccessModeInfo;
  defaultAdapterVisibility: ScopeAccessModeInfo;
  scopes: ScopePolicyInfo[];
}

export interface AuditEntryInfo {
  id: string;
  requestId: string | null;
  projectId: string | null;
  action: string;
  keyName: string | null;
  scope: string | null;
  processName: string | null;
  processPid: number | null;
  workingDir: string | null;
  hasTty: boolean | null;
  argv: string[] | null;
  outputPath: string | null;
  decision: string | null;
  timestamp: number;
}

export interface EnvFileInfo {
  fileName: string;
  filePath: string;
  environmentName: string;
  entries: Array<{ key: string; value: string }>;
}

export interface SchemaValidationWarningInfo {
  key: string;
  scope: string;
  message: string;
}

export interface EnvImportResultInfo {
  imported: number;
  schemaMatched: number;
  warnings: SchemaValidationWarningInfo[];
}

export interface SchemaImportResultInfo {
  path: string;
  scope: string;
  metadataApplied: number;
  created: number;
  skipped: number;
  warnings: SchemaValidationWarningInfo[];
}

export interface SchemaFieldInfo {
  id: string;
  schemaEntryId: string | null;
  secretId: string | null;
  hasStoredSchema: boolean;
  hasStoredValue: boolean;
  key: string;
  scope: string;
  typeName: string | null;
  typeParams: Record<string, string> | null;
  sensitive: boolean;
  required: boolean;
  description: string | null;
  example: string | null;
  defaultValue: string | null;
  docsUrls: string[];
}

export interface ConfigInfo {
  backupPath: string | null;
  authMode: "keychain" | "passphrase";
  autoBackup: boolean;
  onboardingCompleted: boolean;
  autoBackupPassphraseConfigured: boolean;
  providerSessionTtlMinutes: number;
  desktopAppearance: "dock_and_menu" | "dock_only" | "menu_only";
}

export interface CliInstallStatusInfo {
  bundled: boolean;
  bundledVersion: string | null;
  installed: boolean;
  installedVersion: string | null;
  installPath: string | null;
  binDirectory: string;
  managed: boolean;
  upToDate: boolean;
  updateAvailable: boolean;
  pathConfigured: boolean;
  shellIntegrationPath: string | null;
}

export interface CliInstallResultInfo {
  installPath: string;
  binDirectory: string;
  bundledVersion: string | null;
  installedVersion: string | null;
  managed: boolean;
  updated: boolean;
  pathConfigured: boolean;
  shellIntegrationPath: string | null;
  requiresRestart: boolean;
}

export interface RestoredEnvFileInfo {
  scope: string;
  fileName: string;
  path: string;
  sourceFile: string | null;
  sourceKind: "imported" | "manual";
}

export interface ProviderSessionInfo {
  id: string;
  action: "resolve_environment" | "run";
  projectId: string;
  projectName: string;
  scope: string;
  workingDir: string;
  requesterLabel: string;
  commandPreview: string;
  createdAt: number;
  expiresAt: number;
  reuseCount: number;
}

export interface ProviderDiagnosticsInfo {
  reachable: boolean;
  mode: "desktop" | "foreground";
  approvalMode: "native" | "terminal";
  endpoint: string;
  endpointSource: "default" | "env";
  transport: "named_pipe" | "unix_socket";
  authMode: "keychain" | "passphrase";
  desktopSensitiveAvailable: boolean;
  providerSessionTtlMinutes: number;
  activeSessionCount: number;
  activeSessions: ProviderSessionInfo[];
}

export interface ProviderSessionExpiryResultInfo {
  expired: number;
  remaining: number;
  expiredSessionId: string | null;
}
