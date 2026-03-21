import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  AUTO_BACKUP_PASSPHRASE_ACCOUNT,
  AuditRepository,
  bootstrapSecretsFromSchema,
  ConfigRepository,
  exportVault as coreExportVault,
  importVault as coreImportVault,
  DEFAULT_CLOAKED_BACKUP_FILENAME,
  deriveMasterKey,
  deriveProjectKey,
  EnvironmentRepository,
  evaluatePassphrase,
  findSchemaEntry,
  type GetHistoryBrokerRequest,
  type GetSecretBrokerRequest,
  generateId,
  getDatabase,
  getKeychainProvider,
  getProviderEndpointInfo,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  type ListValuesBrokerRequest,
  ProjectManager,
  ProjectRepository,
  parseEnvSpec,
  type RunBrokerRequest,
  SchemaRepository,
  type ScopeAccessMode,
  ScopePolicyRepository,
  SecretRepository,
  type SensitiveAction,
  serializeEnvSpec,
  triggerAutoBackup,
  upsertSchemaMetadataFromEntry,
  validateValueAgainstSchemaEntry,
} from "../../packages/core/src/index";
import type { SchemaMetadata } from "../../packages/core/src/types/schema";
import type {
  AuditEntryInfo,
  ConfigInfo,
  EnvFileInfo,
  EnvImportResultInfo,
  ProjectInfo,
  ProjectPolicyInfo,
  ProviderDiagnosticsInfo,
  ProviderSessionExpiryResultInfo,
  ProviderSessionInfo,
  RestoredEnvFileInfo,
  SchemaFieldInfo,
  SchemaImportResultInfo,
  ScopeAccessModeOverrideInfo,
  ScopePolicyInfo,
  SecretInfo,
} from "../shared/rpc-schema";

const DESKTOP_PROCESS_NAME = "CloakEnv Desktop";
const DEFAULT_HISTORY_LIMIT = 10;
const MASKED_SECRET_VALUE = "••••••••";

type ProviderClientKind = "adapter" | "cli";

interface ScopePolicySnapshot {
  id: string | null;
  scope: string;
  cliVisibility: ScopeAccessMode;
  adapterVisibility: ScopeAccessMode;
  cliVisibilityOverride: ScopeAccessModeOverrideInfo;
  adapterVisibilityOverride: ScopeAccessModeOverrideInfo;
}

interface ApprovalDialogSpec {
  title: string;
  message: string;
  detail: string;
}

interface ApprovalMetadata {
  requestId: string;
  action: SensitiveAction;
  projectId?: string;
  projectName: string;
  keyName?: string;
  scope?: string;
  workingDir?: string;
  argv?: string[];
  outputPath?: string;
  count?: number;
  limit?: number;
  processName?: string;
  processPid?: number;
  hasTty?: boolean;
}

interface RevealSecretOptions {
  trustedDesktopUI?: boolean;
}

interface VaultHandlerOptions {
  requestNativeApproval: (dialog: ApprovalDialogSpec) => Promise<boolean>;
  getMasterKey?: () => Promise<Buffer>;
  providerMode?: "desktop" | "foreground";
  showNativeNotification?: (notification: {
    title: string;
    body?: string;
    subtitle?: string;
    silent?: boolean;
  }) => void;
}

interface ProviderSessionRecord extends ProviderSessionInfo {
  sessionKey: string;
}

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

// Known .env file patterns to scan for
const ENV_FILE_PATTERNS = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.staging",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
  ".env.example",
];

