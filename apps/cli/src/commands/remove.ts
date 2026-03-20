import { getProcessContext, triggerAutoBackup } from "@cloakenv/core";
import type { Command } from "commander";
import { getAppContext } from "../utils/context";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove <key>")
    .description("Delete a secret from the vault (retained in history for 30 days)")
    .option("--project <name>", "Explicit project name")
    .action(async (key: string, options: { project?: string }) => {
      const ctx = await getAppContext({ projectName: options.project });
      const removed = ctx.secretRepo.remove(key);

      if (!removed) {
        console.error(`Secret "${key}" not found in project "${ctx.project.name}".`);
        process.exit(1);
      }

      console.log(`Removed: ${key} [${ctx.project.name}] (retained in history for 30 days)`);

      const processCtx = getProcessContext();
      ctx.auditRepo.log({
        projectId: ctx.project.id,
        action: "delete",
        keyName: key,
        ...processCtx,
      });

      await triggerAutoBackup(ctx.db, ctx.masterKey);
    });
}
