import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS vault_meta (
          key       TEXT PRIMARY KEY,
          value     TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL UNIQUE,
          path          TEXT,
          git_remote    TEXT,
          description   TEXT,
          salt          BLOB NOT NULL,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          deleted_at    INTEGER
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_projects_path
        ON projects(path) WHERE deleted_at IS NULL
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS secrets (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          key_hash      BLOB NOT NULL,
          key_enc       BLOB NOT NULL,
          key_iv        BLOB NOT NULL,
          key_tag       BLOB NOT NULL,
          value_enc     BLOB NOT NULL,
          value_iv      BLOB NOT NULL,
          value_tag     BLOB NOT NULL,
          scope         TEXT DEFAULT 'default',
          version       INTEGER NOT NULL DEFAULT 1,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          deleted_at    INTEGER
        )
      `);

      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_project_key
        ON secrets(project_id, key_hash) WHERE deleted_at IS NULL
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_secrets_project
        ON secrets(project_id) WHERE deleted_at IS NULL
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_secrets_scope
        ON secrets(project_id, scope) WHERE deleted_at IS NULL
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS secret_history (
          id            TEXT PRIMARY KEY,
          secret_id     TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
          value_enc     BLOB NOT NULL,
          value_iv      BLOB NOT NULL,
          value_tag     BLOB NOT NULL,
          version       INTEGER NOT NULL,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_history_secret
        ON secret_history(secret_id)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          id            TEXT PRIMARY KEY,
          secret_id     TEXT NOT NULL UNIQUE REFERENCES secrets(id) ON DELETE CASCADE,
          type_name     TEXT,
          type_params   TEXT,
          sensitive     INTEGER DEFAULT 1,
          required      INTEGER DEFAULT 1,
          description   TEXT,
          example       TEXT,
          docs_urls     TEXT,
          default_value TEXT,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id            TEXT PRIMARY KEY,
          project_id    TEXT REFERENCES projects(id),
          secret_id     TEXT REFERENCES secrets(id),
          action        TEXT NOT NULL,
          key_name      TEXT,
          process_name  TEXT,
          process_pid   INTEGER,
          parent_process TEXT,
          working_dir   TEXT,
          has_tty       INTEGER,
          timestamp     INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_project
        ON audit_log(project_id, timestamp)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_log(timestamp)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS config (
          key           TEXT PRIMARY KEY,
          value         TEXT NOT NULL,
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
    },
  },
  {
    version: 2,
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS environments (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          source_file   TEXT,
          source_kind   TEXT NOT NULL DEFAULT 'manual',
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(project_id, name)
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_environments_project
        ON environments(project_id, updated_at)
      `);

      db.run(`DROP INDEX IF EXISTS idx_secrets_project_key`);

      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_project_key_scope
        ON secrets(project_id, key_hash, scope) WHERE deleted_at IS NULL
      `);

      db.run(`
        INSERT OR IGNORE INTO environments (id, project_id, name, source_kind, created_at, updated_at)
        SELECT
          lower(hex(randomblob(16))),
          project_id,
          COALESCE(scope, 'default'),
          'manual',
          MIN(created_at),
          MAX(updated_at)
        FROM secrets
        GROUP BY project_id, COALESCE(scope, 'default')
      `);
    },
  },
  {
    version: 3,
    up: (db: Database) => {
      db.run("ALTER TABLE audit_log ADD COLUMN request_id TEXT");
      db.run("ALTER TABLE audit_log ADD COLUMN scope TEXT");
      db.run("ALTER TABLE audit_log ADD COLUMN argv_json TEXT");
      db.run("ALTER TABLE audit_log ADD COLUMN output_path TEXT");
      db.run("ALTER TABLE audit_log ADD COLUMN decision TEXT");

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_request
        ON audit_log(request_id, timestamp)
      `);
    },
  },
  {
    version: 4,
    up: (db: Database) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS schema_entries (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          key_name      TEXT NOT NULL,
          scope         TEXT NOT NULL DEFAULT 'default',
          type_name     TEXT,
          type_params   TEXT,
          sensitive     INTEGER DEFAULT 1,
          required      INTEGER DEFAULT 1,
          description   TEXT,
          example       TEXT,
          docs_urls     TEXT,
          default_value TEXT,
          created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(project_id, key_name, scope)
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_schema_entries_project
        ON schema_entries(project_id, scope, key_name)
      `);
    },
  },
  {
    version: 5,
    up: (db: Database) => {
      db.run("ALTER TABLE projects ADD COLUMN default_scope TEXT NOT NULL DEFAULT 'default'");
      db.run(
        "ALTER TABLE projects ADD COLUMN default_cli_visibility TEXT NOT NULL DEFAULT 'allow'",
      );
      db.run(
        "ALTER TABLE projects ADD COLUMN default_adapter_visibility TEXT NOT NULL DEFAULT 'allow'",
      );

      db.run(`
        CREATE TABLE IF NOT EXISTS scope_policies (
          id                  TEXT PRIMARY KEY,
          project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          scope               TEXT NOT NULL,
          cli_visibility      TEXT,
          adapter_visibility  TEXT,
          created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(project_id, scope)
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_scope_policies_project
        ON scope_policies(project_id, scope)
      `);
    },
  },
];

export function runMigrations(db: Database): void {
  // Ensure vault_meta table exists for version tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      key       TEXT PRIMARY KEY,
      value     TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const row = db
    .query<{ value: string }, []>("SELECT value FROM vault_meta WHERE key = 'schema_version'")
    .get();

  const currentVersion = row ? parseInt(row.value, 10) : 0;

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        migration.up(db);
        db.run(
          `INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES ('schema_version', ?, unixepoch())`,
          [migration.version.toString()],
        );
      })();
    }
  }
}