export function createVaultHandlers(options: VaultHandlerOptions) {
  const db = getDatabase();
  const projectRepo = new ProjectRepository(db);
  const environmentRepo = new EnvironmentRepository(db);
  const auditRepo = new AuditRepository(db);
  const configRepo = new ConfigRepository(db);
  const schemaRepo = new SchemaRepository(db);
  const scopePolicyRepo = new ScopePolicyRepository(db);
  const projectManager = new ProjectManager(db);
  const providerMode = options.providerMode ?? "desktop";
  const providerSessions = new Map<string, ProviderSessionRecord>();

  // Get or create master key
  let masterKeyPromise: Promise<Buffer> | null = null;

  async function getMasterKey(): Promise<Buffer> {
    if (!masterKeyPromise) {
      masterKeyPromise = (async () => {
        if (options.getMasterKey) {
          return options.getMasterKey();
        }

        const authMode = configRepo.get("authMode");
        if (authMode === "passphrase") {
          throw new RequestError(
            "auth_mode_unsupported",
            "Desktop-mediated sensitive access is not available when auth mode is set to passphrase.",
          );
        }

        const keychain = getKeychainProvider();
        const stored = await keychain.retrieve(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

        if (stored) {
          return Buffer.from(stored, "hex");
        }

        // First launch: generate master key
        const { key, salt } = await deriveMasterKey(crypto.randomUUID());
        await keychain.store(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.toString("hex"));

        db.run(
          "INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES ('master_salt', ?, unixepoch())",
          [salt.toString("hex")],
        );

        return key;
      })();
    }
    return masterKeyPromise;
  }

  function _getProjectKey(_project: { salt: Buffer }): Buffer {
    // Note: this is sync because getMasterKey is called during init
    // In practice we cache the master key after first call
    throw new Error("Use getProjectKeyAsync instead");
  }

  async function getProjectKeyAsync(project: { salt: Buffer }): Promise<Buffer> {
    const masterKey = await getMasterKey();
    return deriveProjectKey(masterKey, project.salt);
  }

  function assertBackupPathConfigured(): string {
    const backupPath = configRepo.get("backupPath");
    if (!backupPath) {
      throw new RequestError(
        "backup_path_required",
        "Configure a backup path before modifying the vault.",
      );
    }

    return backupPath;
  }

  async function maybeTriggerAutoBackup(): Promise<void> {
    if (!configRepo.get("autoBackup")) {
      return;
    }

    const masterKey = await getMasterKey();
    const didBackup = await triggerAutoBackup(db, masterKey);
    if (didBackup) {
      options.showNativeNotification?.({
        title: "CloakEnv backup updated",
        body: "Auto-backup wrote a fresh encrypted snapshot.",
        silent: true,
      });
    }
  }

  async function isAutoBackupPassphraseConfigured(): Promise<boolean> {
    const keychain = getKeychainProvider();
    return (await keychain.retrieve(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT)) !== null;
  }

  function pruneExpiredProviderSessions(now = Date.now()): void {
    for (const [sessionKey, session] of providerSessions.entries()) {
      if (session.expiresAt <= now) {
        providerSessions.delete(sessionKey);
      }
    }
  }

  function getProviderSessionDurationMs(): number {
    return Math.max(configRepo.get("providerSessionTtlMinutes"), 0) * 60_000;
  }

  function buildProviderSessionKey(metadata: ApprovalMetadata): string | null {
    if (metadata.action !== "resolve_environment" && metadata.action !== "run") {
      return null;
    }

    if (!metadata.projectId) {
      return null;
    }

    return [
      metadata.action,
      metadata.projectId,
      metadata.scope ?? "default",
      metadata.workingDir ?? "",
      metadata.processName ?? "",
      ...(metadata.argv ?? []),
    ].join("\u001f");
  }

  function createProviderSessionRecord(
    metadata: ApprovalMetadata,
    sessionKey: string,
    now = Date.now(),
  ): ProviderSessionRecord {
    const ttlMs = getProviderSessionDurationMs();
    return {
      id: crypto.randomUUID(),
      sessionKey,
      action: metadata.action === "run" ? "run" : "resolve_environment",
      projectId: metadata.projectId ?? "unknown-project",
      projectName: metadata.projectName,
      scope: metadata.scope ?? "default",
      workingDir: metadata.workingDir ?? "",
      requesterLabel: metadata.processName ?? DESKTOP_PROCESS_NAME,
      commandPreview: formatCommandPreview(metadata.argv ?? []),
      createdAt: now,
      expiresAt: now + ttlMs,
      reuseCount: 0,
    };
  }

  function rememberProviderSession(metadata: ApprovalMetadata): void {
    const sessionKey = buildProviderSessionKey(metadata);
    const ttlMs = getProviderSessionDurationMs();
    if (!sessionKey || ttlMs <= 0) {
      return;
    }

    const now = Date.now();
    pruneExpiredProviderSessions(now);
    providerSessions.set(sessionKey, createProviderSessionRecord(metadata, sessionKey, now));

    if (providerSessions.size <= 64) {
      return;
    }

    const oldest = [...providerSessions.entries()].sort(
      (left, right) => left[1].expiresAt - right[1].expiresAt,
    )[0];
    if (oldest) {
      providerSessions.delete(oldest[0]);
    }
  }

  function reuseProviderSession(metadata: ApprovalMetadata): boolean {
    const ttlMs = getProviderSessionDurationMs();
    const sessionKey = buildProviderSessionKey(metadata);
    if (!sessionKey || ttlMs <= 0) {
      return false;
    }

    const now = Date.now();
    pruneExpiredProviderSessions(now);
    const session = providerSessions.get(sessionKey);
    if (!session) {
      return false;
    }

    providerSessions.set(sessionKey, {
      ...session,
      expiresAt: now + ttlMs,
      reuseCount: session.reuseCount + 1,
    });
    return true;
  }

  function getProviderDiagnosticsSnapshot(): ProviderDiagnosticsInfo {
    const endpointInfo = getProviderEndpointInfo();
    const now = Date.now();
    pruneExpiredProviderSessions(now);
    const activeSessions = [...providerSessions.values()]
      .sort((left, right) => left.expiresAt - right.expiresAt)
      .map<ProviderSessionInfo>((session) => ({
        id: session.id,
        action: session.action,
        projectId: session.projectId,
        projectName: session.projectName,
        scope: session.scope,
        workingDir: session.workingDir,
        requesterLabel: session.requesterLabel,
        commandPreview: session.commandPreview,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        reuseCount: session.reuseCount,
      }));

    const authMode = configRepo.get("authMode");
    return {
      reachable: true,
      mode: providerMode,
      approvalMode: providerMode === "foreground" ? "terminal" : "native",
      endpoint: endpointInfo.endpoint,
      endpointSource: endpointInfo.source,
      transport: endpointInfo.transport,
      authMode,
      desktopSensitiveAvailable: providerMode === "foreground" ? true : authMode === "keychain",
      providerSessionTtlMinutes: configRepo.get("providerSessionTtlMinutes"),
      activeSessionCount: activeSessions.length,
      activeSessions,
    };
  }

  function expireProviderSessionById(sessionId: string): ProviderSessionExpiryResultInfo {
    pruneExpiredProviderSessions();

    let expired = 0;
    for (const [sessionKey, session] of providerSessions.entries()) {
      if (session.id !== sessionId) {
        continue;
      }

      providerSessions.delete(sessionKey);
      expired = 1;
      break;
    }

    return {
      expired,
      remaining: providerSessions.size,
      expiredSessionId: expired > 0 ? sessionId : null,
    };
  }

  function expireAllProviderSessions(): ProviderSessionExpiryResultInfo {
    pruneExpiredProviderSessions();
    const expired = providerSessions.size;
    providerSessions.clear();
    return {
      expired,
      remaining: 0,
      expiredSessionId: null,
    };
  }

  async function getProjectSecretRepo(projectId: string): Promise<{
    project: Awaited<ReturnType<ProjectRepository["getById"]>>;
    secretRepo: SecretRepository;
  }> {
    ensureProjectDefaultScope(projectId);
    const project = projectRepo.getById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const projectKey = await getProjectKeyAsync(project);
    const secretRepo = new SecretRepository(db, projectId, projectKey);
    schemaRepo.migrateLegacyProjectEntries(projectId, secretRepo.list());
    return {
      project,
      secretRepo,
    };
  }

  function mapSchemaField(options: {
    id: string;
    schemaEntryId: string | null;
    secretId: string | null;
    hasStoredSchema: boolean;
    hasStoredValue: boolean;
    key: string;
    scope: string;
    meta: SchemaMetadata | null;
  }): SchemaFieldInfo {
    return {
      id: options.id,
      schemaEntryId: options.schemaEntryId,
      secretId: options.secretId,
      hasStoredSchema: options.hasStoredSchema,
      hasStoredValue: options.hasStoredValue,
      key: options.key,
      scope: options.scope,
      typeName: options.meta?.typeName ?? null,
      typeParams: options.meta?.typeParams ?? null,
      sensitive: options.meta?.sensitive ?? true,
      required: options.meta?.required ?? true,
      description: options.meta?.description ?? null,
      example: options.meta?.example ?? null,
      defaultValue: options.meta?.defaultValue ?? null,
      docsUrls: options.meta?.docsUrls ?? [],
    };
  }

  async function resolveBrokerProject(projectName?: string, cwd?: string) {
    const project = projectManager.resolveOrCreate(projectName, cwd);
    ensureProjectDefaultScope(project.id);
    const stableProject = projectRepo.getById(project.id) ?? project;
    const projectKey = await getProjectKeyAsync(stableProject);
    const secretRepo = new SecretRepository(db, stableProject.id, projectKey);
    schemaRepo.migrateLegacyProjectEntries(stableProject.id, secretRepo.list());
    return {
      project: stableProject,
      secretRepo,
    };
  }

  function ensureProjectDefaultScope(projectId: string, preferredScope?: string): void {
    const project = projectRepo.getById(projectId);
    if (!project) {
      return;
    }

    const environments = environmentRepo.list(projectId);
    if (environments.length === 0) {
      return;
    }

    if (environments.some((environment) => environment.name === project.defaultScope)) {
      return;
    }

    const nextScope =
      preferredScope && environments.some((environment) => environment.name === preferredScope)
        ? preferredScope
        : (environments[0]?.name ?? "default");

    projectRepo.updateScopeDefaults(projectId, {
      defaultScope: nextScope,
      defaultCliVisibility: project.defaultCliVisibility,
      defaultAdapterVisibility: project.defaultAdapterVisibility,
    });
  }

  function buildScopePolicySnapshot(
    project: NonNullable<ReturnType<ProjectRepository["getById"]>>,
    scope: string,
  ): ScopePolicySnapshot {
    const storedPolicy = scopePolicyRepo.getByScope(project.id, scope);
    return {
      id: storedPolicy?.id ?? null,
      scope,
      cliVisibility: storedPolicy?.cliVisibility ?? project.defaultCliVisibility,
      adapterVisibility: storedPolicy?.adapterVisibility ?? project.defaultAdapterVisibility,
      cliVisibilityOverride: storedPolicy?.cliVisibility ?? "inherit",
      adapterVisibilityOverride: storedPolicy?.adapterVisibility ?? "inherit",
    };
  }

  function buildProjectPolicy(projectId: string): ProjectPolicyInfo {
    ensureProjectDefaultScope(projectId);
    const project = projectRepo.getById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const environments = environmentRepo.list(projectId);
    const environmentMap = new Map(
      environments.map((environment) => [environment.name, environment]),
    );
    const scopeNames = new Set<string>([
      project.defaultScope,
      ...environmentMap.keys(),
      ...scopePolicyRepo.listByProject(projectId).map((policy) => policy.scope),
    ]);

    const scopes = Array.from(scopeNames)
      .map((scope): ScopePolicyInfo => {
        const environment = environmentMap.get(scope);
        const snapshot = buildScopePolicySnapshot(project, scope);
        return {
          id: snapshot.id,
          scope,
          sourceFile: environment?.sourceFile ?? null,
          sourceKind: environment?.sourceKind ?? "manual",
          secretCount: environment?.secretCount ?? 0,
          updatedAt: environment?.updatedAt ?? project.updatedAt,
          isDefaultScope: scope === project.defaultScope,
          cliVisibility: snapshot.cliVisibility,
          adapterVisibility: snapshot.adapterVisibility,
          cliVisibilityOverride: snapshot.cliVisibilityOverride,
          adapterVisibilityOverride: snapshot.adapterVisibilityOverride,
          restoreFileName: resolveRestoreFileName(scope, environment?.sourceFile),
        };
      })
      .sort(
        (left, right) =>
          Number(right.isDefaultScope) - Number(left.isDefaultScope) ||
          left.scope.localeCompare(right.scope),
      );

    return {
      projectId: project.id,
      projectName: project.name,
      defaultScope: project.defaultScope,
      defaultCliVisibility: project.defaultCliVisibility,
      defaultAdapterVisibility: project.defaultAdapterVisibility,
      scopes,
    };
  }

  function resolveStoredEnvironmentName(projectId: string, requestedScope: string): string {
    const normalized = normalizeEnvironmentName(requestedScope);
    if (environmentRepo.getByName(projectId, normalized)) {
      return normalized;
    }

    if (normalized === ".env") {
      const legacyDefaultEnvironment = environmentRepo.getByName(projectId, "default");
      if (legacyDefaultEnvironment?.sourceFile?.trim() === ".env") {
        return "default";
      }
    }

    return normalized;
  }

  function resolveRequestedScope(
    project: NonNullable<ReturnType<ProjectRepository["getById"]>>,
    requestedScope?: string,
  ): string {
    return resolveStoredEnvironmentName(
      project.id,
      requestedScope ?? project.defaultScope ?? "default",
    );
  }

  function detectProviderClientKind(requester?: {
    argv: string[];
    processName: string;
    processPid: number;
    hasTty: boolean;
  }): ProviderClientKind {
    const fingerprint = [requester?.processName, ...(requester?.argv ?? [])]
      .join(" ")
      .toLowerCase();
    return fingerprint.includes("cloakenv") ? "cli" : "adapter";
  }

  function assertScopeAccessAllowed(
    project: NonNullable<ReturnType<ProjectRepository["getById"]>>,
    scope: string,
    requester?: {
      argv: string[];
      processName: string;
      processPid: number;
      hasTty: boolean;
    },
  ): ScopePolicySnapshot {
    const snapshot = buildScopePolicySnapshot(project, scope);
    const clientKind = detectProviderClientKind(requester);
    const visibility = clientKind === "cli" ? snapshot.cliVisibility : snapshot.adapterVisibility;

    if (visibility === "deny") {
      throw new RequestError(
        "scope_blocked",
        `Scope "${scope}" is blocked for ${
          clientKind === "cli" ? "CloakEnv CLI" : "external adapter"
        } requests in project "${project.name}". Update the scope policy or request another scope.`,
      );
    }

    return snapshot;
  }

  function buildRestorePlan(
    projectId: string,
    destinationFolder: string,
    secrets: Array<{ key: string; value: string; scope: string }>,
  ): RestoredEnvFileInfo[] {
    const environmentMap = new Map(
      environmentRepo.list(projectId).map((environment) => [environment.name, environment]),
    );
    const grouped = new Map<string, Array<(typeof secrets)[number]>>();

    for (const secret of secrets) {
      const bucket = grouped.get(secret.scope) ?? [];
      bucket.push(secret);
      grouped.set(secret.scope, bucket);
    }

    const usedFileNames = new Set<string>();
    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scope]) => {
        const environment = environmentMap.get(scope);
        const fileName = resolveRestoreFileName(scope, environment?.sourceFile);
        if (usedFileNames.has(fileName)) {
          throw new RequestError(
            "restore_conflict",
            `Multiple scopes in this project resolve to the same restore file "${fileName}". Update the environment metadata before restoring plaintext files.`,
          );
        }
        usedFileNames.add(fileName);

        return {
          scope,
          fileName,
          path: join(destinationFolder, fileName),
          sourceFile: environment?.sourceFile ?? null,
          sourceKind: environment?.sourceKind ?? "manual",
        };
      });
  }

  function buildProjectSchemaFields(
    projectId: string,
    secrets: Array<{ id: string; key: string; scope: string }>,
  ): SchemaFieldInfo[] {
    const schemaEntries = schemaRepo.listByProject(projectId);
    const secretMap = new Map(secrets.map((secret) => [`${secret.scope}:${secret.key}`, secret]));
    const combined = new Map<string, SchemaFieldInfo>();

    for (const schemaEntry of schemaEntries) {
      const match = secretMap.get(`${schemaEntry.scope}:${schemaEntry.key}`) ?? null;
      combined.set(
        `${schemaEntry.scope}:${schemaEntry.key}`,
        mapSchemaField({
          id: schemaEntry.id,
          schemaEntryId: schemaEntry.id,
          secretId: match?.id ?? null,
          hasStoredSchema: true,
          hasStoredValue: match !== null,
          key: schemaEntry.key,
          scope: schemaEntry.scope,
          meta: schemaEntry,
        }),
      );
    }

    for (const secret of secrets) {
      const mapKey = `${secret.scope}:${secret.key}`;
      if (combined.has(mapKey)) {
        continue;
      }

      combined.set(
        mapKey,
        mapSchemaField({
          id: secret.id,
          schemaEntryId: null,
          secretId: secret.id,
          hasStoredSchema: false,
          hasStoredValue: true,
          key: secret.key,
          scope: secret.scope,
          meta: null,
        }),
      );
    }

    return Array.from(combined.values()).sort(
      (left, right) => left.scope.localeCompare(right.scope) || left.key.localeCompare(right.key),
    );
  }

  function logSensitiveAudit(
    action:
      | "approval_request"
      | "approval_grant"
      | "approval_deny"
      | "approval_reuse"
      | "read"
      | "resolve"
      | "run"
      | "export",
    metadata: ApprovalMetadata,
  ) {
    auditRepo.log({
      requestId: metadata.requestId,
      projectId: metadata.projectId,
      action,
      keyName:
        metadata.keyName ??
        (typeof metadata.count === "number" ? `[${metadata.count} secrets]` : null) ??
        null,
      scope: metadata.scope ?? null,
      processName: metadata.processName ?? DESKTOP_PROCESS_NAME,
      processPid: metadata.processPid ?? process.pid,
      workingDir: metadata.workingDir ?? null,
      hasTty: metadata.hasTty ?? null,
      argv: metadata.argv ?? null,
      outputPath: metadata.outputPath ?? null,
      decision:
        action === "approval_request"
          ? "pending"
          : action === "approval_deny"
            ? "denied"
            : "approved",
    });
  }

  async function requestSensitiveApproval(metadata: ApprovalMetadata): Promise<boolean> {
    if (reuseProviderSession(metadata)) {
      logSensitiveAudit("approval_reuse", metadata);
      return true;
    }

    logSensitiveAudit("approval_request", metadata);

    const approved = await options.requestNativeApproval(buildApprovalDialog(metadata));

    logSensitiveAudit(approved ? "approval_grant" : "approval_deny", metadata);
    if (approved) {
      rememberProviderSession(metadata);
    }
    return approved;
  }

  return {
    // ── Projects ──────────────────────────────────────────────
    listProjects(): ProjectInfo[] {
      const projects = projectRepo.list();
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        secretCount: projectRepo.getSecretCount(p.id),
        updatedAt: p.updatedAt,
      }));
    },

    async createProject(name: string, path?: string): Promise<ProjectInfo> {
      const project = projectRepo.create(name, path);
      await maybeTriggerAutoBackup();
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        secretCount: 0,
        updatedAt: project.updatedAt,
      };
    },

    async removeProject(projectId: string): Promise<void> {
      // Destructive removals must remain available even if backup settings are incomplete.
      projectRepo.remove(projectId);
      await maybeTriggerAutoBackup();
    },

    async renameProject(projectId: string, newName: string): Promise<void> {
      projectRepo.rename(projectId, newName);
      await maybeTriggerAutoBackup();
    },

    // ── Secrets ───────────────────────────────────────────────
    async getSecrets(projectId: string, environment?: string): Promise<SecretInfo[]> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      if (!project) return [];

      const secrets = secretRepo
        .list()
        .filter((secret) => (environment ? secret.scope === environment : true));

      return secrets.map((s) => {
        const meta = schemaRepo.getByKey(project.id, s.key, s.scope);
        return {
          id: s.id,
          key: s.key,
          value: null,
          maskedValue: MASKED_SECRET_VALUE,
          scope: s.scope,
          version: s.version,
          sensitive: meta?.sensitive ?? true,
          updatedAt: s.updatedAt,
        };
      });
    },

    listEnvironments(projectId: string): Array<{
      id: string;
      name: string;
      sourceFile: string | null;
      sourceKind: "imported" | "manual";
      secretCount: number;
      updatedAt: number;
    }> {
      return environmentRepo.list(projectId).map((env) => ({
        id: env.id,
        name: env.name,
        sourceFile: env.sourceFile,
        sourceKind: env.sourceKind,
        secretCount: env.secretCount,
        updatedAt: env.updatedAt,
      }));
    },

    async createEnvironment(projectId: string, name: string) {
      const project = projectRepo.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const environment = environmentRepo.create(
        projectId,
        normalizeEnvironmentName(name),
        "manual",
      );
      const result = {
        id: environment.id,
        name: environment.name,
        sourceFile: environment.sourceFile,
        sourceKind: environment.sourceKind,
        secretCount: 0,
        updatedAt: environment.updatedAt,
      };
      ensureProjectDefaultScope(projectId, environment.name);
      await maybeTriggerAutoBackup();
      return result;
    },

    async removeEnvironment(projectId: string, environmentId: string): Promise<void> {
      const project = projectRepo.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const environment = environmentRepo.remove(projectId, environmentId);
      if (!environment) return;

      scopePolicyRepo.save(projectId, environment.name, {
        cliVisibility: null,
        adapterVisibility: null,
      });
      ensureProjectDefaultScope(projectId);

      auditRepo.log({
        projectId,
        action: "delete",
        keyName: `[environment] ${environment.name}`,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });
      await maybeTriggerAutoBackup();
    },

    async setSecret(
      projectId: string,
      key: string,
      value: string,
      scope?: string,
    ): Promise<SecretInfo> {
      const project = projectRepo.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const projectKey = await getProjectKeyAsync(project);
      const secretRepo = new SecretRepository(db, projectId, projectKey);
      const environmentName = resolveStoredEnvironmentName(
        projectId,
        scope ?? project.defaultScope,
      );
      environmentRepo.create(projectId, environmentName, "manual");

      const existing = secretRepo.getByKey(key, environmentName);
      const result = existing
        ? secretRepo.update(key, value, environmentName)!
        : secretRepo.create(key, value, environmentName);
      ensureProjectDefaultScope(projectId, environmentName);

      auditRepo.log({
        projectId,
        action: "write",
        keyName: key,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      const schemaEntry = schemaRepo.getByKey(projectId, result.key, result.scope);
      const payload = {
        id: result.id,
        key: result.key,
        value: null,
        maskedValue: MASKED_SECRET_VALUE,
        scope: result.scope,
        version: result.version,
        sensitive: schemaEntry?.sensitive ?? true,
        updatedAt: result.updatedAt,
      };
      await maybeTriggerAutoBackup();
      return payload;
    },

    async revealSecret(
      projectId: string,
      secretId: string,
      options?: RevealSecretOptions,
    ): Promise<{ value: string }> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      const secret = secretRepo.getById(secretId);
      if (!secret) {
        throw new Error(`Secret ${secretId} not found`);
      }

      const requestId = generateId();
      if (!options?.trustedDesktopUI) {
        const approved = await requestSensitiveApproval({
          requestId,
          action: "get",
          projectId,
          projectName: project.name,
          keyName: secret.key,
          scope: secret.scope,
          processName: DESKTOP_PROCESS_NAME,
          processPid: process.pid,
          hasTty: false,
        });

        if (!approved) {
          throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
        }
      }

      logSensitiveAudit("read", {
        requestId,
        action: "get",
        projectId,
        projectName: project.name,
        keyName: secret.key,
        scope: secret.scope,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      return { value: secret.value };
    },

    async removeSecret(projectId: string, secretId: string): Promise<void> {
      const project = projectRepo.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const projectKey = await getProjectKeyAsync(project);
      const secretRepo = new SecretRepository(db, projectId, projectKey);
      const existing = secretRepo.getById(secretId);
      if (!existing) return;

      secretRepo.removeById(secretId);

      auditRepo.log({
        projectId,
        action: "delete",
        keyName: `${existing.key} [${existing.scope}]`,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });
      await maybeTriggerAutoBackup();
    },

    async getSecretHistory(
      projectId: string,
      secretId: string,
    ): Promise<Array<{ value: string; version: number; createdAt: number }>> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      const secret = secretRepo.getById(secretId);
      if (!secret) return [];

      const requestId = generateId();
      const approved = await requestSensitiveApproval({
        requestId,
        action: "history",
        projectId,
        projectName: project.name,
        keyName: secret.key,
        scope: secret.scope,
        limit: DEFAULT_HISTORY_LIMIT,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      logSensitiveAudit("read", {
        requestId,
        action: "history",
        projectId,
        projectName: project.name,
        keyName: secret.key,
        scope: secret.scope,
        limit: DEFAULT_HISTORY_LIMIT,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      return secretRepo.getHistoryById(secretId, DEFAULT_HISTORY_LIMIT);
    },

    async getProjectSchema(projectId: string): Promise<SchemaFieldInfo[]> {
      const { secretRepo } = await getProjectSecretRepo(projectId);
      return buildProjectSchemaFields(projectId, secretRepo.list());
    },

    async getProjectPolicy(projectId: string): Promise<ProjectPolicyInfo> {
      return buildProjectPolicy(projectId);
    },

    async createProjectSchemaEntry(
      projectId: string,
      params: {
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
      },
    ): Promise<SchemaFieldInfo> {
      const { secretRepo } = await getProjectSecretRepo(projectId);
      const scope = normalizeEnvironmentName(params.scope);
      environmentRepo.create(projectId, scope, "manual");
      ensureProjectDefaultScope(projectId, scope);
      const meta = schemaRepo.upsert(projectId, params.key, scope, {
        typeName: params.typeName,
        typeParams: params.typeParams,
        sensitive: params.sensitive,
        required: params.required,
        description: params.description,
        example: params.example,
        defaultValue: params.defaultValue,
        docsUrls: params.docsUrls,
      });

      await maybeTriggerAutoBackup();
      const secret = secretRepo.getByKey(params.key, scope);
      return mapSchemaField({
        id: meta.id,
        schemaEntryId: meta.id,
        secretId: secret?.id ?? null,
        hasStoredSchema: true,
        hasStoredValue: Boolean(secret),
        key: meta.key,
        scope: meta.scope,
        meta,
      });
    },

    async updateProjectSchemaEntry(
      projectId: string,
      params: {
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
      },
    ): Promise<SchemaFieldInfo> {
      const { secretRepo } = await getProjectSecretRepo(projectId);
      const scope = normalizeEnvironmentName(params.scope);
      environmentRepo.create(projectId, scope, "manual");
      ensureProjectDefaultScope(projectId, scope);
      const meta = schemaRepo.update(params.id, {
        key: params.key,
        scope,
        typeName: params.typeName,
        typeParams: params.typeParams,
        sensitive: params.sensitive,
        required: params.required,
        description: params.description,
        example: params.example,
        defaultValue: params.defaultValue,
        docsUrls: params.docsUrls,
      });

      await maybeTriggerAutoBackup();
      const secret = secretRepo.getByKey(meta.key, meta.scope);
      return mapSchemaField({
        id: meta.id,
        schemaEntryId: meta.id,
        secretId: secret?.id ?? null,
        hasStoredSchema: true,
        hasStoredValue: Boolean(secret),
        key: meta.key,
        scope: meta.scope,
        meta,
      });
    },

    async removeProjectSchemaEntry(projectId: string, schemaEntryId: string): Promise<void> {
      const { secretRepo } = await getProjectSecretRepo(projectId);
      const entry = schemaRepo.getById(schemaEntryId);
      if (!entry || entry.projectId !== projectId) {
        return;
      }

      schemaRepo.remove(schemaEntryId);

      const linkedSecret = secretRepo.getByKey(entry.key, entry.scope);
      auditRepo.log({
        projectId,
        action: "delete",
        keyName: linkedSecret
          ? `[schema] ${entry.key} [${entry.scope}]`
          : `[schema-only] ${entry.key} [${entry.scope}]`,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      await maybeTriggerAutoBackup();
    },

    async updateProjectPolicyDefaults(
      projectId: string,
      params: {
        defaultScope: string;
        defaultCliVisibility: ScopeAccessMode;
        defaultAdapterVisibility: ScopeAccessMode;
      },
    ): Promise<ProjectPolicyInfo> {
      const project = projectRepo.getById(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const defaultScope = normalizeEnvironmentName(params.defaultScope);
      environmentRepo.create(projectId, defaultScope, "manual");
      projectRepo.updateScopeDefaults(projectId, {
        defaultScope,
        defaultCliVisibility: params.defaultCliVisibility,
        defaultAdapterVisibility: params.defaultAdapterVisibility,
      });

      await maybeTriggerAutoBackup();
      return buildProjectPolicy(projectId);
    },

    async updateScopePolicy(
      projectId: string,
      params: {
        scope: string;
        cliVisibilityOverride: ScopeAccessModeOverrideInfo;
        adapterVisibilityOverride: ScopeAccessModeOverrideInfo;
      },
    ): Promise<ProjectPolicyInfo> {
      const project = projectRepo.getById(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const scope = normalizeEnvironmentName(params.scope);
      environmentRepo.create(projectId, scope, "manual");
      ensureProjectDefaultScope(projectId, scope);
      scopePolicyRepo.save(projectId, scope, {
        cliVisibility: normalizeScopeAccessOverride(params.cliVisibilityOverride),
        adapterVisibility: normalizeScopeAccessOverride(params.adapterVisibilityOverride),
      });

      await maybeTriggerAutoBackup();
      return buildProjectPolicy(projectId);
    },

    async exportProjectSchema(projectId: string): Promise<{ path: string; entries: number }> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      if (!project.path) {
        throw new Error("This project is not associated with a folder path.");
      }

      const secrets = secretRepo.getAllDecrypted();
      const fields = buildProjectSchemaFields(projectId, secretRepo.list());
      const secretValueMap = new Map(
        secrets.map((secret) => [`${secret.scope}:${secret.key}`, secret.value]),
      );
      const entries = fields.map((field) => ({
        key: field.key,
        defaultValue:
          field.defaultValue ??
          (field.sensitive === false
            ? (secretValueMap.get(`${field.scope}:${field.key}`) ?? null)
            : null),
        sensitive: field.sensitive,
        schema: field.hasStoredSchema ? schemaRepo.getById(field.schemaEntryId ?? field.id) : null,
      }));

      const outputPath = join(project.path, ".env.schema");
      const content = serializeEnvSpec(entries, { defaultSensitive: true });
      writeFileSync(outputPath, content, "utf8");

      return { path: outputPath, entries: entries.length };
    },

    async importProjectSchema(
      projectId: string,
      filePath?: string,
    ): Promise<SchemaImportResultInfo> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      const resolvedPath = resolveSchemaImportPath(project.path, filePath);
      const spec = parseEnvSpec(readFileSync(resolvedPath, "utf8"));
      const scope = normalizeEnvironmentName(spec.rootDecorators.currentEnv ?? "default");

      environmentRepo.create(projectId, scope, "manual");
      ensureProjectDefaultScope(projectId, scope);

      const result = await bootstrapSecretsFromSchema({
        projectId,
        spec,
        secretRepo,
        schemaRepo,
        scope,
      });

      auditRepo.log({
        projectId,
        action: "import",
        keyName: `[schema] ${basename(resolvedPath)} [${scope}]`,
        scope,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      if (result.metadataApplied > 0 || result.created > 0) {
        await maybeTriggerAutoBackup();
      }

      options.showNativeNotification?.({
        title: "Schema import complete",
        body: `Imported ${result.metadataApplied} schema entr${
          result.metadataApplied === 1 ? "y" : "ies"
        } from ${basename(resolvedPath)}`,
        subtitle: project.name,
        silent: result.warnings.length === 0,
      });

      return {
        path: resolvedPath,
        scope,
        metadataApplied: result.metadataApplied,
        created: result.created,
        skipped: result.skipped,
        warnings: result.warnings,
      };
    },

    // ── File System ───────────────────────────────────────────
    scanEnvFiles(folderPath: string): EnvFileInfo[] {
      const results: EnvFileInfo[] = [];

      if (!existsSync(folderPath)) return results;

      const files = readdirSync(folderPath);

      for (const fileName of files) {
        // Match .env patterns
        const isEnvFile =
          ENV_FILE_PATTERNS.includes(fileName) ||
          (fileName.startsWith(".env") &&
            !fileName.endsWith(".schema") &&
            !fileName.endsWith(".cloaked"));

        if (!isEnvFile) continue;

        const filePath = join(folderPath, fileName);
        try {
          const content = readFileSync(filePath, "utf-8");
          const entries = parseEnvFileContent(content);
          if (entries.length > 0) {
            results.push({
              fileName,
              filePath,
              environmentName: deriveEnvironmentName(fileName),
              entries,
            });
          }
        } catch {
          // Skip files we can't read
        }
      }

      return results;
    },

    async importEnvFile(projectId: string, filePath: string): Promise<EnvImportResultInfo> {
      const project = projectRepo.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const content = readFileSync(filePath, "utf-8");
      const entries = parseEnvFileContent(content);
      const environmentName = deriveEnvironmentName(basename(filePath));
      const schemaPath = join(project.path ?? "", ".env.schema");
      const schemaSpec =
        project.path && existsSync(schemaPath)
          ? parseEnvSpec(readFileSync(schemaPath, "utf8"))
          : null;

      const projectKey = await getProjectKeyAsync(project);
      const secretRepo = new SecretRepository(db, projectId, projectKey);
      environmentRepo.create(projectId, environmentName, "imported", basename(filePath));
      ensureProjectDefaultScope(projectId, environmentName);

      let imported = 0;
      let schemaMatched = 0;
      const warnings: Array<{ key: string; scope: string; message: string }> = [];
      for (const { key, value } of entries) {
        const existing = secretRepo.getByKey(key, environmentName);
        const result = existing
          ? secretRepo.update(key, value, environmentName)
          : secretRepo.create(key, value, environmentName);

        if (result && schemaSpec) {
          const schemaEntry = findSchemaEntry(schemaSpec, key);
          if (schemaEntry) {
            upsertSchemaMetadataFromEntry(schemaRepo, projectId, environmentName, schemaEntry);
            schemaMatched += 1;

            const validation = validateValueAgainstSchemaEntry(value, schemaEntry);
            if (!validation.valid) {
              warnings.push({
                key,
                scope: environmentName,
                message: validation.message ?? "Imported value does not satisfy schema validation.",
              });
            }
          }
        }
        imported++;
      }

      auditRepo.log({
        projectId,
        action: "import",
        keyName: `[${imported} secrets from ${basename(filePath)}]`,
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      await maybeTriggerAutoBackup();
      options.showNativeNotification?.({
        title: "Environment import complete",
        body: `Imported ${imported} secret${imported === 1 ? "" : "s"} from ${basename(filePath)}`,
        subtitle: project.name,
      });
      return { imported, schemaMatched, warnings };
    },

    // ── Backup ────────────────────────────────────────────────
    async exportVault(
      projectId: string | undefined,
      passphrase: string,
    ): Promise<{ path: string }> {
      const backupPath = assertBackupPathConfigured();
      const outputPath = join(backupPath, DEFAULT_CLOAKED_BACKUP_FILENAME);
      const project = projectId ? projectRepo.getById(projectId) : null;
      const requestId = generateId();
      const approved = await requestSensitiveApproval({
        requestId,
        action: "export",
        projectId: project?.id,
        projectName: project?.name ?? "All projects",
        outputPath,
        keyName: project?.name ?? "[full vault]",
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      const masterKey = await getMasterKey();

      await coreExportVault({
        db,
        masterKey,
        passphrase,
        projectName: project?.name,
        outputPath,
      });

      logSensitiveAudit("export", {
        requestId,
        action: "export",
        projectId: project?.id,
        projectName: project?.name ?? "All projects",
        outputPath,
        keyName: project?.name ?? "[full vault]",
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      options.showNativeNotification?.({
        title: "Encrypted export complete",
        body: outputPath,
        subtitle: project?.name ?? "All projects",
      });

      return { path: outputPath };
    },

    async restorePlainEnv(
      projectId: string,
      destinationFolder?: string,
    ): Promise<{ destinationFolder: string; files: RestoredEnvFileInfo[] }> {
      const { project, secretRepo } = await getProjectSecretRepo(projectId);
      const secrets = secretRepo.getAllDecrypted();

      if (secrets.length === 0) {
        throw new RequestError("no_secrets", `No secrets found in project "${project.name}".`);
      }

      const resolvedDestinationFolder = destinationFolder ?? project.path;
      if (!resolvedDestinationFolder) {
        throw new RequestError(
          "destination_required",
          "Choose a destination folder before restoring plaintext env files for this project.",
        );
      }

      const requestId = generateId();
      const approved = await requestSensitiveApproval({
        requestId,
        action: "export_plaintext",
        projectId: project.id,
        projectName: project.name,
        outputPath: resolvedDestinationFolder,
        count: secrets.length,
        keyName: "[plaintext env files]",
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      mkdirSync(resolvedDestinationFolder, { recursive: true });
      const files = buildRestorePlan(project.id, resolvedDestinationFolder, secrets);
      const secretsByScope = new Map<string, Array<(typeof secrets)[number]>>();
      for (const secret of secrets) {
        const bucket = secretsByScope.get(secret.scope) ?? [];
        bucket.push(secret);
        secretsByScope.set(secret.scope, bucket);
      }

      for (const file of files) {
        const scopedSecrets = secretsByScope.get(file.scope) ?? [];
        const content = `${scopedSecrets
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((secret) => `${secret.key}=${serializeEnvValue(secret.value)}`)
          .join("\n")}\n`;

        writeFileSync(file.path, content, "utf8");
      }

      logSensitiveAudit("export", {
        requestId,
        action: "export_plaintext",
        projectId: project.id,
        projectName: project.name,
        outputPath: resolvedDestinationFolder,
        count: secrets.length,
        keyName: "[plaintext env files]",
        processName: DESKTOP_PROCESS_NAME,
        processPid: process.pid,
        hasTty: false,
      });

      options.showNativeNotification?.({
        title: "Plaintext env restore complete",
        body: `Wrote ${files.length} file${files.length === 1 ? "" : "s"} to ${resolvedDestinationFolder}`,
        subtitle: project.name,
      });

      return {
        destinationFolder: resolvedDestinationFolder,
        files,
      };
    },

    async brokerGetSecret(
      request: GetSecretBrokerRequest,
    ): Promise<{ projectName: string; value: string }> {
      const { project, secretRepo } = await resolveBrokerProject(request.projectName, request.cwd);
      const scope = resolveRequestedScope(project, request.scope);
      assertScopeAccessAllowed(project, scope, request.requester);
      const secret = secretRepo.getByKey(request.key, scope);
      const approved = await requestSensitiveApproval({
        requestId: request.requestId,
        action: "get",
        projectId: project.id,
        projectName: project.name,
        keyName: request.key,
        scope,
        workingDir: request.cwd,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }
      if (!secret) {
        throw new RequestError(
          "secret_not_found",
          `Secret "${request.key}"${scope !== "default" ? ` [${scope}]` : ""} not found in project "${project.name}".`,
        );
      }

      logSensitiveAudit("read", {
        requestId: request.requestId,
        action: "get",
        projectId: project.id,
        projectName: project.name,
        keyName: request.key,
        scope,
        workingDir: request.cwd,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      return { projectName: project.name, value: secret.value };
    },

    async brokerGetHistory(request: GetHistoryBrokerRequest): Promise<{
      projectName: string;
      entries: Array<{ value: string; version: number; createdAt: number }>;
    }> {
      const { project, secretRepo } = await resolveBrokerProject(request.projectName, request.cwd);
      const scope = resolveRequestedScope(project, request.scope);
      assertScopeAccessAllowed(project, scope, request.requester);
      const approved = await requestSensitiveApproval({
        requestId: request.requestId,
        action: "history",
        projectId: project.id,
        projectName: project.name,
        keyName: request.key,
        scope,
        workingDir: request.cwd,
        limit: request.limit,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      const entries = secretRepo.getHistory(request.key, scope, request.limit);

      logSensitiveAudit("read", {
        requestId: request.requestId,
        action: "history",
        projectId: project.id,
        projectName: project.name,
        keyName: request.key,
        scope,
        workingDir: request.cwd,
        limit: request.limit,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      return { projectName: project.name, entries };
    },

    async brokerListValues(request: ListValuesBrokerRequest): Promise<{
      projectName: string;
      secrets: Array<{ key: string; value: string; scope: string }>;
    }> {
      const { project, secretRepo } = await resolveBrokerProject(request.projectName, request.cwd);
      const scope = resolveRequestedScope(project, request.scope);
      assertScopeAccessAllowed(project, scope, request.requester);
      const secrets = secretRepo.getAllDecrypted(scope);
      const approved = await requestSensitiveApproval({
        requestId: request.requestId,
        action: "list_values",
        projectId: project.id,
        projectName: project.name,
        scope,
        workingDir: request.cwd,
        count: secrets.length,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      logSensitiveAudit("read", {
        requestId: request.requestId,
        action: "list_values",
        projectId: project.id,
        projectName: project.name,
        scope,
        workingDir: request.cwd,
        count: secrets.length,
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      return {
        projectName: project.name,
        secrets: secrets.map((secret) => ({
          key: secret.key,
          value: secret.value,
          scope: secret.scope,
        })),
      };
    },

    async resolveProviderEnvironment(request: {
      requestId: string;
      kind: "resolve_environment" | "run_process" | "run";
      projectName?: string;
      cwd: string;
      requester?: { argv: string[]; processName: string; processPid: number; hasTty: boolean };
      scope?: string;
      argv?: string[];
    }): Promise<{
      projectId: string;
      projectName: string;
      env: Record<string, string>;
    }> {
      const { project, secretRepo } = await resolveBrokerProject(request.projectName, request.cwd);
      const scope = resolveRequestedScope(project, request.scope);
      assertScopeAccessAllowed(project, scope, request.requester);
      const secrets = secretRepo.getAllDecrypted(scope);
      if (secrets.length === 0) {
        throw new RequestError("no_secrets", `No secrets found for scope "${scope}".`);
      }

      const approved = await requestSensitiveApproval({
        requestId: request.requestId,
        action: request.kind === "resolve_environment" ? "resolve_environment" : "run",
        projectId: project.id,
        projectName: project.name,
        scope,
        workingDir: request.cwd,
        argv: request.kind === "resolve_environment" ? request.requester?.argv : request.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
        count: secrets.length,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      if (request.kind === "resolve_environment") {
        logSensitiveAudit("resolve", {
          requestId: request.requestId,
          action: "resolve_environment",
          projectId: project.id,
          projectName: project.name,
          scope,
          workingDir: request.cwd,
          argv: request.requester?.argv,
          processName: request.requester?.processName,
          processPid: request.requester?.processPid,
          hasTty: request.requester?.hasTty,
          count: secrets.length,
        });
      }

      return {
        projectId: project.id,
        projectName: project.name,
        env: Object.fromEntries(secrets.map((secret) => [secret.key, secret.value])),
      };
    },

    async brokerPrepareRun(request: RunBrokerRequest): Promise<{
      projectId: string;
      projectName: string;
      env: Record<string, string>;
    }> {
      return this.resolveProviderEnvironment({
        ...request,
        kind: "run",
        argv: request.argv,
      });
    },

    logProviderRun(metadata: {
      requestId: string;
      projectId: string;
      projectName: string;
      scope?: string;
      cwd: string;
      argv: string[];
      processName?: string;
      processPid?: number;
      hasTty?: boolean;
    }): void {
      logSensitiveAudit("run", {
        requestId: metadata.requestId,
        action: "run",
        projectId: metadata.projectId,
        projectName: metadata.projectName,
        scope: metadata.scope,
        workingDir: metadata.cwd,
        argv: metadata.argv,
        processName: metadata.processName,
        processPid: metadata.processPid,
        hasTty: metadata.hasTty,
      });
    },

    async brokerExport(request: {
      requestId: string;
      projectName?: string;
      cwd: string;
      outputPath: string;
      passphrase: string;
    }): Promise<{ path: string }> {
      const project = request.projectName
        ? projectManager.resolve(request.projectName, request.cwd)
        : null;
      const approved = await requestSensitiveApproval({
        requestId: request.requestId,
        action: "export",
        projectId: project?.id,
        projectName: project?.name ?? "All projects",
        workingDir: request.cwd,
        outputPath: request.outputPath,
        keyName: project?.name ?? "[full vault]",
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      if (!approved) {
        throw new RequestError("approval_denied", "Request denied in CloakEnv desktop.");
      }

      const masterKey = await getMasterKey();
      await coreExportVault({
        db,
        masterKey,
        passphrase: request.passphrase,
        projectName: request.projectName,
        outputPath: request.outputPath,
      });

      logSensitiveAudit("export", {
        requestId: request.requestId,
        action: "export",
        projectId: project?.id,
        projectName: project?.name ?? "All projects",
        workingDir: request.cwd,
        outputPath: request.outputPath,
        keyName: project?.name ?? "[full vault]",
        argv: request.requester?.argv,
        processName: request.requester?.processName,
        processPid: request.requester?.processPid,
        hasTty: request.requester?.hasTty,
      });

      options.showNativeNotification?.({
        title: "Encrypted export complete",
        body: request.outputPath,
        subtitle: project?.name ?? "All projects",
      });

      return { path: request.outputPath };
    },

    async importCloaked(
      filePath: string,
      passphrase: string,
    ): Promise<{ projectsImported: number; secretsImported: number }> {
      const masterKey = await getMasterKey();
      const result = await coreImportVault({
        db,
        masterKey,
        filePath,
        passphrase,
      });
      for (const project of projectRepo.list()) {
        ensureProjectDefaultScope(project.id);
      }
      await maybeTriggerAutoBackup();
      options.showNativeNotification?.({
        title: "Encrypted import complete",
        body: `Imported ${result.secretsImported} secret${result.secretsImported === 1 ? "" : "s"}`,
        subtitle: `${result.projectsImported} project${result.projectsImported === 1 ? "" : "s"}`,
      });
      return result;
    },

    // ── Audit ─────────────────────────────────────────────────
    getAuditLog(projectId?: string, limit?: number): AuditEntryInfo[] {
      const entries = auditRepo.query({
        projectId,
        limit: limit ?? 50,
      });

      return entries.map((e) => ({
        id: e.id,
        requestId: e.requestId,
        projectId: e.projectId,
        action: e.action,
        keyName: e.keyName,
        scope: e.scope,
        processName: e.processName,
        processPid: e.processPid,
        workingDir: e.workingDir,
        hasTty: e.hasTty,
        argv: e.argv,
        outputPath: e.outputPath,
        decision: e.decision,
        timestamp: e.timestamp,
      }));
    },

    // ── Config ────────────────────────────────────────────────
    async getConfig(): Promise<ConfigInfo> {
      return {
        ...configRepo.getAll(),
        autoBackupPassphraseConfigured: await isAutoBackupPassphraseConfigured(),
      };
    },

    getProviderDiagnostics(): ProviderDiagnosticsInfo {
      return getProviderDiagnosticsSnapshot();
    },

    expireProviderSession(options?: {
      sessionId?: string;
      all?: boolean;
    }): ProviderSessionExpiryResultInfo {
      if (options?.all) {
        return expireAllProviderSessions();
      }

      if (!options?.sessionId?.trim()) {
        throw new RequestError(
          "invalid_request",
          "Provide a session id or pass all=true to expire provider sessions.",
        );
      }

      return expireProviderSessionById(options.sessionId.trim());
    },

    setConfig(key: string, value: string): void {
      if (key === "backupPath") configRepo.set("backupPath", value);
      else if (key === "authMode") configRepo.set("authMode", value as "keychain" | "passphrase");
      else if (key === "autoBackup") configRepo.set("autoBackup", value === "true");
      else if (key === "onboardingCompleted") {
        configRepo.set("onboardingCompleted", value === "true");
      } else if (key === "launchAtLogin") {
        configRepo.set("launchAtLogin", value === "true");
      } else if (key === "providerSessionTtlMinutes") {
        const parsed = Number.parseInt(value, 10);
        const nextTtlMinutes = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
        configRepo.set("providerSessionTtlMinutes", nextTtlMinutes);
        if (nextTtlMinutes === 0) {
          providerSessions.clear();
        } else {
          pruneExpiredProviderSessions();
        }
      } else if (key === "desktopAppearance") {
        const nextAppearance =
          value === "dock_only" || value === "menu_only" ? value : "dock_and_menu";
        configRepo.set("desktopAppearance", nextAppearance);
      }
    },

    async setAutoBackupPassphrase(passphrase: string): Promise<void> {
      const strength = evaluatePassphrase(passphrase);
      if (!strength.isAcceptable) {
        throw new RequestError(
          "weak_passphrase",
          `Passphrase too weak (score: ${strength.score}/4, required: 4/4).`,
        );
      }

      const keychain = getKeychainProvider();
      await keychain.store(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT, passphrase);
    },
  };
}

function buildApprovalDialog(metadata: ApprovalMetadata): ApprovalDialogSpec {
  switch (metadata.action) {
    case "get":
      return {
        title: "Approve secret read",
        message: `Reveal "${metadata.keyName}" from "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Scope: ${metadata.scope ?? "default"}`,
          `Key: ${metadata.keyName ?? "Unknown"}`,
        ].join("\n"),
      };
    case "history":
      return {
        title: "Approve secret history read",
        message: `Reveal history for "${metadata.keyName}" from "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Scope: ${metadata.scope ?? "default"}`,
          `Key: ${metadata.keyName ?? "Unknown"}`,
          `Max entries: ${metadata.limit ?? DEFAULT_HISTORY_LIMIT}`,
        ].join("\n"),
      };
    case "list_values":
      return {
        title: "Approve plaintext list",
        message: `Reveal plaintext secrets from "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Scope: ${metadata.scope ?? "default"}`,
          `Secret count: ${metadata.count ?? 0}`,
        ].join("\n"),
      };
    case "run":
      return {
        title: "Approve command run",
        message: `Run a command with secrets from "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Scope: ${metadata.scope ?? "default"}`,
          `Working directory: ${metadata.workingDir ?? "Unknown"}`,
          `Command: ${formatCommandPreview(metadata.argv ?? [])}`,
        ].join("\n"),
      };
    case "resolve_environment":
      return {
        title: "Approve environment resolution",
        message: `Resolve plaintext environment values from "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Scope: ${metadata.scope ?? "default"}`,
          `Working directory: ${metadata.workingDir ?? "Unknown"}`,
          `Requester argv: ${formatCommandPreview(metadata.argv ?? [])}`,
          `Secret count: ${metadata.count ?? 0}`,
        ].join("\n"),
      };
    case "export":
      return {
        title: "Approve vault export",
        message: `Export secrets from "${metadata.projectName}"?`,
        detail: [
          `Target: ${metadata.keyName ?? "[full vault]"}`,
          `Output path: ${metadata.outputPath ?? "Unknown"}`,
        ].join("\n"),
      };
    case "export_plaintext":
      return {
        title: "Approve plaintext env restore",
        message: `Restore plaintext .env files for "${metadata.projectName}"?`,
        detail: [
          `Project: ${metadata.projectName}`,
          `Destination: ${metadata.outputPath ?? "Unknown"}`,
          `Secret count: ${metadata.count ?? 0}`,
        ].join("\n"),
      };
  }
}

function serializeEnvValue(value: string): string {
  if (value === "") {
    return '""';
  }

  if (/[=\s"'`\\]/.test(value) || value.includes("\n")) {
    return JSON.stringify(value);
  }

  return value;
}

function formatCommandPreview(argv: string[]): string {
  if (argv.length === 0) {
    return "(empty)";
  }

  return argv.map((arg) => (/^[\w./:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}

/**
 * Parse a .env file content into key-value pairs.
 * Handles comments, empty lines, quoted values, and multiline values.
 */
function parseEnvFileContent(content: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      entries.push({ key, value });
    }
  }

  return entries;
}

function deriveEnvironmentName(fileName: string): string {
  return normalizeEnvironmentName(fileName);
}

function resolveRestoreFileName(scope: string, sourceFile?: string | null): string {
  if (sourceFile?.trim()) {
    return basename(sourceFile.trim());
  }

  if (scope === "default") {
    return ".env";
  }

  return scope.startsWith(".env") ? scope : `.env.${scope}`;
}

function resolveSchemaImportPath(projectPath: string | null, sourcePath?: string): string {
  const candidate = sourcePath ?? (projectPath ? join(projectPath, ".env.schema") : null);
  if (!candidate) {
    throw new Error("Choose a folder that contains a .env.schema file.");
  }

  const resolvedPath =
    existsSync(candidate) && statSync(candidate).isDirectory()
      ? join(candidate, ".env.schema")
      : candidate;

  if (!existsSync(resolvedPath)) {
    throw new Error(`No .env.schema file found at ${resolvedPath}`);
  }

  return resolvedPath;
}

function normalizeEnvironmentName(value: string): string {
  return value.trim() || "default";
}

function normalizeScopeAccessOverride(value: ScopeAccessModeOverrideInfo): ScopeAccessMode | null {
  return value === "inherit" ? null : value;
}
