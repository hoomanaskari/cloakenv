export type AuditAction =
  | "approval_request"
  | "approval_grant"
  | "approval_deny"
  | "approval_reuse"
  | "get"
  | "history"
  | "list_values"
  | "resolve"
  | "resolve_environment"
  | "read"
  | "write"
  | "delete"
  | "export"
  | "export_plaintext"
  | "import"
  | "run";

export type AuditDecision = "pending" | "approved" | "denied";

export interface AuditEntry {
  id: string;
  requestId: string | null;
  projectId: string | null;
  secretId: string | null;
  action: AuditAction;
  keyName: string | null;
  scope: string | null;
  processName: string | null;
  processPid: number | null;
  workingDir: string | null;
  hasTty: boolean | null;
  argv: string[] | null;
  outputPath: string | null;
  decision: AuditDecision | null;
  timestamp: number;
}

export interface AuditQuery {
  projectId?: string;
  action?: AuditAction;
  requestId?: string;
  since?: number;
  limit?: number;
}
