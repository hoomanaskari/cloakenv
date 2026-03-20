import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/vault/migrations";

describe("Database", () => {
  let db: Database;

  afterEach(() => {
    db?.close();
  });

  test("creates in-memory database", () => {
    db = new Database(":memory:", { create: true, strict: true });
    expect(db).toBeTruthy();
  });

  test("runs migrations successfully", () => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    // Check schema version
    const row = db
      .query<{ value: string }, []>("SELECT value FROM vault_meta WHERE key = 'schema_version'")
      .get();
    expect(row?.value).toBe("5");
  });

  test("creates all expected tables", () => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("vault_meta");
    expect(tables).toContain("projects");
    expect(tables).toContain("environments");
    expect(tables).toContain("secrets");
    expect(tables).toContain("secret_history");
    expect(tables).toContain("schema_meta");
    expect(tables).toContain("schema_entries");
    expect(tables).toContain("scope_policies");
    expect(tables).toContain("audit_log");
    expect(tables).toContain("config");
  });

  test("migrations are idempotent", () => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);
    runMigrations(db); // Run again — should not error

    const row = db
      .query<{ value: string }, []>("SELECT value FROM vault_meta WHERE key = 'schema_version'")
      .get();
    expect(row?.value).toBe("5");
  });
});
