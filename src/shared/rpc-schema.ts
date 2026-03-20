import type { ElectrobunRPCSchema } from "electrobun/bun";
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
} from "./types";

// Re-export for convenience
export type {
  AppUpdateStatusInfo,
  ProjectInfo,
  SecretInfo,
  EnvironmentInfo,
  AuditEntryInfo,
  EnvFileInfo,
  EnvImportResultInfo,
  ConfigInfo,
  CliInstallResultInfo,
  CliInstallStatusInfo,
  ProjectPolicyInfo,
  ProviderDiagnosticsInfo,
  ProviderSessionExpiryResultInfo,
  RestoredEnvFileInfo,
  SchemaImportResultInfo,
  SchemaFieldInfo,
};

// ── RPC Schema ──────────────────────────────────────────────────────────

export interface CloakEnvRPCSchema extends ElectrobunRPCSchema {
  bun: {
    requests: {
      // ── Projects ─────────────────────────────
      listProjects: {
        params: undefined;
        response: ProjectInfo[];
      };
      createProject: {
        params: { name: string; path?: string };
        response: ProjectInfo;
      };
      removeProject: {
        params: { projectId: string };
        response: undefined;
      };
      renameProject: {
        params: { projectId: string; newName: string };
        response: undefined;
      };

      // ── Secrets ──────────────────────────────
      getSecrets: {
        params: { projectId: string; environment?: string };
        response: SecretInfo[];
      };
      listEnvironments: {
        params: { projectId: string };
        response: EnvironmentInfo[];
      };
      createEnvironment: {
        params: { projectId: string; name: string };
        response: EnvironmentInfo;
      };
      removeEnvironment: {
        params: { projectId: string; environmentId: string };
        response: undefined;
      };
      setSecret: {
        params: { projectId: string; key: string; value: string; scope?: string };
        response: SecretInfo;
      };
      removeSecret: {
        params: { projectId: string; secretId: string };
        response: undefined;
      };
      revealSecret: {
        params: { projectId: string; secretId: string };
        response: { value: string };
      };
      getSecretHistory: {
        params: { projectId: string; secretId: string };
        response: Array<{ value: string; version: number; createdAt: number }>;
      };
      getProjectSchema: {
        params: { projectId: string };
        response: SchemaFieldInfo[];
      };
      getProjectPolicy: {
        params: { projectId: string };
        response: ProjectPolicyInfo;
      };
      createProjectSchemaEntry: {
        params: {
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
        };
        response: SchemaFieldInfo;
      };
      updateProjectSchemaEntry: {
        params: {
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
        };
        response: SchemaFieldInfo;
      };
      removeProjectSchemaEntry: {
        params: { projectId: string; schemaEntryId: string };
        response: undefined;
      };
      updateProjectPolicyDefaults: {
        params: {
          projectId: string;
          defaultScope: string;
          defaultCliVisibility: "allow" | "deny";
          defaultAdapterVisibility: "allow" | "deny";
        };
        response: ProjectPolicyInfo;
      };
      updateScopePolicy: {
        params: {
          projectId: string;
          scope: string;
          cliVisibilityOverride: "inherit" | "allow" | "deny";
          adapterVisibilityOverride: "inherit" | "allow" | "deny";
        };
        response: ProjectPolicyInfo;
      };
      exportProjectSchema: {
        params: { projectId: string };
        response: { path: string; entries: number };
      };
      importProjectSchema: {
        params: { projectId: string; filePath?: string };
        response: SchemaImportResultInfo;
      };

      // ── File System (native dialogs) ─────────
      openFolderDialog: {
        params: undefined;
        response: string | null;
      };
      openSchemaFileDialog: {
        params: undefined;
        response: string | null;
      };
      scanEnvFiles: {
        params: { folderPath: string };
        response: EnvFileInfo[];
      };
      importEnvFile: {
        params: { projectId: string; filePath: string };
        response: EnvImportResultInfo;
      };
      deleteFile: {
        params: { filePath: string };
        response: undefined;
      };
      openBackupFolderDialog: {
        params: undefined;
        response: string | null;
      };
      openCloakedFileDialog: {
        params: undefined;
        response: string | null;
      };

      // ── Confirm Dialog ───────────────────────
      showConfirmDialog: {
        params: { title: string; message: string; detail?: string };
        response: boolean;
      };

      // ── Backup ───────────────────────────────
      exportVault: {
        params: { projectId?: string; passphrase: string };
        response: { path: string };
      };
      restorePlainEnv: {
        params: { projectId: string; destinationFolder?: string };
        response: { destinationFolder: string; files: RestoredEnvFileInfo[] };
      };
      importCloaked: {
        params: { filePath: string; passphrase: string };
        response: { projectsImported: number; secretsImported: number };
      };

      // ── Audit ────────────────────────────────
      getAuditLog: {
        params: { projectId?: string; limit?: number };
        response: AuditEntryInfo[];
      };

      // ── Config ───────────────────────────────
      getConfig: {
        params: undefined;
        response: ConfigInfo;
      };
      getProviderDiagnostics: {
        params: undefined;
        response: ProviderDiagnosticsInfo;
      };
      getCliInstallStatus: {
        params: undefined;
        response: CliInstallStatusInfo;
      };
      getAppUpdateStatus: {
        params: undefined;
        response: AppUpdateStatusInfo;
      };
      installCliCommand: {
        params: undefined;
        response: CliInstallResultInfo;
      };
      checkForAppUpdates: {
        params: { downloadIfAvailable?: boolean; userInitiated?: boolean } | undefined;
        response: AppUpdateStatusInfo;
      };
      downloadAppUpdate: {
        params: undefined;
        response: AppUpdateStatusInfo;
      };
      applyAppUpdate: {
        params: undefined;
        response: undefined;
      };
      expireProviderSession: {
        params: { sessionId?: string; all?: boolean };
        response: ProviderSessionExpiryResultInfo;
      };
      setConfig: {
        params: { key: string; value: string };
        response: undefined;
      };
      setAutoBackupPassphrase: {
        params: { passphrase: string };
        response: undefined;
      };
      openPreferencesWindow: {
        params: undefined;
        response: undefined;
      };
      closeFocusedWindow: {
        params: undefined;
        response: undefined;
      };
      closeMainWindow: {
        params: undefined;
        response: undefined;
      };
      minimizeMainWindow: {
        params: undefined;
        response: undefined;
      };
      toggleMainWindowMaximize: {
        params: undefined;
        response: undefined;
      };
      reloadFocusedWindow: {
        params: undefined;
        response: undefined;
      };
      toggleDevTools: {
        params: undefined;
        response: undefined;
      };
    };
    messages: {
      vaultStatusChanged: { locked: boolean };
      secretsUpdated: { projectId: string };
      backupCompleted: { path: string };
      appUpdateStatusChanged: AppUpdateStatusInfo;
      openPreferences: undefined;
      openTools: undefined;
      openTraces: undefined;
      newProject: undefined;
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      showToast: { message: string; type: "success" | "error" | "info" };
    };
  };
}
