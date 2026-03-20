import type { Database } from "bun:sqlite";
import { generateId } from "../crypto/random";
import type { SchemaMetadata } from "../types/schema";

interface SchemaEntryRow {
  id: string;
  project_id: string;
  key_name: string;
  scope: string;
  type_name: string | null;
  type_params: string | null;
  sensitive: number;
  required: number;
  description: string | null;
  example: string | null;
  docs_urls: string | null;
  default_value: string | null;
  created_at: number;
  updated_at: number;
}

interface LegacySchemaRow {
  id: string;
  secret_id: string;
  type_name: string | null;
  type_params: string | null;
  sensitive: number;
  required: number;
  description: string | null;
  example: string | null;
  docs_urls: string | null;
  default_value: string | null;
  created_at: number;
  updated_at: number;
}

function rowToMetadata(row: SchemaEntryRow): SchemaMetadata {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key_name,
    scope: row.scope,
    typeName: row.type_name,
    typeParams: row.type_params ? JSON.parse(row.type_params) : null,
    sensitive: row.sensitive === 1,
    required: row.required === 1,
    description: row.description,
    example: row.example,
    docsUrls: row.docs_urls ? JSON.parse(row.docs_urls) : [],
    defaultValue: row.default_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type SchemaPatch = Partial<
  Omit<SchemaMetadata, "id" | "projectId" | "key" | "scope" | "createdAt" | "updatedAt">
>;

export class SchemaRepository {
  constructor(private db: Database) {}

  listByProject(projectId: string): SchemaMetadata[] {
    const rows = this.db
      .query<SchemaEntryRow, [string]>(
        `SELECT * FROM schema_entries
         WHERE project_id = ?
         ORDER BY scope ASC, key_name ASC, created_at ASC`,
      )
      .all(projectId);

    return rows.map(rowToMetadata);
  }

  hasEntries(projectId: string): boolean {
    const row = this.db
      .query<{ total: number }, [string]>(
        "SELECT COUNT(*) AS total FROM schema_entries WHERE project_id = ?",
      )
      .get(projectId);

    return (row?.total ?? 0) > 0;
  }

  getById(id: string): SchemaMetadata | null {
    const row = this.db
      .query<SchemaEntryRow, [string]>("SELECT * FROM schema_entries WHERE id = ?")
      .get(id);

    return row ? rowToMetadata(row) : null;
  }

  getByKey(projectId: string, key: string, scope = "default"): SchemaMetadata | null {
    const row = this.db
      .query<SchemaEntryRow, [string, string, string]>(
        `SELECT * FROM schema_entries
         WHERE project_id = ? AND key_name = ? AND scope = ?`,
      )
      .get(projectId, key, scope);

    return row ? rowToMetadata(row) : null;
  }

  upsert(projectId: string, key: string, scope: string, meta: SchemaPatch): SchemaMetadata {
    const existing = this.getByKey(projectId, key, scope);
    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      this.db.run(
        `UPDATE schema_entries SET
          type_name = ?, type_params = ?, sensitive = ?, required = ?,
          description = ?, example = ?, docs_urls = ?, default_value = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          meta.typeName ?? existing.typeName,
          meta.typeParams
            ? JSON.stringify(meta.typeParams)
            : existing.typeParams
              ? JSON.stringify(existing.typeParams)
              : null,
          meta.sensitive !== undefined ? (meta.sensitive ? 1 : 0) : existing.sensitive ? 1 : 0,
          meta.required !== undefined ? (meta.required ? 1 : 0) : existing.required ? 1 : 0,
          meta.description ?? existing.description,
          meta.example ?? existing.example,
          meta.docsUrls
            ? JSON.stringify(meta.docsUrls)
            : existing.docsUrls.length > 0
              ? JSON.stringify(existing.docsUrls)
              : null,
          meta.defaultValue ?? existing.defaultValue,
          now,
          existing.id,
        ],
      );

      return this.getById(existing.id)!;
    }

    const id = generateId();
    this.db.run(
      `INSERT INTO schema_entries (
         id, project_id, key_name, scope, type_name, type_params, sensitive,
         required, description, example, docs_urls, default_value, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectId,
        key,
        scope,
        meta.typeName ?? null,
        meta.typeParams ? JSON.stringify(meta.typeParams) : null,
        meta.sensitive !== undefined ? (meta.sensitive ? 1 : 0) : 1,
        meta.required !== undefined ? (meta.required ? 1 : 0) : 1,
        meta.description ?? null,
        meta.example ?? null,
        meta.docsUrls ? JSON.stringify(meta.docsUrls) : null,
        meta.defaultValue ?? null,
        now,
        now,
      ],
    );

    return this.getById(id)!;
  }

  update(
    id: string,
    meta: SchemaPatch & Partial<Pick<SchemaMetadata, "key" | "scope">>,
  ): SchemaMetadata {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Schema entry ${id} not found`);
    }

    const now = Math.floor(Date.now() / 1000);
    this.db.run(
      `UPDATE schema_entries SET
         key_name = ?, scope = ?, type_name = ?, type_params = ?, sensitive = ?,
         required = ?, description = ?, example = ?, docs_urls = ?, default_value = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        meta.key ?? existing.key,
        meta.scope ?? existing.scope,
        meta.typeName ?? existing.typeName,
        meta.typeParams
          ? JSON.stringify(meta.typeParams)
          : existing.typeParams
            ? JSON.stringify(existing.typeParams)
            : null,
        meta.sensitive !== undefined ? (meta.sensitive ? 1 : 0) : existing.sensitive ? 1 : 0,
        meta.required !== undefined ? (meta.required ? 1 : 0) : existing.required ? 1 : 0,
        meta.description ?? existing.description,
        meta.example ?? existing.example,
        meta.docsUrls
          ? JSON.stringify(meta.docsUrls)
          : existing.docsUrls.length > 0
            ? JSON.stringify(existing.docsUrls)
            : null,
        meta.defaultValue ?? existing.defaultValue,
        now,
        id,
      ],
    );

    return this.getById(id)!;
  }

  remove(id: string): void {
    this.db.run("DELETE FROM schema_entries WHERE id = ?", [id]);
  }

  migrateLegacyProjectEntries(
    projectId: string,
    secrets: Array<{ id: string; key: string; scope: string }>,
  ): number {
    let migrated = 0;

    for (const secret of secrets) {
      if (this.getByKey(projectId, secret.key, secret.scope)) {
        continue;
      }

      const legacy = this.db
        .query<LegacySchemaRow, [string]>("SELECT * FROM schema_meta WHERE secret_id = ?")
        .get(secret.id);

      if (!legacy) {
        continue;
      }

      this.db.run(
        `INSERT INTO schema_entries (
           id, project_id, key_name, scope, type_name, type_params, sensitive,
           required, description, example, docs_urls, default_value, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(),
          projectId,
          secret.key,
          secret.scope,
          legacy.type_name,
          legacy.type_params,
          legacy.sensitive,
          legacy.required,
          legacy.description,
          legacy.example,
          legacy.docs_urls,
          legacy.default_value,
          legacy.created_at,
          legacy.updated_at,
        ],
      );

      migrated += 1;
    }

    return migrated;
  }
}
