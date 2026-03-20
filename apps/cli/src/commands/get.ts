import { getProcessContext } from "@cloakenv/core";
import type { Command } from "commander";
import { formatSensitiveRequestError, invokeSensitiveRequest } from "../utils/approval-broker";

export function registerGetCommand(program: Command): void {
  program
    .command("get <key>")
    .description("Retrieve and display a single secret")
    .option("--scope <tag>", "Secret scope / environment")
    .option("--project <name>", "Explicit project name")
    .action(async (key: string, options: { project?: string; scope?: string }) => {
      const requester = getProcessContext();

      try {
        const result = await invokeSensitiveRequest<{ projectName: string; value: string }>({
          kind: "get",
          requestId: crypto.randomUUID(),
          projectName: options.project,
          cwd: process.cwd(),
          requester,
          key,
          scope: options.scope,
        });

        console.log(result.value);
      } catch (error) {
        console.error(formatSensitiveRequestError(error));
        process.exit(1);
      }
    });
}
