import {
  type AuditDecision,
  type AuditEntry,
  AuditRepository,
  getDatabase,
  ProjectRepository,
} from "@cloakenv/core";
import type { Command } from "commander";

interface AuditTrace {
  latestTimestamp: number;
  requestId: string | null;
  projectId: string | null;
  action: string;
  decision: AuditDecision | null;
  keyName: string | null;
  scope: string | null;
  processName: string | null;
  processPid: number | null;
  workingDir: string | null;
  hasTty: boolean | null;
  argv: string[] | null;
  outputPath: string | null;
  stages: string[];
}

export function registerAuditCommand(program: Command): void {
  program
    .command("audit")
    .description("Display the access audit log")
    .option("--project <name>", "Filter by project name")
    .option("--limit <n>", "Max entries to show", "50")
    .option("--since <date>", "Show entries since date (ISO format)")
    .action(async (options: { project?: string; limit: string; since?: string }) => {
      const db = getDatabase();
      const auditRepo = new AuditRepository(db);
      const projectRepo = new ProjectRepository(db);

      const project = options.project ? projectRepo.getByName(options.project) : null;
      if (options.project && !project) {
        console.error(`Project "${options.project}" not found.`);
        process.exit(1);
      }

      const entries = auditRepo.query({
        projectId: project?.id,
        limit: parseInt(options.limit, 10),
        since: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
      });

      if (entries.length === 0) {
        console.log("No audit entries found.");
        return;
      }

      const projectNames = new Map(projectRepo.list().map((entry) => [entry.id, entry.name]));
      const traces = buildAuditTraces(entries);

      console.log(`Audit Trace (${traces.length} request${traces.length === 1 ? "" : "s"}):\n`);
      for (const trace of traces) {
        const stamp = formatTimestamp(trace.latestTimestamp);
        const projectName =
          trace.projectId === "all-projects"
            ? "All projects"
            : trace.projectId
              ? (projectNames.get(trace.projectId) ?? trace.projectId)
              : "Unknown project";
        const decision = trace.decision ?? "recorded";
        const target = trace.keyName ? `  ${trace.keyName}` : "";
        const scope = trace.scope && trace.scope !== "default" ? ` [${trace.scope}]` : "";

        console.log(
          `${stamp}  ${trace.action.padEnd(12)}  ${decision.padEnd(8)}  ${projectName}${target}${scope}`,
        );
        if (trace.requestId) {
          console.log(`  Request: ${trace.requestId}`);
        }
        if (trace.processName || trace.processPid !== null || trace.hasTty !== null) {
          console.log(`  Source:  ${formatSource(trace)}`);
        }
        if (trace.workingDir) {
          console.log(`  Folder:  ${trace.workingDir}`);
        }
        if (trace.argv && trace.argv.length > 0) {
          console.log(`  Command: ${trace.argv.join(" ")}`);
        }
        if (trace.outputPath) {
          console.log(`  Output:  ${trace.outputPath}`);
        }
        if (trace.stages.length > 1) {
          console.log(`  Stages:  ${trace.stages.join(" -> ")}`);
        }
        console.log("");
      }
    });
}

function buildAuditTraces(entries: AuditEntry[]): AuditTrace[] {
  const grouped = new Map<string, AuditEntry[]>();
  const standalone: AuditEntry[][] = [];

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
    .map(summarizeTrace)
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}

function summarizeTrace(entries: AuditEntry[]): AuditTrace {
  const chronological = [...entries].sort((a, b) => a.timestamp - b.timestamp);
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

  return {
    latestTimestamp: latest.timestamp,
    requestId: latest.requestId,
    projectId: primary.projectId,
    action: primary.action,
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
  };
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace("T", " ").substring(0, 19);
}

function formatSource(trace: AuditTrace): string {
  const processLabel = trace.processName ?? "unknown process";
  const pidLabel = trace.processPid === null ? "pid ?" : `pid ${trace.processPid}`;
  const ttyLabel = trace.hasTty === null ? "tty ?" : trace.hasTty ? "interactive tty" : "no tty";
  return `${processLabel} • ${pidLabel} • ${ttyLabel}`;
}
