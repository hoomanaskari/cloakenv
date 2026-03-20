import type { Database } from "bun:sqlite";
import { generateId } from "../crypto/random";
import type { AuditAction, AuditDecision, AuditEntry, AuditQuery } from "../types/audit";

interface AuditRow {
  id: string;
  request_id: string | null;
  project_id: string | null;
  secret_id: string | null;
  action: string;
  key_name: string | null;
  scope: string | null;
  process_name: string | null;
  process_pid: number | null;
  parent_process: string | null;
  working_dir: string | null;
  has_tty: number | null;
  argv_json: string | null;
  output_path: string | null;
  decision: string | null;
  timestamp: number;
}

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    requestId: row.request_id,
    projectId: row.project_id,
    secretId: row.secret_id,
    action: row.action as AuditAction,
    keyName: row.key_name,
    scope: row.scope,
    processName: row.process_name,
    processPid: row.process_pid,
    workingDir: row.working_dir,
    hasTty: row.has_tty === null ? null : row.has_tty === 1,
    argv: row.argv_json ? (JSON.parse(row.argv_json) as string[]) : null,
    outputPath: row.output_path,
    decision: row.decision as AuditDecision | null,
    timestamp: row.timestamp,
  };
}

export class AuditRepository {
  constructor(private db: Database) {}

  log(entry: {
    requestId?: string;
    projectId?: string;
    secretId?: string;
    action: AuditAction;
    keyName?: string;
    scope?: string;
    processName?: string | null;
    processPid?: number | null;
    workingDir?: string | null;
    hasTty?: boolean | null;
    argv?: string[] | null;
    outputPath?: string | null;
    decision?: AuditDecision | null;
  }): void {
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);

    this.db.run(
      `INSERT INTO audit_log (
        id,
        request_id,
        project_id,
        secret_id,
        action,
        key_name,
        scope,
        process_name,
        process_pid,
        parent_process,
        working_dir,
        has_tty,
        argv_json,
        output_path,
        decision,
        timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.requestId ?? null,
        entry.projectId ?? null,
        entry.secretId ?? null,
        entry.action,
        entry.keyName ?? null,
        entry.scope ?? null,
        entry.processName ?? null,
        entry.processPid ?? null,
        null,
        entry.workingDir ?? null,
        entry.hasTty === undefined || entry.hasTty === null ? null : entry.hasTty ? 1 : 0,
        entry.argv ? JSON.stringify(entry.argv) : null,
        entry.outputPath ?? null,
        entry.decision ?? null,
        now,
      ],
    );
  }

  query(filter: AuditQuery = {}): AuditEntry[] {
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (filter.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.action) {
      conditions.push("action = ?");
      params.push(filter.action);
    }
    if (filter.requestId) {
      conditions.push("request_id = ?");
      params.push(filter.requestId);
    }
    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;

    const rows = this.db
      .prepare<AuditRow, (string | number | null)[]>(
        `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ?`,
      )
      .all(...params, limit);

    return rows.map(rowToEntry);
  }
}
