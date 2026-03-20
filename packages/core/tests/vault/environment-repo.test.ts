import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { EnvironmentRepository } from "../../src/vault/environment-repo";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("EnvironmentRepository", () => {
  let db: Database;
  let projectId: string;
  let environmentRepo: EnvironmentRepository;
  let secretRepo: SecretRepository;
  const masterKey = randomBytesBuffer(KEY_LENGTH);

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.create("test-project", "/tmp/test");
    projectId = project.id;
    environmentRepo = new EnvironmentRepository(db);
    secretRepo = new SecretRepository(db, projectId, deriveProjectKey(masterKey, project.salt));
  });

  afterEach(() => {
    db.close();
  });

  test("creates manual environments", () => {
    const environment = environmentRepo.create(projectId, "manual.stage", "manual");
    expect(environment.name).toBe("manual.stage");
    expect(environment.sourceKind).toBe("manual");
    expect(environment.sourceFile).toBeNull();
  });

  test("preserves imported metadata when reused manually", () => {
    environmentRepo.create(projectId, ".env.production", "imported", ".env.production");
    const environment = environmentRepo.create(projectId, ".env.production", "manual");

    expect(environment.sourceKind).toBe("imported");
    expect(environment.sourceFile).toBe(".env.production");
  });

  test("removes an environment and soft-deletes its secrets", () => {
    const environment = environmentRepo.create(projectId, "staging", "manual");
    secretRepo.create("API_URL", "https://example.com", "staging");
    secretRepo.create("ANOTHER_KEY", "value", "staging");
    secretRepo.create("DEFAULT_KEY", "value", "default");

    const removed = environmentRepo.remove(projectId, environment.id);

    expect(removed?.id).toBe(environment.id);
    expect(environmentRepo.getById(environment.id)).toBeNull();
    expect(secretRepo.getByKey("API_URL", "staging")).toBeNull();
    expect(secretRepo.getByKey("ANOTHER_KEY", "staging")).toBeNull();
    expect(secretRepo.getByKey("DEFAULT_KEY", "default")?.value).toBe("value");
  });
});
