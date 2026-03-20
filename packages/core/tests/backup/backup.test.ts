import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportVault } from "../../src/backup/exporter";
import { importVault } from "../../src/backup/importer";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { EnvironmentRepository } from "../../src/vault/environment-repo";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SchemaRepository } from "../../src/vault/schema-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("backup schema entries", () => {
  let sourceDb: Database;
  let destinationDb: Database;
  let tempDir: string;

  beforeEach(() => {
    sourceDb = new Database(":memory:", { create: true, strict: true });
    sourceDb.run("PRAGMA foreign_keys = ON");
    runMigrations(sourceDb);

    destinationDb = new Database(":memory:", { create: true, strict: true });
    destinationDb.run("PRAGMA foreign_keys = ON");
    runMigrations(destinationDb);

    tempDir = mkdtempSync(join(tmpdir(), "cloakenv-backup-"));
  });

  afterEach(() => {
    sourceDb.close();
    destinationDb.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("round-trips schema-only entries separately from secret rows", async () => {
    const sourceMasterKey = randomBytesBuffer(KEY_LENGTH);
    const sourceProject = new ProjectRepository(sourceDb).create(
      "demo-project",
      "/tmp/demo-project",
    );
    const sourceProjectKey = deriveProjectKey(sourceMasterKey, sourceProject.salt);
    const sourceEnvironmentRepo = new EnvironmentRepository(sourceDb);
    const sourceSchemaRepo = new SchemaRepository(sourceDb);
    const sourceSecretRepo = new SecretRepository(sourceDb, sourceProject.id, sourceProjectKey);

    sourceEnvironmentRepo.create(sourceProject.id, ".env.local", "manual");
    sourceEnvironmentRepo.create(sourceProject.id, "staging", "manual");
    sourceSecretRepo.create("API_KEY", "sk_live_123", ".env.local");
    sourceSchemaRepo.upsert(sourceProject.id, "API_KEY", ".env.local", {
      typeName: "string",
      typeParams: { startsWith: "sk_" },
      sensitive: true,
      required: true,
      description: "Live API key",
      example: null,
      docsUrls: ["https://example.com/api-key"],
      defaultValue: null,
    });
    sourceSchemaRepo.upsert(sourceProject.id, "DATABASE_URL", "staging", {
      typeName: "url",
      typeParams: null,
      sensitive: true,
      required: true,
      description: "Staging database URL",
      example: null,
      docsUrls: [],
      defaultValue: null,
    });

    const backupPath = join(tempDir, "vault.env.cloaked");
    await exportVault({
      db: sourceDb,
      masterKey: sourceMasterKey,
      passphrase: "thunder-cactus-orbit-maple-4821-signal",
      outputPath: backupPath,
    });

    const destinationMasterKey = randomBytesBuffer(KEY_LENGTH);
    const result = await importVault({
      db: destinationDb,
      masterKey: destinationMasterKey,
      filePath: backupPath,
      passphrase: "thunder-cactus-orbit-maple-4821-signal",
    });

    expect(result).toEqual({
      projectsImported: 1,
      secretsImported: 1,
    });

    const importedProject = new ProjectRepository(destinationDb).getByName("demo-project");
    expect(importedProject).not.toBeNull();

    const destinationProjectKey = deriveProjectKey(destinationMasterKey, importedProject!.salt);
    const destinationSecretRepo = new SecretRepository(
      destinationDb,
      importedProject!.id,
      destinationProjectKey,
    );
    const destinationSchemaRepo = new SchemaRepository(destinationDb);

    expect(destinationSecretRepo.getByKey("API_KEY", ".env.local")?.value).toBe("sk_live_123");
    expect(destinationSecretRepo.getByKey("DATABASE_URL", "staging")).toBeNull();

    expect(
      destinationSchemaRepo.getByKey(importedProject!.id, "API_KEY", ".env.local"),
    ).toMatchObject({
      key: "API_KEY",
      scope: ".env.local",
      typeName: "string",
      typeParams: { startsWith: "sk_" },
    });

    expect(
      destinationSchemaRepo.getByKey(importedProject!.id, "DATABASE_URL", "staging"),
    ).toMatchObject({
      key: "DATABASE_URL",
      scope: "staging",
      typeName: "url",
      description: "Staging database URL",
      required: true,
    });
  });

  test("round-trips an empty full-vault snapshot", async () => {
    const backupPath = join(tempDir, "empty.env.cloaked");

    await exportVault({
      db: sourceDb,
      masterKey: randomBytesBuffer(KEY_LENGTH),
      passphrase: "thunder-cactus-orbit-maple-4821-signal",
      outputPath: backupPath,
    });

    const result = await importVault({
      db: destinationDb,
      masterKey: randomBytesBuffer(KEY_LENGTH),
      filePath: backupPath,
      passphrase: "thunder-cactus-orbit-maple-4821-signal",
    });

    expect(result).toEqual({
      projectsImported: 0,
      secretsImported: 0,
    });

    expect(new ProjectRepository(destinationDb).list()).toEqual([]);
  });
});
