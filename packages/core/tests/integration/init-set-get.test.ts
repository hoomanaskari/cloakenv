import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { AuditRepository } from "../../src/vault/audit-repo";
import { ConfigRepository } from "../../src/vault/config-repo";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("Integration: Init → Set → Get → List → Remove", () => {
  let db: Database;
  const masterKey = randomBytesBuffer(KEY_LENGTH);

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  test("full secret lifecycle", () => {
    // 1. Create project
    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.create(
      "my-api",
      "/home/user/my-api",
      "git@github.com:user/my-api.git",
    );
    expect(project.name).toBe("my-api");

    // 2. Derive project key
    const projectKey = deriveProjectKey(masterKey, project.salt);
    const secretRepo = new SecretRepository(db, project.id, projectKey);

    // 3. Set secrets
    secretRepo.create("DATABASE_URL", "postgres://localhost:5432/mydb");
    secretRepo.create("API_KEY", "sk_test_12345", "server");
    secretRepo.create("PORT", "3000");

    // 4. Get a secret
    const dbUrl = secretRepo.getByKey("DATABASE_URL");
    expect(dbUrl).not.toBeNull();
    expect(dbUrl?.value).toBe("postgres://localhost:5432/mydb");

    // 5. List secrets
    const list = secretRepo.list();
    expect(list.length).toBe(3);
    expect(list.map((s) => s.key).sort()).toEqual(["API_KEY", "DATABASE_URL", "PORT"]);

    // 6. Update a secret
    secretRepo.update("PORT", "8080");
    const updatedPort = secretRepo.getByKey("PORT");
    expect(updatedPort?.value).toBe("8080");
    expect(updatedPort?.version).toBe(2);

    // 7. Check history
    const history = secretRepo.getHistory("PORT");
    expect(history.length).toBe(1);
    expect(history[0].value).toBe("3000");

    // 8. Remove a secret
    secretRepo.remove("API_KEY", "server");
    expect(secretRepo.getByKey("API_KEY", "server")).toBeNull();
    expect(secretRepo.list().length).toBe(2);

    // 9. Get all decrypted (for run command)
    const allSecrets = secretRepo.getAllDecrypted();
    expect(allSecrets.length).toBe(2);
    const envMap = Object.fromEntries(allSecrets.map((s) => [s.key, s.value]));
    expect(envMap.DATABASE_URL).toBe("postgres://localhost:5432/mydb");
    expect(envMap.PORT).toBe("8080");
  });

  test("multi-project isolation", () => {
    const projectRepo = new ProjectRepository(db);

    const projectA = projectRepo.create("project-a");
    const projectB = projectRepo.create("project-b");

    const keyA = deriveProjectKey(masterKey, projectA.salt);
    const keyB = deriveProjectKey(masterKey, projectB.salt);

    const repoA = new SecretRepository(db, projectA.id, keyA);
    const repoB = new SecretRepository(db, projectB.id, keyB);

    repoA.create("SHARED_KEY", "value-for-a");
    repoB.create("SHARED_KEY", "value-for-b");

    expect(repoA.getByKey("SHARED_KEY")?.value).toBe("value-for-a");
    expect(repoB.getByKey("SHARED_KEY")?.value).toBe("value-for-b");

    expect(repoA.list().length).toBe(1);
    expect(repoB.list().length).toBe(1);
  });

  test("config management", () => {
    const configRepo = new ConfigRepository(db);

    // Defaults
    expect(configRepo.get("backupPath")).toBeNull();
    expect(configRepo.get("authMode")).toBe("keychain");
    expect(configRepo.get("autoBackup")).toBe(true);
    expect(configRepo.get("onboardingCompleted")).toBe(false);
    expect(configRepo.get("launchAtLogin")).toBe(false);
    expect(configRepo.get("providerSessionTtlMinutes")).toBe(0);
    expect(configRepo.get("desktopAppearance")).toBe("dock_and_menu");

    // Set values
    configRepo.set("backupPath", "/Users/me/Dropbox/secrets");
    configRepo.set("autoBackup", false);
    configRepo.set("launchAtLogin", true);
    configRepo.set("providerSessionTtlMinutes", 15);
    configRepo.set("desktopAppearance", "menu_only");

    expect(configRepo.get("backupPath")).toBe("/Users/me/Dropbox/secrets");
    expect(configRepo.get("autoBackup")).toBe(false);
    expect(configRepo.get("launchAtLogin")).toBe(true);
    expect(configRepo.get("providerSessionTtlMinutes")).toBe(15);
    expect(configRepo.get("desktopAppearance")).toBe("menu_only");

    // Get all
    const all = configRepo.getAll();
    expect(all.backupPath).toBe("/Users/me/Dropbox/secrets");
    expect(all.authMode).toBe("keychain");
    expect(all.autoBackup).toBe(false);
    expect(all.onboardingCompleted).toBe(false);
    expect(all.launchAtLogin).toBe(true);
    expect(all.providerSessionTtlMinutes).toBe(15);
    expect(all.desktopAppearance).toBe("menu_only");
  });

  test("audit logging", () => {
    const auditRepo = new AuditRepository(db);

    auditRepo.log({
      action: "read",
      keyName: "API_KEY",
      processName: "node",
      processPid: 1234,
      workingDir: "/home/user/project",
    });

    auditRepo.log({
      action: "write",
      keyName: "DB_URL",
      processName: "cloakenv",
      processPid: 5678,
    });

    const all = auditRepo.query();
    expect(all.length).toBe(2);

    const reads = auditRepo.query({ action: "read" });
    expect(reads.length).toBe(1);
    expect(reads[0].keyName).toBe("API_KEY");
  });
});
