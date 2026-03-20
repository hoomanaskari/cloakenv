import type { Database } from "bun:sqlite";
import { generateId } from "../crypto/random";
import type { Environment } from "../types/vault";

interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  source_file: string | null;
  source_kind: "imported" | "manual";
  created_at: number;
  updated_at: number;
}

interface EnvironmentSummaryRow extends EnvironmentRow {
  secret_count: number;
}

function rowToEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceFile: row.source_file,
    sourceKind: row.source_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EnvironmentRepository {
  constructor(private db: Database) {}

  create(
    projectId: string,
    name: string,
    sourceKind: "imported" | "manual" = "manual",
    sourceFile?: string | null,
  ): Environment {
    const existing = this.getByName(projectId, name);
    if (existing) {
      const nextSourceKind =
        existing.sourceKind === "imported" && sourceKind === "manual"
          ? existing.sourceKind
          : sourceKind;
      const nextSourceFile =
        existing.sourceKind === "imported" && sourceKind === "manual"
          ? existing.sourceFile
          : (sourceFile ?? null);
      this.touch(existing.id, nextSourceKind, nextSourceFile);
      return this.getById(existing.id)!;
    }

    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      `INSERT INTO environments (id, project_id, name, source_file, source_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, name, sourceFile ?? null, sourceKind, now, now],
    );

    return {
      id,
      projectId,
      name,
      sourceFile: sourceFile ?? null,
      sourceKind,
      createdAt: now,
      updatedAt: now,
    };
  }

  list(projectId: string): Array<Environment & { secretCount: number }> {
    const rows = this.db
      .query<EnvironmentSummaryRow, [string]>(
        `SELECT
           e.*,
           COALESCE(COUNT(s.id), 0) AS secret_count
         FROM environments e
         LEFT JOIN secrets s
           ON s.project_id = e.project_id
          AND s.scope = e.name
          AND s.deleted_at IS NULL
         WHERE e.project_id = ?
         GROUP BY e.id
         ORDER BY e.updated_at DESC, e.name ASC`,
      )
      .all(projectId);

    return rows.map((row) => ({
      ...rowToEnvironment(row),
      secretCount: row.secret_count,
    }));
  }

  getById(id: string): Environment | null {
    const row = this.db
      .query<EnvironmentRow, [string]>("SELECT * FROM environments WHERE id = ?")
      .get(id);
    return row ? rowToEnvironment(row) : null;
  }

  getByName(projectId: string, name: string): Environment | null {
    const row = this.db
      .query<EnvironmentRow, [string, string]>(
        "SELECT * FROM environments WHERE project_id = ? AND name = ?",
      )
      .get(projectId, name);
    return row ? rowToEnvironment(row) : null;
  }

  remove(projectId: string, environmentId: string): Environment | null {
    const environment = this.db
      .query<EnvironmentRow, [string, string]>(
        "SELECT * FROM environments WHERE project_id = ? AND id = ?",
      )
      .get(projectId, environmentId);

    if (!environment) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    this.db.transaction(() => {
      this.db.run(
        `UPDATE secrets
         SET deleted_at = ?, updated_at = ?
         WHERE project_id = ? AND scope = ? AND deleted_at IS NULL`,
        [now, now, projectId, environment.name],
      );

      this.db.run("DELETE FROM environments WHERE project_id = ? AND id = ?", [
        projectId,
        environmentId,
      ]);
    })();

    return rowToEnvironment(environment);
  }

  touch(id: string, sourceKind?: "imported" | "manual", sourceFile?: string | null): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      `UPDATE environments
       SET updated_at = ?,
           source_kind = COALESCE(?, source_kind),
           source_file = COALESCE(?, source_file)
       WHERE id = ?`,
      [now, sourceKind ?? null, sourceFile ?? null, id],
    );
  }
}
