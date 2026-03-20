import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CLOAKED_BACKUP_FILENAME } from "../../src/types/backup";
import { AuditRepository } from "../../src/vault/audit-repo";
import { runMigrations } from "../../src/vault/migrations";

describe("AuditRepository", () => {
  let db: Database;
  let repo: AuditRepository;

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);
    repo = new AuditRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("logs an audit entry", () => {
    repo.log({
      requestId: "req-1",
      action: "read",
      keyName: "API_KEY",
      scope: "production",
      processName: "cloakenv",
      processPid: 1234,
      workingDir: "/tmp/project",
      argv: ["npm", "run", "dev"],
      outputPath: `/tmp/${DEFAULT_CLOAKED_BACKUP_FILENAME}`,
      decision: "approved",
    });

    const entries = repo.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("read");
    expect(entries[0].requestId).toBe("req-1");
    expect(entries[0].keyName).toBe("API_KEY");
    expect(entries[0].scope).toBe("production");
    expect(entries[0].workingDir).toBe("/tmp/project");
    expect(entries[0].argv).toEqual(["npm", "run", "dev"]);
    expect(entries[0].outputPath).toBe(`/tmp/${DEFAULT_CLOAKED_BACKUP_FILENAME}`);
    expect(entries[0].decision).toBe("approved");
  });

  test("queries by action type", () => {
    repo.log({ action: "read", keyName: "A" });
    repo.log({ action: "write", keyName: "B" });
    repo.log({ action: "read", keyName: "C" });

    const reads = repo.query({ action: "read" });
    expect(reads.length).toBe(2);
  });

  test("respects limit", () => {
    for (let i = 0; i < 20; i++) {
      repo.log({ action: "read", keyName: `KEY_${i}` });
    }

    const limited = repo.query({ limit: 5 });
    expect(limited.length).toBe(5);
  });

  test("queries by request id", () => {
    repo.log({ requestId: "req-a", action: "approval_request", decision: "pending" });
    repo.log({ requestId: "req-b", action: "approval_grant", decision: "approved" });

    const entries = repo.query({ requestId: "req-b" });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("approval_grant");
  });

  test("orders by timestamp descending", () => {
    repo.log({ action: "read", keyName: "FIRST" });
    repo.log({ action: "read", keyName: "SECOND" });

    const entries = repo.query();
    expect(entries[0].keyName).toBe("SECOND");
    expect(entries[1].keyName).toBe("FIRST");
  });
});
