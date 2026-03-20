import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runMigrations } from "./migrations";

export const VAULT_DIR = join(homedir(), ".config", "cloakenv");
export const VAULT_DB_PATH = join(VAULT_DIR, "vault.db");

let _db: Database | null = null;

/**
 * Get the singleton database connection.
 * Creates the database file and runs migrations if needed.
 * Pass ":memory:" for testing.
 */
export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath ?? VAULT_DB_PATH;

  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  _db = new Database(path, { create: true, strict: true });

  // Enable WAL mode for crash resilience
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  _db.run("PRAGMA synchronous = FULL"); // Maximum durability in WAL mode

  runMigrations(_db);

  return _db;
}

/**
 * Close the database connection and reset the singleton.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Reset the singleton (for testing). Does NOT close the connection.
 */
export function resetDatabaseSingleton(): void {
  _db = null;
}
