import { getProcessContext } from "@cloakenv/core";
import type { Command } from "commander";
import { formatSensitiveRequestError, invokeSensitiveRequest } from "../utils/approval-broker";
import { getAppContext } from "../utils/context";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List all secret key names for the current project")
    .option("--scope <tag>", "Filter by scope tag")
    .option("--project <name>", "Explicit project name")
    .option("--show-values", "Also display values (requires auth)")
    .action(async (options: { scope?: string; project?: string; showValues?: boolean }) => {
      if (options.showValues) {
        const requester = getProcessContext();

        try {
          const result = await invokeSensitiveRequest<{
            projectName: string;
            secrets: Array<{ key: string; value: string; scope: string }>;
          }>({
            kind: "list_values",
            requestId: crypto.randomUUID(),
            projectName: options.project,
            cwd: process.cwd(),
            requester,
            scope: options.scope,
          });

          if (result.secrets.length === 0) {
            console.log(`No secrets found in project "${result.projectName}".`);
            return;
          }

          const maxKeyLen = Math.max(...result.secrets.map((secret) => secret.key.length));
          for (const secret of result.secrets) {
            const scopeTag = secret.scope !== "default" ? ` [${secret.scope}]` : "";
            console.log(`${secret.key.padEnd(maxKeyLen)}  ${secret.value}${scopeTag}`);
          }
        } catch (error) {
          console.error(formatSensitiveRequestError(error));
          process.exit(1);
        }
      } else {
        const ctx = await getAppContext({ projectName: options.project });
        const list = ctx.secretRepo.list();
        if (list.length === 0) {
          console.log(`No secrets found in project "${ctx.project.name}".`);
          return;
        }

        const filtered = options.scope ? list.filter((s) => s.scope === options.scope) : list;

        console.log(`Secrets in "${ctx.project.name}" (${filtered.length}):\n`);
        for (const s of filtered) {
          const scopeTag = s.scope !== "default" ? ` [${s.scope}]` : "";
          console.log(`  ${s.key}${scopeTag}`);
        }
      }
    });
}
