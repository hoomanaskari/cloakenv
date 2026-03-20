import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SchemaRepository } from "../../src/vault/schema-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("SchemaRepository", () => {
  let db: Database;
  let schemaRepo: SchemaRepository;
  let secretRepo: SecretRepository;
  let projectId: string;

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const masterKey = randomBytesBuffer(KEY_LENGTH);
    const project = new ProjectRepository(db).create("schema-test");
    const projectKey = deriveProjectKey(masterKey, project.salt);

    projectId = project.id;
    schemaRepo = new SchemaRepository(db);
    secretRepo = new SecretRepository(db, project.id, projectKey);
  });

  afterEach(() => {
    db.close();
  });

  test("migrates legacy schema_meta rows into project-scoped schema entries", () => {
    const secret = secretRepo.create("DATABASE_URL", "postgres://localhost", ".env.local");
    db.run(
      `INSERT INTO schema_meta (
         id, secret_id, type_name, type_params, sensitive, required, description,
         example, docs_urls, default_value, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy-schema-1",
        secret.id,
        "url",
        null,
        1,
        1,
        "Primary database URL",
        null,
        JSON.stringify(["https://example.com/db"]),
        null,
        100,
        100,
      ],
    );

    expect(schemaRepo.migrateLegacyProjectEntries(projectId, secretRepo.list())).toBe(1);

    const migrated = schemaRepo.getByKey(projectId, "DATABASE_URL", ".env.local");
    expect(migrated).not.toBeNull();
    expect(migrated).toMatchObject({
      projectId,
      key: "DATABASE_URL",
      scope: ".env.local",
      typeName: "url",
      sensitive: true,
      required: true,
      description: "Primary database URL",
      docsUrls: ["https://example.com/db"],
    });

    expect(schemaRepo.migrateLegacyProjectEntries(projectId, secretRepo.list())).toBe(0);
  });
});
