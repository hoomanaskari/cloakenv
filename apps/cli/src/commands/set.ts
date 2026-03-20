import type { Database } from "bun:sqlite";
import {
  EnvironmentRepository,
  findSchemaEntry,
  getProcessContext,
  SchemaRepository,
  storedSchemaToResolvedEntry,
  triggerAutoBackup,
  upsertSchemaMetadataFromEntry,
  validateValueAgainstSchemaEntry,
} from "@cloakenv/core";
import type { Command } from "commander";
import { ensureAutoBackupReady, ensureBackupPathConfigured } from "../utils/backup-policy";
import { getAppContext } from "../utils/context";
import { loadProjectSchema } from "../utils/schema";

export function registerSetCommand(program: Command): void {
  program
    .command("set <key_value>")
    .description("Store or update an encrypted secret (KEY=value)")
    .option("--scope <tag>", "Scope tag for access control")
    .option("--project <name>", "Explicit project name")
    .action(async (keyValue: string, options: { scope?: string; project?: string }) => {
      const eqIndex = keyValue.indexOf("=");
      if (eqIndex === -1) {
        console.error("Usage: cloakenv set KEY=value");
        process.exit(1);
      }

      const key = keyValue.substring(0, eqIndex).trim();
      const value = keyValue.substring(eqIndex + 1);

      if (!key) {
        console.error("Key name cannot be empty.");
        process.exit(1);
      }

      const ctx = await getAppContext({ projectName: options.project });
      const scope = resolveCliScope(
        ctx.db,
        ctx.project.id,
        options.scope ?? ctx.project.defaultScope,
      );
      ensureBackupPathConfigured(ctx.configRepo);
      await ensureAutoBackupReady(ctx.configRepo);
      const schemaRepo = new SchemaRepository(ctx.db);
      const storedSchemaEntry = schemaRepo.getByKey(ctx.project.id, key, scope);
      const hasStoredSchema = schemaRepo.hasEntries(ctx.project.id);
      const schema = hasStoredSchema
        ? null
        : loadProjectSchema({ projectPath: ctx.project.path, cwd: process.cwd() });
      const schemaEntry = storedSchemaEntry
        ? storedSchemaToResolvedEntry(storedSchemaEntry)
        : schema
          ? findSchemaEntry(schema.spec, key)
          : null;

      // Check if key exists (update vs create)
      const existing = ctx.secretRepo.getByKey(key, scope);

      if (schemaEntry) {
        const validation = validateValueAgainstSchemaEntry(value, schemaEntry);
        if (!validation.valid) {
          console.warn(
            `Warning: ${key} does not satisfy schema validation${
              schema?.path ? ` (${schema.path})` : ""
            }: ${validation.message ?? "Invalid value."}`,
          );
        }
      }

      const result = existing
        ? ctx.secretRepo.update(key, value, scope)
        : ctx.secretRepo.create(key, value, scope);

      if (existing) {
        console.log(`Updated: ${key} (v${existing.version + 1}) [${ctx.project.name}]`);
      } else {
        console.log(`Created: ${key} [${ctx.project.name}]`);
      }

      if (result && schemaEntry) {
        upsertSchemaMetadataFromEntry(schemaRepo, ctx.project.id, scope, schemaEntry);
      }

      // Audit log
      const processCtx = getProcessContext();
      ctx.auditRepo.log({
        projectId: ctx.project.id,
        action: "write",
        keyName: key,
        ...processCtx,
      });

      await triggerAutoBackup(ctx.db, ctx.masterKey);
    });
}

function resolveCliScope(db: Database, projectId: string, requestedScope: string): string {
  const normalized = requestedScope.trim() || "default";
  const environmentRepo = new EnvironmentRepository(db);
  if (environmentRepo.getByName(projectId, normalized)) {
    return normalized;
  }

  if (normalized === ".env") {
    const legacyDefaultEnvironment = environmentRepo.getByName(projectId, "default");
    if (legacyDefaultEnvironment?.sourceFile?.trim() === ".env") {
      return "default";
    }
  }

  return normalized;
}
