import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { EnvironmentRepository } from "../../src/vault/environment-repo";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SchemaRepository } from "../../src/vault/schema-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("ProjectRepository", () => {
  let db: Database;
  let repo: ProjectRepository;
  const masterKey = randomBytesBuffer(KEY_LENGTH);

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("creates a project", () => {
    const project = repo.create("my-app", "/path/to/app", "git@github.com:user/app.git");
    expect(project.name).toBe("my-app");
    expect(project.path).toBe("/path/to/app");
    expect(project.gitRemote).toBe("git@github.com:user/app.git");
    expect(project.salt.length).toBe(32);
    expect(project.deletedAt).toBeNull();
  });

  test("retrieves project by name", () => {
    repo.create("test-project", "/tmp/test");
    const project = repo.getByName("test-project");
    expect(project).not.toBeNull();
    expect(project?.name).toBe("test-project");
  });

  test("retrieves project by path", () => {
    repo.create("test-project", "/tmp/test");
    const project = repo.getByPath("/tmp/test");
    expect(project).not.toBeNull();
    expect(project?.name).toBe("test-project");
  });

  test("lists all projects", () => {
    repo.create("project-a");
    repo.create("project-b");
    repo.create("project-c");

    const list = repo.list();
    expect(list.length).toBe(3);
  });

  test("renames a project", () => {
    const project = repo.create("old-name");
    repo.rename(project.id, "new-name");

    const renamed = repo.getByName("new-name");
    expect(renamed).not.toBeNull();
    expect(repo.getByName("old-name")).toBeNull();
  });

  test("purges a project from the database", () => {
    const project = repo.create("to-delete");
    const projectKey = deriveProjectKey(masterKey, project.salt);
    const secretRepo = new SecretRepository(db, project.id, projectKey);
    const environmentRepo = new EnvironmentRepository(db);
    const schemaRepo = new SchemaRepository(db);

    environmentRepo.create(project.id, "staging", "manual");
    const secret = secretRepo.create("API_KEY", "secret", "staging");
    secretRepo.update("API_KEY", "rotated-secret", "staging");
    schemaRepo.upsert(project.id, "API_KEY", "staging", {
      description: "Primary API credential",
      sensitive: true,
      required: true,
    });
    db.run(
      `INSERT INTO schema_meta (id, secret_id, created_at, updated_at)
       VALUES (?, ?, unixepoch(), unixepoch())`,
      ["legacy-schema", secret.id],
    );
    db.run(
      `INSERT INTO audit_log (id, project_id, secret_id, action, timestamp)
       VALUES (?, ?, ?, ?, unixepoch())`,
      ["audit-entry", project.id, secret.id, "write"],
    );
    db.run(
      `INSERT INTO audit_log (id, secret_id, action, timestamp)
       VALUES (?, ?, ?, unixepoch())`,
      ["secret-only-audit", secret.id, "history"],
    );

    repo.remove(project.id);

    expect(db.query("SELECT id FROM projects WHERE id = ?").get(project.id)).toBeNull();
    expect(db.query("SELECT id FROM secrets WHERE project_id = ?").all(project.id)).toHaveLength(0);
    expect(
      db.query("SELECT id FROM environments WHERE project_id = ?").all(project.id),
    ).toHaveLength(0);
    expect(
      db.query("SELECT id FROM schema_entries WHERE project_id = ?").all(project.id),
    ).toHaveLength(0);
    expect(
      db.query("SELECT id FROM secret_history WHERE secret_id = ?").all(secret.id),
    ).toHaveLength(0);
    expect(db.query("SELECT id FROM schema_meta WHERE secret_id = ?").all(secret.id)).toHaveLength(
      0,
    );
    expect(db.query("SELECT id FROM audit_log WHERE project_id = ?").all(project.id)).toHaveLength(
      0,
    );
    expect(db.query("SELECT id FROM audit_log WHERE secret_id = ?").all(secret.id)).toHaveLength(0);
    expect(repo.getByName("to-delete")).toBeNull();
    expect(repo.list().length).toBe(0);
  });

  test("enforces unique project names", () => {
    repo.create("unique-name");
    expect(() => repo.create("unique-name")).toThrow();
  });
});
