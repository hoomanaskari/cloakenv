import { basename } from "node:path";

/**
 * Build audit context from the current process environment.
 */
export function getProcessContext(): {
  processName: string;
  processPid: number;
  workingDir: string;
  argv: string[];
  hasTty: boolean;
} {
  const entrypoint = process.argv[1] ?? process.argv[0] ?? "unknown";
  const normalizedEntrypoint = entrypoint.replaceAll("\\", "/");
  const normalizedName = normalizedEntrypoint.includes("/apps/cli/")
    ? "cloakenv cli"
    : basename(entrypoint);

  return {
    processName: normalizedName,
    processPid: process.pid,
    workingDir: process.cwd(),
    argv: process.argv.slice(1),
    hasTty: Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY),
  };
}
