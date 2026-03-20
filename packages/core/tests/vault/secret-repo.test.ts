import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("SecretRepository", () => {
  let db: Database;
  let secretRepo: SecretRepository;
  let projectId: string;
  const masterKey = randomBytesBuffer(KEY_LENGTH);

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.create("test-project", "/tmp/test");
    projectId = project.id;

    const projectKey = deriveProjectKey(masterKey, project.salt);
    secretRepo = new SecretRepository(db, projectId, projectKey);
  });

  afterEach(() => {
    db.close();
  });

  test("creates a secret", () => {
    const secret = secretRepo.create("API_KEY", "sk_test_123");
    expect(secret.key).toBe("API_KEY");
    expect(secret.value).toBe("sk_test_123");
    expect(secret.scope).toBe("default");
    expect(secret.version).toBe(1);
  });

  test("retrieves a secret by key name", () => {
    secretRepo.create("DATABASE_URL", "postgres://localhost:5432/db");
    const result = secretRepo.getByKey("DATABASE_URL");
    expect(result).not.toBeNull();
    expect(result?.value).toBe("postgres://localhost:5432/db");
  });

  test("returns null for non-existent key", () => {
    const result = secretRepo.getByKey("MISSING_KEY");
    expect(result).toBeNull();
  });

  test("lists all keys (without values)", () => {
    secretRepo.create("KEY_A", "value_a");
    secretRepo.create("KEY_B", "value_b");
    secretRepo.create("KEY_C", "value_c");

    const list = secretRepo.list();
    expect(list.length).toBe(3);
    expect(list.map((l) => l.key).sort()).toEqual(["KEY_A", "KEY_B", "KEY_C"]);
  });

  test("updates a secret value", () => {
    secretRepo.create("STRIPE_KEY", "sk_old");
    const updated = secretRepo.update("STRIPE_KEY", "sk_new");
    expect(updated?.value).toBe("sk_new");
    expect(updated?.version).toBe(2);

    const fetched = secretRepo.getByKey("STRIPE_KEY");
    expect(fetched?.value).toBe("sk_new");
  });

  test("stores history on update", () => {
    secretRepo.create("KEY", "v1");
    secretRepo.update("KEY", "v2");
    secretRepo.update("KEY", "v3");

    const history = secretRepo.getHistory("KEY");
    expect(history.length).toBe(2);
    const values = history.map((h) => h.value).sort();
    expect(values).toEqual(["v1", "v2"]);
  });

  test("caps history at 10 entries", () => {
    secretRepo.create("KEY", "v0");
    for (let i = 1; i <= 12; i++) {
      secretRepo.update("KEY", `v${i}`);
    }

    const history = secretRepo.getHistory("KEY");
    expect(history.length).toBe(10);
  });

  test("soft-deletes a secret", () => {
    secretRepo.create("TO_DELETE", "value");
    const removed = secretRepo.remove("TO_DELETE");
    expect(removed).toBe(true);

    const result = secretRepo.getByKey("TO_DELETE");
    expect(result).toBeNull();

    const list = secretRepo.list();
    expect(list.length).toBe(0);
  });

  test("returns false when removing non-existent key", () => {
    const removed = secretRepo.remove("MISSING");
    expect(removed).toBe(false);
  });

  test("creates secrets with custom scope", () => {
    secretRepo.create("SERVER_KEY", "value", "server");
    const result = secretRepo.getByKey("SERVER_KEY", "server");
    expect(result?.scope).toBe("server");
  });

  test("allows the same key in different environments", () => {
    secretRepo.create("API_KEY", "local-value", ".env.local");
    secretRepo.create("API_KEY", "prod-value", ".env.production");

    expect(secretRepo.getByKey("API_KEY", ".env.local")?.value).toBe("local-value");
    expect(secretRepo.getByKey("API_KEY", ".env.production")?.value).toBe("prod-value");
  });

  test("getAllDecrypted returns all secrets", () => {
    secretRepo.create("A", "1");
    secretRepo.create("B", "2");

    const all = secretRepo.getAllDecrypted();
    expect(all.length).toBe(2);
  });

  test("getAllDecrypted filters by scope", () => {
    secretRepo.create("A", "1", "server");
    secretRepo.create("B", "2", "worker");
    secretRepo.create("C", "3", "server");

    const serverOnly = secretRepo.getAllDecrypted("server");
    expect(serverOnly.length).toBe(2);
    expect(serverOnly.map((s) => s.key).sort()).toEqual(["A", "C"]);
  });
});
