import type { Database } from "bun:sqlite";
import { generateId, generateSalt } from "../crypto/random";
import type { Project, ScopeAccessMode } from "../types/vault";

interface ProjectRow {
  id: string;
  name: string;
  path: string | null;
  git_remote: string | null;
  description: string | null;
  default_scope: string;
  default_cli_visibility: ScopeAccessMode;
  default_adapter_visibility: ScopeAccessMode;
  salt: Buffer;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    description: row.description,
    defaultScope: row.default_scope,
    defaultCliVisibility: row.default_cli_visibility,
    defaultAdapterVisibility: row.default_adapter_visibility,
    salt: Buffer.from(row.salt),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class ProjectRepository {
  constructor(private db: Database) {}

  create(
    name: string,
    path?: string | null,
    gitRemote?: string | null,
    description?: string | null,
  ): Project {
    const id = generateId();
    const salt = generateSalt();
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      `INSERT INTO projects (id, name, path, git_remote, description, salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, path ?? null, gitRemote ?? null, description ?? null, salt, now, now],
    );

    return {
      id,
      name,
      path: path ?? null,
      gitRemote: gitRemote ?? null,
      description: description ?? null,
      defaultScope: "default",
      defaultCliVisibility: "allow",
      defaultAdapterVisibility: "allow",
      salt,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  getById(id: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    return row ? rowToProject(row) : null;
  }

  getByName(name: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE name = ? AND deleted_at IS NULL")
      .get(name);
    return row ? rowToProject(row) : null;
  }

  getByPath(path: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE path = ? AND deleted_at IS NULL")
      .get(path);
    return row ? rowToProject(row) : null;
  }

  list(): Project[] {
    const rows = this.db
      .query<ProjectRow, []>("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY name")
      .all();
    return rows.map(rowToProject);
  }

  rename(id: string, newName: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      "UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [newName, now, id],
    );
  }

  updateScopeDefaults(
    id: string,
    values: {
      defaultScope: string;
      defaultCliVisibility: ScopeAccessMode;
      defaultAdapterVisibility: ScopeAccessMode;
    },
  ): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      `UPDATE projects
       SET default_scope = ?, default_cli_visibility = ?, default_adapter_visibility = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [values.defaultScope, values.defaultCliVisibility, values.defaultAdapterVisibility, now, id],
    );
  }

  remove(id: string): void {
    this.db.transaction((projectId: string) => {
      // Audit rows do not cascade, so purge them before deleting the project root record.
      this.db.run(
        `DELETE FROM audit_log
         WHERE project_id = ?
            OR secret_id IN (SELECT id FROM secrets WHERE project_id = ?)`,
        [projectId, projectId],
      );

      this.db.run("DELETE FROM projects WHERE id = ?", [projectId]);
    })(id);
  }

  getSecretCount(projectId: string): number {
    const row = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM secrets WHERE project_id = ? AND deleted_at IS NULL",
      )
      .get(projectId);
    return row?.count ?? 0;
  }
}
