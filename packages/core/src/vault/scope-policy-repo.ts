import type { Database } from "bun:sqlite";
import { generateId } from "../crypto/random";
import type { ScopeAccessMode, ScopePolicy } from "../types/vault";

interface ScopePolicyRow {
  id: string;
  project_id: string;
  scope: string;
  cli_visibility: ScopeAccessMode | null;
  adapter_visibility: ScopeAccessMode | null;
  created_at: number;
  updated_at: number;
}

function rowToScopePolicy(row: ScopePolicyRow): ScopePolicy {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    cliVisibility: row.cli_visibility,
    adapterVisibility: row.adapter_visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ScopePolicyRepository {
  constructor(private db: Database) {}

  listByProject(projectId: string): ScopePolicy[] {
    const rows = this.db
      .query<ScopePolicyRow, [string]>(
        "SELECT * FROM scope_policies WHERE project_id = ? ORDER BY scope ASC",
      )
      .all(projectId);
    return rows.map(rowToScopePolicy);
  }

  getByScope(projectId: string, scope: string): ScopePolicy | null {
    const row = this.db
      .query<ScopePolicyRow, [string, string]>(
        "SELECT * FROM scope_policies WHERE project_id = ? AND scope = ?",
      )
      .get(projectId, scope);
    return row ? rowToScopePolicy(row) : null;
  }

  save(
    projectId: string,
    scope: string,
    values: {
      cliVisibility: ScopeAccessMode | null;
      adapterVisibility: ScopeAccessMode | null;
    },
  ): ScopePolicy | null {
    if (values.cliVisibility === null && values.adapterVisibility === null) {
      this.db.run("DELETE FROM scope_policies WHERE project_id = ? AND scope = ?", [
        projectId,
        scope,
      ]);
      return null;
    }

    const existing = this.getByScope(projectId, scope);
    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      this.db.run(
        `UPDATE scope_policies
         SET cli_visibility = ?, adapter_visibility = ?, updated_at = ?
         WHERE id = ?`,
        [values.cliVisibility, values.adapterVisibility, now, existing.id],
      );
      return this.getByScope(projectId, scope);
    }

    const id = generateId();
    this.db.run(
      `INSERT INTO scope_policies (
        id,
        project_id,
        scope,
        cli_visibility,
        adapter_visibility,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, scope, values.cliVisibility, values.adapterVisibility, now, now],
    );
    return this.getByScope(projectId, scope);
  }
}
