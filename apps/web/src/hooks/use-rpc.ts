import type { CloakEnvRPCSchema } from "@shared/rpc-schema";
import type {
  AppUpdateStatusInfo,
  AuditEntryInfo,
  CliInstallResultInfo,
  CliInstallStatusInfo,
  ConfigInfo,
  EnvFileInfo,
  EnvImportResultInfo,
  EnvironmentInfo,
  ProjectInfo,
  ProjectPolicyInfo,
  ProviderDiagnosticsInfo,
  ProviderSessionExpiryResultInfo,
  RestoredEnvFileInfo,
  SchemaFieldInfo,
  SchemaImportResultInfo,
  SecretInfo,
} from "@shared/types";
import { Electroview } from "electrobun/view";
import { useSyncExternalStore } from "react";
import {
  DESKTOP_EVENT_APP_UPDATE_STATUS_CHANGED,
  DESKTOP_EVENT_NEW_PROJECT,
  DESKTOP_EVENT_OPEN_PREFERENCES,
  DESKTOP_EVENT_OPEN_TOOLS,
  DESKTOP_EVENT_OPEN_TRACES,
} from "@/lib/desktop-events";

// Re-export types for consumers
export type { ProjectInfo, SecretInfo, EnvironmentInfo, AuditEntryInfo, EnvFileInfo, ConfigInfo };
export type {
  AppUpdateStatusInfo,
  CliInstallResultInfo,
  CliInstallStatusInfo,
  EnvImportResultInfo,
  ProviderDiagnosticsInfo,
  ProviderSessionExpiryResultInfo,
  ProjectPolicyInfo,
  RestoredEnvFileInfo,
  SchemaFieldInfo,
  SchemaImportResultInfo,
};

// ── RPC Interface ─────────────────────────────────────────────────────

export interface VaultRPC {
  listProjects(params?: undefined): Promise<ProjectInfo[]>;
  createProject(params: { name: string; path?: string }): Promise<ProjectInfo>;
  removeProject(params: { projectId: string }): Promise<void>;
  renameProject(params: { projectId: string; newName: string }): Promise<void>;
  getSecrets(params: { projectId: string; environment?: string }): Promise<SecretInfo[]>;
  listEnvironments(params: { projectId: string }): Promise<EnvironmentInfo[]>;
  createEnvironment(params: { projectId: string; name: string }): Promise<EnvironmentInfo>;
  removeEnvironment(params: { projectId: string; environmentId: string }): Promise<void>;
  setSecret(params: {
    projectId: string;
    key: string;
    value: string;
    scope?: string;
  }): Promise<SecretInfo>;
  removeSecret(params: { projectId: string; secretId: string }): Promise<void>;
  revealSecret(params: { projectId: string; secretId: string }): Promise<{ value: string }>;
  getSecretHistory(params: {
    projectId: string;
    secretId: string;
  }): Promise<Array<{ value: string; version: number; createdAt: number }>>;
  getProjectSchema(params: { projectId: string }): Promise<SchemaFieldInfo[]>;
  getProjectPolicy(params: { projectId: string }): Promise<ProjectPolicyInfo>;
  createProjectSchemaEntry(params: {
    projectId: string;
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
  }): Promise<SchemaFieldInfo>;
  updateProjectSchemaEntry(params: {
    projectId: string;
    id: string;
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
  }): Promise<SchemaFieldInfo>;
  removeProjectSchemaEntry(params: { projectId: string; schemaEntryId: string }): Promise<void>;
  updateProjectPolicyDefaults(params: {
    projectId: string;
    defaultScope: string;
    defaultCliVisibility: "allow" | "deny";
    defaultAdapterVisibility: "allow" | "deny";
  }): Promise<ProjectPolicyInfo>;
  updateScopePolicy(params: {
    projectId: string;
    scope: string;
    cliVisibilityOverride: "inherit" | "allow" | "deny";
    adapterVisibilityOverride: "inherit" | "allow" | "deny";
  }): Promise<ProjectPolicyInfo>;
  exportProjectSchema(params: { projectId: string }): Promise<{ path: string; entries: number }>;
  importProjectSchema(params: {
    projectId: string;
    filePath?: string;
  }): Promise<SchemaImportResultInfo>;
  openFolderDialog(params?: undefined): Promise<string | null>;
  openSchemaFileDialog(params?: undefined): Promise<string | null>;
  scanEnvFiles(params: { folderPath: string }): Promise<EnvFileInfo[]>;
  importEnvFile(params: { projectId: string; filePath: string }): Promise<EnvImportResultInfo>;
  deleteFile(params: { filePath: string }): Promise<void>;
  openBackupFolderDialog(params?: undefined): Promise<string | null>;
  openCloakedFileDialog(params?: undefined): Promise<string | null>;
  showConfirmDialog(params: { title: string; message: string; detail?: string }): Promise<boolean>;
  exportVault(params: { projectId?: string; passphrase: string }): Promise<{ path: string }>;
  restorePlainEnv(params: {
    projectId: string;
    destinationFolder?: string;
  }): Promise<{ destinationFolder: string; files: RestoredEnvFileInfo[] }>;
  importCloaked(params: {
    filePath: string;
    passphrase: string;
  }): Promise<{ projectsImported: number; secretsImported: number }>;
  getAuditLog(params: { projectId?: string; limit?: number }): Promise<AuditEntryInfo[]>;
  getConfig(params?: undefined): Promise<ConfigInfo>;
  getProviderDiagnostics(params?: undefined): Promise<ProviderDiagnosticsInfo>;
  getCliInstallStatus(params?: undefined): Promise<CliInstallStatusInfo>;
  getAppUpdateStatus(params?: undefined): Promise<AppUpdateStatusInfo>;
  installCliCommand(params?: undefined): Promise<CliInstallResultInfo>;
  checkForAppUpdates(params?: {
    downloadIfAvailable?: boolean;
    userInitiated?: boolean;
  }): Promise<AppUpdateStatusInfo>;
  downloadAppUpdate(params?: undefined): Promise<AppUpdateStatusInfo>;
  applyAppUpdate(params?: undefined): Promise<void>;
  expireProviderSession(params: {
    sessionId?: string;
    all?: boolean;
  }): Promise<ProviderSessionExpiryResultInfo>;
  setConfig(params: { key: string; value: string }): Promise<void>;
  setAutoBackupPassphrase(params: { passphrase: string }): Promise<void>;
  openPreferencesWindow(params?: undefined): Promise<void>;
  closeFocusedWindow(params?: undefined): Promise<void>;
  closeMainWindow(params?: undefined): Promise<void>;
  minimizeMainWindow(params?: undefined): Promise<void>;
  toggleMainWindowMaximize(params?: undefined): Promise<void>;
  reloadFocusedWindow(params?: undefined): Promise<void>;
  toggleDevTools(params?: undefined): Promise<void>;
}

