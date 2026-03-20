import { writeFileSync } from "node:fs";
import {
  bootstrapSecretsFromSchema,
  diffSchema,
  SchemaRepository,
  serializeEnvSpec,
  storedSchemaToResolvedEntry,
  triggerAutoBackup,
  validateValueAgainstSchemaEntry,
} from "@cloakenv/core";
import type { Command } from "commander";
import { ensureAutoBackupReady, ensureBackupPathConfigured } from "../utils/backup-policy";
import { getAppContext } from "../utils/context";
import { prompt } from "../utils/prompt";
import { loadSchemaFromFile } from "../utils/schema";

export function registerSchemaCommand(program: Command): void {
  const schema = program.command("schema").description("Manage @env-spec schema files");

  schema
    .command("export")
    .description("Generate a .env.schema file from the current project's vault")
    .option("--project <name>", "Explicit project name")
    .option("--output <path>", "Output file path", ".env.schema")
    .action(async (options: { project?: string; output: string }) => {
      const ctx = await getAppContext({ projectName: options.project });
      const schemaRepo = new SchemaRepository(ctx.db);
      const secrets = ctx.secretRepo.getAllDecrypted();
      const schemaEntries = schemaRepo.listByProject(ctx.project.id);
      const secretValueMap = new Map(
        secrets.map((secret) => [`${secret.scope}:${secret.key}`, secret.value]),
      );
      const secretMap = new Map(
        secrets.map((secret) => [
          `${secret.scope}:${secret.key}`,
          {
            key: secret.key,
            defaultValue: null,
            sensitive: true,
            schema: null,
          },
        ]),
      );

      for (const schemaEntry of schemaEntries) {
        secretMap.set(`${schemaEntry.scope}:${schemaEntry.key}`, {
          key: schemaEntry.key,
          defaultValue:
            schemaEntry.defaultValue ??
            (schemaEntry.sensitive === false
              ? (secretValueMap.get(`${schemaEntry.scope}:${schemaEntry.key}`) ?? null)
              : null),
          sensitive: schemaEntry.sensitive,
          schema: schemaEntry,
        });
      }

      const entries = Array.from(secretMap.values()).sort((left, right) =>
        left.key.localeCompare(right.key),
      );

      const content = serializeEnvSpec(entries, { defaultSensitive: true });
      writeFileSync(options.output, content);
      console.log(`Schema exported to: ${options.output} (${entries.length} entries)`);
    });

  schema
    .command("import")
    .description("Bootstrap vault structure from an existing .env.schema file")
    .option("--file <path>", "Schema file path", ".env.schema")
    .option("--project <name>", "Explicit project name")
    .action(async (options: { file: string; project?: string }) => {
      const ctx = await getAppContext({ projectName: options.project });
      ensureBackupPathConfigured(ctx.configRepo);
      await ensureAutoBackupReady(ctx.configRepo);
      const schemaRepo = new SchemaRepository(ctx.db);
      const schema = loadSchemaFromFile(options.file);
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
        `Schema imported from ${schema.path}: ${result.metadataApplied} schema entries stored, ${result.created} values created, ${result.skipped} left without stored values.`,
      );

      for (const warning of result.warnings) {
        console.warn(`Warning: ${warning.key} [${warning.scope}] — ${warning.message}`);
      }
    });

  schema
    .command("diff")
    .description("Compare vault structure against .env.schema file")
    .option("--file <path>", "Schema file path", ".env.schema")
    .option("--project <name>", "Explicit project name")
    .action(async (options: { file: string; project?: string }) => {
      const ctx = await getAppContext({ projectName: options.project });
      const schemaRepo = new SchemaRepository(ctx.db);
      const schema = loadSchemaFromFile(options.file);
      const spec = schema.spec;
      const storedEntries = schemaRepo.listByProject(ctx.project.id);

      if (storedEntries.length === 0) {
        console.log("No stored schema entries found. Import a schema first.");
        return;
      }

      const diffs = diffSchema(
        storedEntries.map((entry) => ({ key: entry.key, scope: entry.scope })),
        spec,
        spec.rootDecorators.currentEnv ?? "default",
      );

      if (diffs.length === 0) {
        console.log("Stored schema and file schema are in sync.");
        return;
      }

      console.log(`Found ${diffs.length} differences:\n`);
      for (const d of diffs) {
        const icon = d.type === "missing" ? "-" : d.type === "extra" ? "+" : "~";
        const scopeTag = d.scope !== "default" ? ` [${d.scope}]` : "";
        console.log(`  ${icon} ${d.key}${scopeTag}: ${d.details}`);
      }
    });

  schema
    .command("validate")
    .description("Validate current vault values against schema type definitions")
    .option("--project <name>", "Explicit project name")
    .action(async (options: { project?: string }) => {
      const ctx = await getAppContext({ projectName: options.project });
      const schemaRepo = new SchemaRepository(ctx.db);
      const schemaEntries = schemaRepo.listByProject(ctx.project.id);

      if (schemaEntries.length === 0) {
        console.log("No stored schema entries found.");
        return;
      }

      let warnings = 0;
      for (const entry of schemaEntries) {
        const secret = ctx.secretRepo.getByKey(entry.key, entry.scope);

        if (!secret) {
          if (entry.required) {
            console.log(`  Warning: ${entry.key} [${entry.scope}] — Required value is missing.`);
            warnings++;
          }
          continue;
        }

        const result = validateValueAgainstSchemaEntry(
          secret.value,
          storedSchemaToResolvedEntry(entry),
        );

        if (!result.valid) {
          console.log(`  Warning: ${entry.key} [${entry.scope}] — ${result.message}`);
          warnings++;
        }
      }

      if (warnings === 0) {
        console.log("All secrets pass schema validation.");
      } else {
        console.log(`\n${warnings} validation warning(s) found.`);
      }
    });
}
