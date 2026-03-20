import {
  bootstrapSecretsFromSchema,
  ConfigRepository,
  getDatabase,
  ProjectManager,
  SchemaRepository,
  triggerAutoBackup,
} from "@cloakenv/core";
import type { Command } from "commander";
import { ensureAutoBackupPassphraseStored } from "../utils/backup-policy";
import { getAppContext } from "../utils/context";
import { confirm, prompt } from "../utils/prompt";
import { loadProjectSchema } from "../utils/schema";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new CloakEnv vault")
    .action(async () => {
      const db = getDatabase();
      const configRepo = new ConfigRepository(db);
      const projectManager = new ProjectManager(db);

      console.log("Initializing CloakEnv vault...");

      // Check if backup path is configured
      const backupPath = configRepo.get("backupPath");
      if (!backupPath) {
        console.log("\nCloakEnv requires a backup directory for your encrypted secrets.");
        console.log(
          "This can be a cloud-synced folder (Dropbox, iCloud, etc.) for automatic backup.\n",
        );

        const path = prompt("Enter backup directory path: ");
        if (path) {
          configRepo.set("backupPath", path);
          console.log(`Backup path set to: ${path}`);
        } else {
          console.error(
            "Backup path is required. Run 'cloakenv config backup-path <path>' or rerun init and provide a directory.",
          );
          process.exit(1);
        }
      }

      if (configRepo.get("autoBackup")) {
        await ensureAutoBackupPassphraseStored();
      }

      // Try to auto-detect and create project
      try {
        const project = projectManager.resolveOrCreate();
        console.log(`\nProject detected: ${project.name}`);
        console.log(`Path: ${project.path ?? "N/A"}`);

        const schema = loadProjectSchema({ projectPath: project.path, cwd: process.cwd() });
        if (schema) {
          console.log(`\nFound schema: ${schema.path}`);

          if (confirm("Bootstrap vault structure from this schema?", true)) {
            const ctx = await getAppContext({ projectName: project.name });
            const schemaRepo = new SchemaRepository(ctx.db);
            const result = await bootstrapSecretsFromSchema({
              projectId: ctx.project.id,
              spec: schema.spec,
              secretRepo: ctx.secretRepo,
              schemaRepo,
              resolveValue: (entry) => {
                if (!entry.required) {
                  return undefined;
                }

                const value = prompt(`Enter value for ${entry.key}: `);
                if (!value) {
                  console.warn(`Skipping ${entry.key}: no value provided.`);
                  return undefined;
                }

                return value;
              },
            });

            if (result.metadataApplied > 0) {
              await triggerAutoBackup(ctx.db, ctx.masterKey);
            }

            console.log(
              `Schema bootstrap complete: ${result.metadataApplied} schema entries stored, ${result.created} values created, ${result.skipped} left without stored values.`,
            );

            for (const warning of result.warnings) {
              console.warn(`Warning: ${warning.key} [${warning.scope}] — ${warning.message}`);
            }
          }
        }
      } catch {
        console.log("\nNo project detected. Create one with: cloakenv project create <name>");
      }

      console.log("\nVault initialized successfully!");
      console.log("Get started:");
      console.log("  cloakenv set API_KEY=your-secret-value");
      console.log("  cloakenv list");
      console.log("  cloakenv run -- npm run dev");
    });
}
