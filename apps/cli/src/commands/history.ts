import { getProcessContext } from "@cloakenv/core";
import type { Command } from "commander";
import { formatSensitiveRequestError, invokeSensitiveRequest } from "../utils/approval-broker";

export function registerHistoryCommand(program: Command): void {
  program
    .command("history <key>")
    .description("Show the version history for a secret key")
    .option("--scope <tag>", "Secret scope / environment")
    .option("--limit <n>", "Max entries to show", "10")
    .option("--project <name>", "Explicit project name")
    .action(async (key: string, options: { limit: string; project?: string; scope?: string }) => {
      const requester = getProcessContext();

      try {
        const result = await invokeSensitiveRequest<{
          projectName: string;
          entries: Array<{ value: string; version: number; createdAt: number }>;
        }>({
          kind: "history",
          requestId: crypto.randomUUID(),
          projectName: options.project,
          cwd: process.cwd(),
          requester,
          key,
          scope: options.scope,
          limit: parseInt(options.limit, 10),
        });

        if (result.entries.length === 0) {
          console.log(`No history found for "${key}" in project "${result.projectName}".`);
          return;
        }

        console.log(`History for "${key}" [${result.projectName}]:\n`);
        for (const entry of result.entries) {
          const date = new Date(entry.createdAt * 1000).toISOString();
          console.log(`  v${entry.version}  ${date}  ${entry.value}`);
        }
      } catch (error) {
        console.error(formatSensitiveRequestError(error));
        process.exit(1);
      }
    });
}
