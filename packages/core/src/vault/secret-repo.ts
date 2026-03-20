import type { Database } from "bun:sqlite";
import { decrypt, encrypt } from "../crypto/encryption";
import { hmacKey } from "../crypto/hmac";
import { generateId } from "../crypto/random";
import type { DecryptedSecret } from "../types/vault";

interface SecretRow {
  id: string;
  project_id: string;
  key_hash: Buffer;
  key_enc: Buffer;
  key_iv: Buffer;
  key_tag: Buffer;
  value_enc: Buffer;
  value_iv: Buffer;
  value_tag: Buffer;
  scope: string;
  version: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface HistoryRow {
  id: string;
  secret_id: string;
  value_enc: Buffer;
  value_iv: Buffer;
  value_tag: Buffer;
  version: number;
  created_at: number;
}

const MAX_HISTORY_ENTRIES = 10;

export class SecretRepository {
  constructor(
    private db: Database,
    private projectId: string,
    private projectKey: Buffer,
  ) {}

  create(key: string, value: string, scope = "default"): DecryptedSecret {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    const keyHashBuf = hmacKey(key, this.projectKey);
    const keyPayload = encrypt(key, this.projectKey);
    const valuePayload = encrypt(value, this.projectKey);

    this.db.run(
      `INSERT INTO secrets (id, project_id, key_hash, key_enc, key_iv, key_tag, value_enc, value_iv, value_tag, scope, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        this.projectId,
        keyHashBuf,
        keyPayload.ciphertext,
        keyPayload.iv,
        keyPayload.tag,
        valuePayload.ciphertext,
        valuePayload.iv,
        valuePayload.tag,
        scope,
        now,
        now,
      ],
    );

    return {
      id,
      projectId: this.projectId,
      key,
      value,
      scope,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  getById(secretId: string): DecryptedSecret | null {
    const row = this.db
      .query<SecretRow, [string, string]>(
        "SELECT * FROM secrets WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(this.projectId, secretId);

    if (!row) return null;
    return this.decryptRow(row);
  }

  getByKey(keyName: string, scope = "default"): DecryptedSecret | null {
    const keyHashBuf = hmacKey(keyName, this.projectKey);

    const row = this.db
      .query<SecretRow, [string, Buffer, string]>(
        "SELECT * FROM secrets WHERE project_id = ? AND key_hash = ? AND scope = ? AND deleted_at IS NULL",
      )
      .get(this.projectId, keyHashBuf, scope);

    if (!row) return null;
    return this.decryptRow(row);
  }

  list(): Array<{ id: string; key: string; scope: string; version: number; updatedAt: number }> {
    const rows = this.db
      .query<SecretRow, [string]>(
        "SELECT * FROM secrets WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at",
      )
      .all(this.projectId);

    return rows.map((row) => {
      const decryptedKey = decrypt(
        {
          ciphertext: Buffer.from(row.key_enc),
          iv: Buffer.from(row.key_iv),
          tag: Buffer.from(row.key_tag),
        },
        this.projectKey,
      );
      return {
        id: row.id,
        key: decryptedKey,
        scope: row.scope,
        version: row.version,
        updatedAt: row.updated_at,
      };
    });
  }

  update(keyName: string, newValue: string, scope = "default"): DecryptedSecret | null {
    const keyHashBuf = hmacKey(keyName, this.projectKey);

    const row = this.db
      .query<SecretRow, [string, Buffer, string]>(
        "SELECT * FROM secrets WHERE project_id = ? AND key_hash = ? AND scope = ? AND deleted_at IS NULL",
      )
      .get(this.projectId, keyHashBuf, scope);

    if (!row) return null;
    return this.updateRow(row, keyName, newValue, scope);
  }

  updateById(secretId: string, newValue: string, scope?: string): DecryptedSecret | null {
    const row = this.db
      .query<SecretRow, [string, string]>(
        "SELECT * FROM secrets WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(this.projectId, secretId);

    if (!row) return null;

    const keyName = decrypt(
      {
        ciphertext: Buffer.from(row.key_enc),
        iv: Buffer.from(row.key_iv),
        tag: Buffer.from(row.key_tag),
      },
      this.projectKey,
    );

    return this.updateRow(row, keyName, newValue, scope ?? row.scope);
  }

  private updateRow(
    row: SecretRow,
    keyName: string,
    newValue: string,
    scope: string,
  ): DecryptedSecret {
    const now = Math.floor(Date.now() / 1000);

    // Save current value to history
    this.db.run(
      `INSERT INTO secret_history (id, secret_id, value_enc, value_iv, value_tag, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [generateId(), row.id, row.value_enc, row.value_iv, row.value_tag, row.version, now],
    );

    // Prune history beyond MAX_HISTORY_ENTRIES
    this.db.run(
      `DELETE FROM secret_history WHERE secret_id = ? AND id NOT IN (
        SELECT id FROM secret_history WHERE secret_id = ? ORDER BY created_at DESC LIMIT ?
      )`,
      [row.id, row.id, MAX_HISTORY_ENTRIES],
    );

    // Encrypt new value
    const valuePayload = encrypt(newValue, this.projectKey);
    const newVersion = row.version + 1;

    this.db.run(
      `UPDATE secrets SET value_enc = ?, value_iv = ?, value_tag = ?,
       version = ?, updated_at = ?, scope = ?
       WHERE id = ?`,
      [valuePayload.ciphertext, valuePayload.iv, valuePayload.tag, newVersion, now, scope, row.id],
    );

    return {
      id: row.id,
      projectId: this.projectId,
      key: keyName,
      value: newValue,
      scope,
      version: newVersion,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  remove(keyName: string, scope = "default"): boolean {
    const keyHashBuf = hmacKey(keyName, this.projectKey);
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      "UPDATE secrets SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND key_hash = ? AND scope = ? AND deleted_at IS NULL",
      [now, now, this.projectId, keyHashBuf, scope],
    );

    return getLastChangeCount(this.db) > 0;
  }

  removeById(secretId: string): boolean {
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      "UPDATE secrets SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
      [now, now, this.projectId, secretId],
    );

    return getLastChangeCount(this.db) > 0;
  }

  getHistory(
    keyName: string,
    scope = "default",
    limit = MAX_HISTORY_ENTRIES,
  ): Array<{ value: string; version: number; createdAt: number }> {
    const keyHashBuf = hmacKey(keyName, this.projectKey);

    const secretRow = this.db
      .query<SecretRow, [string, Buffer, string]>(
        "SELECT id FROM secrets WHERE project_id = ? AND key_hash = ? AND scope = ?",
      )
      .get(this.projectId, keyHashBuf, scope);

    if (!secretRow) return [];
    return this.getHistoryById(secretRow.id, limit);
  }

  getHistoryById(
    secretId: string,
    limit = MAX_HISTORY_ENTRIES,
  ): Array<{ value: string; version: number; createdAt: number }> {
    const rows = this.db
      .query<HistoryRow, [string, number]>(
        "SELECT * FROM secret_history WHERE secret_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(secretId, limit);

    return rows.map((row) => {
      const value = decrypt(
        {
          ciphertext: Buffer.from(row.value_enc),
          iv: Buffer.from(row.value_iv),
          tag: Buffer.from(row.value_tag),
        },
        this.projectKey,
      );
      return { value, version: row.version, createdAt: row.created_at };
    });
  }

  getAllDecrypted(scope?: string): DecryptedSecret[] {
    const query = scope
      ? "SELECT * FROM secrets WHERE project_id = ? AND scope = ? AND deleted_at IS NULL ORDER BY created_at"
      : "SELECT * FROM secrets WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at";

    const rows = scope
      ? this.db.query<SecretRow, [string, string]>(query).all(this.projectId, scope)
      : this.db.query<SecretRow, [string]>(query).all(this.projectId);

    return rows.map((row) => this.decryptRow(row));
  }

  private decryptRow(row: SecretRow): DecryptedSecret {
    const decryptedKey = decrypt(
      {
        ciphertext: Buffer.from(row.key_enc),
        iv: Buffer.from(row.key_iv),
        tag: Buffer.from(row.key_tag),
      },
      this.projectKey,
    );

    const decryptedValue = decrypt(
      {
        ciphertext: Buffer.from(row.value_enc),
        iv: Buffer.from(row.value_iv),
        tag: Buffer.from(row.value_tag),
      },
      this.projectKey,
    );

    return {
      id: row.id,
      projectId: row.project_id,
      key: decryptedKey,
      value: decryptedValue,
      scope: row.scope,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function getLastChangeCount(db: Database): number {
  return db.query<{ changes: number }, []>("SELECT changes() AS changes").get()?.changes ?? 0;
}
