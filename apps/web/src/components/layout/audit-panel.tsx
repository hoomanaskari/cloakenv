import { RefreshCcw } from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ModalTrafficLights } from "@/components/ui/modal-traffic-lights";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AuditEntryInfo } from "@/hooks/use-rpc";
import { useRPC } from "@/hooks/use-rpc";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type ActionFilter =
  | "all"
  | "get"
  | "history"
  | "list_values"
  | "resolve"
  | "run"
  | "export"
  | "export_plaintext"
  | "write"
  | "delete"
  | "import";

type DecisionFilter = "all" | "approved" | "denied" | "pending" | "recorded";
type ScopeMode = "active" | "all";

interface AuditTrace {
  id: string;
  latestTimestamp: number;
  requestId: string | null;
  projectId: string | null;
  projectName: string;
  action: string;
  actionLabel: string;
  decision: string | null;
  keyName: string | null;
  scope: string | null;
  processName: string | null;
  processPid: number | null;
  workingDir: string | null;
  hasTty: boolean | null;
  argv: string[] | null;
  outputPath: string | null;
  stages: string[];
  summary: string;
}

const TRACE_LIMIT = 200;

export function AuditPanel() {
  const rpc = useRPC();
  const open = useAppStore((state) => state.auditOpen);
  const setOpen = useAppStore((state) => state.setAuditOpen);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const projects = useAppStore((state) => state.projects);
  const auditEntries = useAppStore((state) => state.auditEntries);
  const setAuditEntries = useAppStore((state) => state.setAuditEntries);

  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [scopeMode, setScopeMode] = useState<ScopeMode>(activeProjectId ? "active" : "all");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!activeProjectId && scopeMode === "active") {
      setScopeMode("all");
    }
  }, [activeProjectId, scopeMode]);

  useEffect(() => {
    if (!open || !rpc) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    rpc
      .getAuditLog({
        projectId: scopeMode === "active" ? (activeProjectId ?? undefined) : undefined,
        limit: TRACE_LIMIT,
      })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        startTransition(() => setAuditEntries(entries));
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load audit trace");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, open, rpc, scopeMode, setAuditEntries]);

  const refreshAudit = async () => {
    if (!rpc) {
      return;
    }

    try {
      setLoading(true);
      const entries = await rpc.getAuditLog({
        projectId: scopeMode === "active" ? (activeProjectId ?? undefined) : undefined,
        limit: TRACE_LIMIT,
      });
      startTransition(() => setAuditEntries(entries));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh audit trace");
    } finally {
      setLoading(false);
    }
  };

  const traces = buildAuditTraces(auditEntries, projects);
  const filteredTraces = traces.filter((trace) =>
    matchesTrace(trace, deferredQuery, actionFilter, decisionFilter),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[52rem] gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-[0_12px_40px_-4px_rgba(0,0,0,0.2),0_4px_16px_-2px_rgba(0,0,0,0.08)] sm:max-w-[52rem]"
      >
        <div className="flex h-[42rem] max-h-[85vh] min-h-[28rem] flex-col">
          {/* Title bar */}
          <div className="relative shrink-0 border-b border-border/30 bg-muted/20 py-2.5">
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              <ModalTrafficLights onClose={() => setOpen(false)} />
            </div>
            <DialogTitle className="text-center text-[13px] font-medium tracking-tight">
              Request Trace
            </DialogTitle>
            <DialogDescription className="sr-only">
              Sensitive access requests and approval history
            </DialogDescription>
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => void refreshAudit()}
                disabled={loading}
              >
                <RefreshCcw className={cn("size-3", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="border-b border-border/40 px-6 py-3">
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
                className="h-8 flex-1 text-sm"
              />
              <Select
                value={actionFilter}
                onValueChange={(value) => setActionFilter(value as ActionFilter)}
              >
                <SelectTrigger className="h-8 w-[9rem] text-xs">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="get">Read secret</SelectItem>
                  <SelectItem value="history">History</SelectItem>
                  <SelectItem value="list_values">List values</SelectItem>
                  <SelectItem value="resolve">Resolve env</SelectItem>
                  <SelectItem value="run">Run command</SelectItem>
                  <SelectItem value="export">Encrypted export</SelectItem>
                  <SelectItem value="export_plaintext">Plaintext export</SelectItem>
                  <SelectItem value="write">Write</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="import">Import</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={decisionFilter}
                onValueChange={(value) => setDecisionFilter(value as DecisionFilter)}
              >
                <SelectTrigger className="h-8 w-[9rem] text-xs">
                  <SelectValue placeholder="Decision" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All decisions</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="recorded">Recorded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {activeProjectId ? (
              <Tabs
                value={scopeMode}
                onValueChange={(value) => setScopeMode(value as ScopeMode)}
                className="mt-2"
              >
                <TabsList className="h-7">
                  <TabsTrigger value="active" className="text-xs">
                    Active Project
                  </TabsTrigger>
                  <TabsTrigger value="all" className="text-xs">
                    All Projects
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
          </div>

          {/* Trace list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              {filteredTraces.length === 0 ? (
                <div className="rounded-xl bg-muted/30 px-6 py-12 text-center">
                  <p className="text-sm text-muted-foreground">No matching request traces</p>
                </div>
              ) : (
                filteredTraces.map((trace) => <TraceItem key={trace.id} trace={trace} />)
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Trace item ── */

function TraceItem({ trace }: { trace: AuditTrace }) {
  const hasSource = trace.workingDir || (trace.argv && trace.argv.length > 0) || trace.outputPath;

  return (
    <div className="rounded-xl bg-muted/30 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DecisionDot decision={trace.decision} />
            <span className="truncate text-sm font-medium">{trace.summary}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {trace.actionLabel} &middot; {trace.projectName}
            {trace.scope && trace.scope !== "default" ? ` \u00b7 ${trace.scope}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatTimestamp(trace.latestTimestamp)}
        </span>
      </div>

      {hasSource ? (
        <div className="mt-2.5 space-y-0.5 font-mono text-xs text-muted-foreground/70">
          {trace.workingDir ? <p className="truncate">{trace.workingDir}</p> : null}
          {trace.argv && trace.argv.length > 0 ? (
            <p className="truncate">{trace.argv.join(" ")}</p>
          ) : null}
          {trace.outputPath ? <p className="truncate">{trace.outputPath}</p> : null}
        </div>
      ) : null}

      {trace.stages.length > 1 ? (
        <p className="mt-2 text-[11px] text-muted-foreground/50">
          {trace.stages.map(formatStage).join(" \u2192 ")}
        </p>
      ) : null}
    </div>
  );
}

/* ── Decision dot ── */

function DecisionDot({ decision }: { decision: string | null }) {
  const color =
    decision === "approved"
      ? "bg-emerald-500"
      : decision === "denied"
        ? "bg-rose-500"
        : decision === "pending"
          ? "bg-amber-500"
          : "bg-muted-foreground/40";

  return <div className={cn("h-2 w-2 shrink-0 rounded-full", color)} />;
}

/* ── Data helpers (unchanged) ── */

function buildAuditTraces(
  entries: AuditEntryInfo[],
  projects: Array<{ id: string; name: string }>,
): AuditTrace[] {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const grouped = new Map<string, AuditEntryInfo[]>();
  const standalone: AuditEntryInfo[][] = [];

  for (const entry of entries) {
    if (!entry.requestId) {
      standalone.push([entry]);
      continue;
    }

    const bucket = grouped.get(entry.requestId) ?? [];
    bucket.push(entry);
    grouped.set(entry.requestId, bucket);
  }

  return [...grouped.values(), ...standalone]
    .map((bucket) => summarizeTrace(bucket, projectNames))
    .sort((left, right) => right.latestTimestamp - left.latestTimestamp);
}

function summarizeTrace(entries: AuditEntryInfo[], projectNames: Map<string, string>): AuditTrace {
  const chronological = [...entries].sort((left, right) => left.timestamp - right.timestamp);
  const latest = chronological[chronological.length - 1]!;
  const primary = chronological.find((entry) => !entry.action.startsWith("approval_")) ?? latest;
  const source =
    chronological.find(
      (entry) =>
        entry.processName !== null ||
        entry.processPid !== null ||
        entry.workingDir !== null ||
        entry.argv !== null ||
        entry.outputPath !== null,
    ) ?? latest;
  const decision =
    [...chronological].reverse().find((entry) => entry.decision !== null)?.decision ?? null;
  const projectName =
    primary.projectId === "all-projects"
      ? "All projects"
      : primary.projectId
        ? (projectNames.get(primary.projectId) ?? primary.projectId)
        : "Unknown project";

  return {
    id: primary.requestId ?? primary.id,
    latestTimestamp: latest.timestamp,
    requestId: primary.requestId,
    projectId: primary.projectId,
    projectName,
    action: primary.action,
    actionLabel: ACTION_LABELS[primary.action] ?? primary.action,
    decision,
    keyName: primary.keyName,
    scope: primary.scope,
    processName: source.processName,
    processPid: source.processPid,
    workingDir: source.workingDir,
    hasTty: source.hasTty,
    argv: source.argv,
    outputPath: source.outputPath,
    stages: chronological.map((entry) => entry.action),
    summary: summarizePrimaryContext(primary),
  };
}

function summarizePrimaryContext(entry: AuditEntryInfo): string {
  if (entry.action === "run" && entry.argv?.length) {
    return entry.argv.join(" ");
  }

  if (entry.action === "resolve" && entry.argv?.length) {
    return entry.argv.join(" ");
  }

  if (entry.outputPath) {
    return entry.outputPath;
  }

  if (entry.keyName) {
    return entry.scope && entry.scope !== "default"
      ? `${entry.keyName} [${entry.scope}]`
      : entry.keyName;
  }

  if (entry.workingDir) {
    return entry.workingDir;
  }

  return ACTION_LABELS[entry.action] ?? entry.action;
}

function matchesTrace(
  trace: AuditTrace,
  query: string,
  actionFilter: ActionFilter,
  decisionFilter: DecisionFilter,
): boolean {
  if (actionFilter !== "all" && trace.action !== actionFilter) {
    return false;
  }

  const normalizedDecision = trace.decision ?? "recorded";
  if (decisionFilter !== "all" && normalizedDecision !== decisionFilter) {
    return false;
  }

  const search = query.trim().toLowerCase();
  if (!search) {
    return true;
  }

  return [
    trace.projectName,
    trace.requestId,
    trace.summary,
    trace.processName,
    trace.workingDir,
    trace.outputPath,
    trace.argv?.join(" "),
    trace.stages.join(" "),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(search));
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function formatStage(stage: string): string {
  if (stage === "approval_request") return "Requested";
  if (stage === "approval_grant") return "Granted";
  if (stage === "approval_deny") return "Denied";
  if (stage === "approval_reuse") return "Session Reused";
  return ACTION_LABELS[stage] ?? stage;
}

const ACTION_LABELS: Record<string, string> = {
  get: "Secret Read",
  history: "History Read",
  list_values: "Value Listing",
  resolve: "Env Resolve",
  run: "Process Launch",
  export: "Export",
  export_plaintext: "Plaintext Export",
  write: "Write",
  delete: "Delete",
  import: "Import",
  approval_request: "Approval Requested",
  approval_grant: "Approval Granted",
  approval_deny: "Approval Denied",
  approval_reuse: "Approval Session Reused",
};