let _rpc: VaultRPC | null = null;
let _error: string | null = null;
let _lastLoggedError: string | null = null;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _retryDelayMs = 150;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clearRetryTimer() {
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
}

function scheduleRPCRetry() {
  if (typeof window === "undefined" || _rpc || _retryTimer) {
    return;
  }

  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    _error = null;

    initRPC();
    emit();

    if (!_rpc) {
      _retryDelayMs = Math.min(_retryDelayMs * 2, 1_000);
      scheduleRPCRetry();
    }
  }, _retryDelayMs);
}

function initRPC(): VaultRPC | null {
  if (_rpc) {
    return _rpc;
  }

  try {
    const rpc = Electroview.defineRPC<CloakEnvRPCSchema>({
      maxRequestTime: 120_000,
      handlers: {
        requests: {},
        messages: {
          showToast: () => {},
          appUpdateStatusChanged: (payload) => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent(DESKTOP_EVENT_APP_UPDATE_STATUS_CHANGED, {
                  detail: payload,
                }),
              );
            }
          },
          openPreferences: () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(DESKTOP_EVENT_OPEN_PREFERENCES));
            }
          },
          openTools: () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(DESKTOP_EVENT_OPEN_TOOLS));
            }
          },
          openTraces: () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(DESKTOP_EVENT_OPEN_TRACES));
            }
          },
          newProject: () => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(DESKTOP_EVENT_NEW_PROJECT));
            }
          },
        },
      },
    });
    const electroview = new Electroview({ rpc });
    if (!electroview.rpc) {
      throw new Error("Electroview RPC transport was not initialized");
    }
    _rpc = electroview.rpc.request as unknown as VaultRPC;
    _error = null;
    _retryDelayMs = 150;
    clearRetryTimer();
  } catch (error) {
    _error = error instanceof Error ? error.message : String(error);
    if (_error !== _lastLoggedError) {
      console.error("[CloakEnv] Failed to initialize RPC:", error);
      _lastLoggedError = _error;
    }
    scheduleRPCRetry();
  }

  return _rpc;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!_rpc) {
    initRPC();
  }

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VaultRPC | null {
  return _rpc ?? initRPC();
}

export function getRPCError(): string | null {
  return _error;
}

export function useRPC(): VaultRPC | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function retryRPCInit(): VaultRPC | null {
  clearRetryTimer();
  _error = null;
  _lastLoggedError = null;
  _retryDelayMs = 150;
  const rpc = initRPC();
  emit();
  return rpc;
}
