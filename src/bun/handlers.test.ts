import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabase,
  DEFAULT_CLOAKED_BACKUP_FILENAME,
  deriveMasterKey,
  EnvironmentRepository,
  getDatabase,
  getKeychainProvider,
  importVault,
  MemoryKeychain,
  ProjectRepository,
  resetDatabaseSingleton,
  setKeychainProvider,
} from "../../packages/core/src/index";
import { runMigrations } from "../../packages/core/src/vault/migrations";
import { createVaultHandlers } from "./handlers";

const originalKeychainProvider = getKeychainProvider();
const testArtifacts: string[] = [];

describe("desktop handlers", () => {
  beforeEach(() => {
    resetDatabaseSingleton();
    getDatabase(":memory:");
    setKeychainProvider(new MemoryKeychain());
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseSingleton();
    setKeychainProvider(originalKeychainProvider);

    for (const artifact of testArtifacts.splice(0)) {
      rmSync(artifact, { recursive: true, force: true });
    }
  });

  test("imports schema files from the project root through the desktop handler", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cloakenv-schema-import-"));
    const schemaPath = join(tempDir, ".env.schema");
    testArtifacts.push(tempDir);

    writeFileSync(
      schemaPath,
      [
        "# @currentEnv=staging",
        "# @defaultSensitive=true",
        "# @defaultRequired=false",
        "",
        "# Port exposed by the local service",
        "# @type=port",
        "PORT=99999",
        "",
        "# Required token, no default stored in the schema file",
        "# @type=string",
        "# @required",
        "API_KEY=",
        "",
      ].join("\n"),
      "utf8",
    );

    const notifications: Array<{
      title: string;
      body?: string;
      subtitle?: string;
      silent?: boolean;
    }> = [];
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
      showNativeNotification: (notification) => {
        notifications.push(notification);
      },
    });

    const project = await handlers.createProject("desktop-schema-project", tempDir);
    const result = await handlers.importProjectSchema(project.id);

    expect(result).toEqual({
      path: schemaPath,
      scope: "staging",
      metadataApplied: 2,
      created: 1,
      skipped: 1,
      warnings: [
        {
          key: "PORT",
          scope: "staging",
          message: "Must be a valid port number (0-65535)",
        },
      ],
    });

    const environments = await handlers.listEnvironments(project.id);
    expect(environments.map((environment) => environment.name)).toEqual(["staging"]);

    const schema = await handlers.getProjectSchema(project.id);
    expect(schema).toHaveLength(2);
    expect(schema.map((entry) => `${entry.scope}:${entry.key}`)).toEqual([
      "staging:API_KEY",
      "staging:PORT",
    ]);

    const secrets = await handlers.getSecrets(project.id, "staging");
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.key).toBe("PORT");

    expect(notifications).toContainEqual({
      title: "Schema import complete",
      body: "Imported 2 schema entries from .env.schema",
      subtitle: "desktop-schema-project",
      silent: false,
    });
  });

  test("desktop config exposes presentation mode and persists updates", async () => {
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const initialConfig = await handlers.getConfig();
    expect(initialConfig.desktopAppearance).toBe("dock_and_menu");
    expect(initialConfig.onboardingCompleted).toBe(false);

    handlers.setConfig("desktopAppearance", "menu_only");
    handlers.setConfig("onboardingCompleted", "true");

    const updatedConfig = await handlers.getConfig();
    expect(updatedConfig.desktopAppearance).toBe("menu_only");
    expect(updatedConfig.onboardingCompleted).toBe(true);
  });

  test("revealSecret requires approval by default", async () => {
    let approvalCount = 0;
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => {
        approvalCount += 1;
        return false;
      },
    });

    const project = await handlers.createProject("reveal-default-project");
    const secret = await handlers.setSecret(project.id, "API_KEY", "local-secret", ".env.local");

    let blockedError: unknown = null;
    try {
      await handlers.revealSecret(project.id, secret.id);
    } catch (error) {
      blockedError = error;
    }

    expect(approvalCount).toBe(1);
    expect(blockedError).toBeInstanceOf(Error);
    expect((blockedError as Error & { code?: string }).code).toBe("approval_denied");
  });

  test("trusted desktop UI revealSecret skips approval", async () => {
    let approvalCount = 0;
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => {
        approvalCount += 1;
        return false;
      },
    });

    const project = await handlers.createProject("reveal-desktop-ui-project");
    const secret = await handlers.setSecret(project.id, "API_KEY", "local-secret", ".env.local");

    const revealed = await handlers.revealSecret(project.id, secret.id, {
      trustedDesktopUI: true,
    });

    expect(revealed).toEqual({ value: "local-secret" });
    expect(approvalCount).toBe(0);
  });

  test("imports schema files when given a folder that contains .env.schema", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cloakenv-schema-folder-import-"));
    const schemaPath = join(tempDir, ".env.schema");
    testArtifacts.push(tempDir);

    writeFileSync(
      schemaPath,
      [
        "# @currentEnv=default",
        "# @defaultRequired=false",
        "",
        "# @type=url",
        "PUBLIC_URL=https://example.com",
        "",
      ].join("\n"),
      "utf8",
    );

    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("desktop-schema-folder-project");
    const result = await handlers.importProjectSchema(project.id, tempDir);

    expect(result.path).toBe(schemaPath);
    expect(result.scope).toBe("default");
    expect(result.metadataApplied).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test("restores plaintext env files with imported filenames when available", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cloakenv-restore-project-"));
    const restoreDir = mkdtempSync(join(tmpdir(), "cloakenv-restore-output-"));
    testArtifacts.push(projectDir, restoreDir);

    const importedEnvPath = join(projectDir, ".env.local");
    writeFileSync(importedEnvPath, "API_KEY=local-secret\n", "utf8");

    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("restore-project", projectDir);
    await handlers.importEnvFile(project.id, importedEnvPath);
    await handlers.setSecret(project.id, "FEATURE_FLAG", "on", "preview");

    const result = await handlers.restorePlainEnv(project.id, restoreDir);

    expect(result.destinationFolder).toBe(restoreDir);
    expect(result.files.map((file) => file.fileName).sort()).toEqual([
      ".env.local",
      ".env.preview",
    ]);
    expect(readFileSync(join(restoreDir, ".env.local"), "utf8")).toBe("API_KEY=local-secret\n");
    expect(readFileSync(join(restoreDir, ".env.preview"), "utf8")).toBe("FEATURE_FLAG=on\n");
  });

  test("imports root .env using the file name as the environment scope", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cloakenv-root-env-project-"));
    testArtifacts.push(projectDir);

    const importedEnvPath = join(projectDir, ".env");
    writeFileSync(importedEnvPath, "API_KEY=root-secret\n", "utf8");

    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("root-env-project", projectDir);
    await handlers.importEnvFile(project.id, importedEnvPath);

    const environments = await handlers.listEnvironments(project.id);
    expect(environments.map((environment) => environment.name)).toEqual([".env"]);
    expect(environments[0]?.sourceFile).toBe(".env");

    const policy = await handlers.getProjectPolicy(project.id);
    expect(policy.defaultScope).toBe(".env");

    const resolved = await handlers.resolveProviderEnvironment({
      requestId: "root-env-request",
      kind: "resolve_environment",
      projectName: project.name,
      cwd: process.cwd(),
      requester: {
        processName: "cloakenv",
        processPid: 103,
        argv: ["cloakenv", "run"],
        hasTty: true,
      },
    });

    expect(resolved.env).toEqual({ API_KEY: "root-secret" });
  });

  test("accepts .env requests for legacy imported environments stored as default", async () => {
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("legacy-root-env-project");
    const environmentRepo = new EnvironmentRepository(getDatabase());
    environmentRepo.create(project.id, "default", "imported", ".env");
    await handlers.setSecret(project.id, "API_KEY", "legacy-root-secret", "default");

    const resolved = await handlers.resolveProviderEnvironment({
      requestId: "legacy-root-env-request",
      kind: "resolve_environment",
      projectName: project.name,
      cwd: process.cwd(),
      scope: ".env",
      requester: {
        processName: "cloakenv",
        processPid: 104,
        argv: ["cloakenv", "run", "--scope", ".env"],
        hasTty: true,
      },
    });

    expect(resolved.env).toEqual({ API_KEY: "legacy-root-secret" });
  });

  test("auto-backup overwrites the snapshot when the last project is removed", async () => {
    const backupDir = mkdtempSync(join(tmpdir(), "cloakenv-backup-output-"));
    testArtifacts.push(backupDir);

    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    handlers.setConfig("backupPath", backupDir);
    await handlers.setAutoBackupPassphrase("thunder-cactus-orbit-maple-4821-signal");

    const project = await handlers.createProject("auto-backup-empty-vault");
    await handlers.removeProject(project.id);

    const importedDb = new Database(":memory:", { create: true, strict: true });
    importedDb.run("PRAGMA foreign_keys = ON");
    runMigrations(importedDb);
    const { key: importedMasterKey } = await deriveMasterKey("fresh-import-master-key");

    const result = await importVault({
      db: importedDb,
      masterKey: importedMasterKey,
      filePath: join(backupDir, DEFAULT_CLOAKED_BACKUP_FILENAME),
      passphrase: "thunder-cactus-orbit-maple-4821-signal",
    });

    expect(result).toEqual({
      projectsImported: 0,
      secretsImported: 0,
    });
    expect(new ProjectRepository(importedDb).list()).toEqual([]);
    importedDb.close();
  });

  test("uses project default scope and blocks adapter visibility when policy denies it", async () => {
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("policy-project");
    await handlers.setSecret(project.id, "API_KEY", "secret-value", ".env.local");
    await handlers.updateProjectPolicyDefaults(project.id, {
      defaultScope: ".env.local",
      defaultCliVisibility: "allow",
      defaultAdapterVisibility: "deny",
    });

    let blockedError: unknown = null;
    try {
      await handlers.resolveProviderEnvironment({
        requestId: "adapter-request",
        kind: "resolve_environment",
        projectName: project.name,
        cwd: process.cwd(),
        requester: {
          processName: "python",
          processPid: 101,
          argv: ["python", "main.py"],
          hasTty: false,
        },
      });
    } catch (error) {
      blockedError = error;
    }

    expect(blockedError).toBeInstanceOf(Error);
    expect((blockedError as Error & { code?: string }).code).toBe("scope_blocked");

    const resolved = await handlers.resolveProviderEnvironment({
      requestId: "cli-request",
      kind: "resolve_environment",
      projectName: project.name,
      cwd: process.cwd(),
      requester: {
        processName: "cloakenv",
        processPid: 102,
        argv: ["cloakenv", "run"],
        hasTty: true,
      },
    });

    expect(resolved.env).toEqual({ API_KEY: "secret-value" });
  });

  test("resolve_environment approval dialogs include requester argv and secret count", async () => {
    const approvalDialogs: Array<{ title: string; message: string; detail: string }> = [];
    const handlers = createVaultHandlers({
      requestNativeApproval: async (dialog) => {
        approvalDialogs.push(dialog);
        return true;
      },
    });

    const project = await handlers.createProject("resolve-dialog-project");
    await handlers.setSecret(project.id, "API_KEY", "local-secret", ".env.local");

    const resolved = await handlers.resolveProviderEnvironment({
      requestId: "resolve-dialog-request",
      kind: "resolve_environment",
      projectName: project.name,
      cwd: process.cwd(),
      scope: ".env.local",
      requester: {
        processName: "python3",
        processPid: 4242,
        argv: ["python3", "resolve_env.py"],
        hasTty: true,
      },
    });

    expect(resolved.env).toEqual({ API_KEY: "local-secret" });
    expect(approvalDialogs).toHaveLength(1);
    expect(approvalDialogs[0]).toEqual({
      title: "Approve environment resolution",
      message: `Resolve plaintext environment values from "${project.name}"?`,
      detail: [
        `Project: ${project.name}`,
        "Scope: .env.local",
        `Working directory: ${process.cwd()}`,
        "Requester argv: python3 resolve_env.py",
        "Secret count: 1",
      ].join("\n"),
    });
  });

  test("provider sessions reuse approval for matching resolve requests", async () => {
    let approvalCount = 0;
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => {
        approvalCount += 1;
        return true;
      },
    });

    const project = await handlers.createProject("session-project");
    await handlers.setSecret(project.id, "API_KEY", "local-secret", ".env.local");
    handlers.setConfig("providerSessionTtlMinutes", "10");

    const request = {
      kind: "resolve_environment" as const,
      projectName: project.name,
      cwd: process.cwd(),
      scope: ".env.local",
      requester: {
        processName: "vite",
        processPid: 9001,
        argv: ["vite", "dev"],
        hasTty: true,
      },
    };

    await handlers.resolveProviderEnvironment({
      ...request,
      requestId: "resolve-1",
    });
    await handlers.resolveProviderEnvironment({
      ...request,
      requestId: "resolve-2",
    });

    const diagnostics = handlers.getProviderDiagnostics();

    expect(approvalCount).toBe(1);
    expect(diagnostics.providerSessionTtlMinutes).toBe(10);
    expect(diagnostics.activeSessionCount).toBe(1);
    expect(diagnostics.activeSessions[0]?.reuseCount).toBe(1);
    expect(diagnostics.activeSessions[0]?.commandPreview).toBe("vite dev");
  });

  test("provider diagnostics reflect foreground approval mode", async () => {
    const handlers = createVaultHandlers({
      providerMode: "foreground",
      requestNativeApproval: async () => true,
    });

    const diagnostics = handlers.getProviderDiagnostics();

    expect(diagnostics.mode).toBe("foreground");
    expect(diagnostics.approvalMode).toBe("terminal");
    expect(diagnostics.desktopSensitiveAvailable).toBe(true);
  });

  test("provider sessions can be expired individually and all at once", async () => {
    const handlers = createVaultHandlers({
      requestNativeApproval: async () => true,
    });

    const project = await handlers.createProject("expire-session-project");
    await handlers.setSecret(project.id, "API_KEY", "local-secret", ".env.local");
    handlers.setConfig("providerSessionTtlMinutes", "10");

    const baseRequest = {
      kind: "resolve_environment" as const,
      cwd: process.cwd(),
      scope: ".env.local",
      requester: {
        processName: "vite",
        processPid: 777,
        argv: ["vite", "dev"],
        hasTty: true,
      },
    };

    await handlers.resolveProviderEnvironment({
      ...baseRequest,
      requestId: "session-1",
      projectName: project.name,
    });
    await handlers.resolveProviderEnvironment({
      ...baseRequest,
      requestId: "session-2",
      projectName: project.name,
      requester: {
        ...baseRequest.requester,
        argv: ["vite", "preview"],
      },
    });

    const beforeExpiry = handlers.getProviderDiagnostics();
    expect(beforeExpiry.activeSessionCount).toBe(2);

    const expireOne = handlers.expireProviderSession({
      sessionId: beforeExpiry.activeSessions[0]?.id,
    });
    expect(expireOne.expired).toBe(1);
    expect(expireOne.remaining).toBe(1);

    const expireAll = handlers.expireProviderSession({ all: true });
    expect(expireAll.expired).toBe(1);
    expect(expireAll.remaining).toBe(0);
    expect(handlers.getProviderDiagnostics().activeSessionCount).toBe(0);
  });
});
