import type { EnvSpecEntry, ParsedEnvSpec, SchemaMetadata } from "../types/schema";
import type { SchemaRepository } from "../vault/schema-repo";
import type { SecretRepository } from "../vault/secret-repo";
import { type ValidationResult, validateValue } from "./validator";

export interface ResolvedEnvSpecEntry extends Omit<EnvSpecEntry, "required" | "sensitive"> {
  required: boolean;
  sensitive: boolean;
}

export interface SchemaValidationWarning {
  key: string;
  scope: string;
  message: string;
}

export interface BootstrapSecretsFromSchemaOptions {
  projectId: string;
  spec: ParsedEnvSpec;
  secretRepo: SecretRepository;
  schemaRepo: SchemaRepository;
  scope?: string;
  resolveValue?:
    | ((
        entry: ResolvedEnvSpecEntry,
      ) => string | null | undefined | Promise<string | null | undefined>)
    | undefined;
}

export interface BootstrapSecretsFromSchemaResult {
  created: number;
  metadataApplied: number;
  prompted: number;
  skipped: number;
  warnings: SchemaValidationWarning[];
}

export function findSchemaEntry(spec: ParsedEnvSpec, key: string): ResolvedEnvSpecEntry | null {
  const entry = spec.entries.find((candidate) => candidate.key === key);
  return entry ? resolveSchemaEntry(spec, entry) : null;
}

export function resolveSchemaEntry(spec: ParsedEnvSpec, entry: EnvSpecEntry): ResolvedEnvSpecEntry {
  return {
    ...entry,
    required: entry.required ?? spec.rootDecorators.defaultRequired !== false,
    sensitive: entry.sensitive ?? spec.rootDecorators.defaultSensitive ?? true,
  };
}

export function upsertSchemaMetadataFromEntry(
  schemaRepo: SchemaRepository,
  projectId: string,
  scope: string,
  entry: ResolvedEnvSpecEntry,
): SchemaMetadata {
  return schemaRepo.upsert(projectId, entry.key, scope, {
    typeName: entry.type?.name ?? null,
    typeParams: entry.type?.params ?? null,
    sensitive: entry.sensitive,
    required: entry.required,
    description: entry.description,
    example: entry.example,
    docsUrls: entry.docsUrls,
    defaultValue: entry.defaultValue,
  });
}

export function storedSchemaToResolvedEntry(entry: SchemaMetadata): ResolvedEnvSpecEntry {
  return {
    key: entry.key,
    defaultValue: entry.defaultValue,
    description: entry.description,
    type: entry.typeName
      ? {
          name: entry.typeName,
          params: entry.typeParams ?? {},
        }
      : null,
    sensitive: entry.sensitive,
    required: entry.required,
    example: entry.example,
    docsUrls: entry.docsUrls,
  };
}

export function validateValueAgainstSchemaEntry(
  value: string,
  entry: ResolvedEnvSpecEntry,
): ValidationResult {
  if (!entry.type) {
    return { valid: true };
  }

  return validateValue(value, entry.type);
}

export async function bootstrapSecretsFromSchema(
  options: BootstrapSecretsFromSchemaOptions,
): Promise<BootstrapSecretsFromSchemaResult> {
  const scope = options.scope ?? "default";
  let created = 0;
  let metadataApplied = 0;
  let prompted = 0;
  let skipped = 0;
  const warnings: SchemaValidationWarning[] = [];

  for (const rawEntry of options.spec.entries) {
    const entry = resolveSchemaEntry(options.spec, rawEntry);
    upsertSchemaMetadataFromEntry(options.schemaRepo, options.projectId, scope, entry);
    metadataApplied += 1;
    const existing = options.secretRepo.getByKey(entry.key, scope);

    if (existing) {
      const validation = validateValueAgainstSchemaEntry(existing.value, entry);
      if (!validation.valid) {
        warnings.push({
          key: entry.key,
          scope,
          message: validation.message ?? "Value does not satisfy schema validation.",
        });
      }
      continue;
    }

    let value = entry.defaultValue;
    if (value === null && options.resolveValue) {
      value = await options.resolveValue(entry);
      if (value !== undefined) {
        prompted += 1;
      }
    }

    if (value === null || value === undefined) {
      skipped += 1;
      continue;
    }

    options.secretRepo.create(entry.key, value, scope);
    created += 1;

    const validation = validateValueAgainstSchemaEntry(value, entry);
    if (!validation.valid) {
      warnings.push({
        key: entry.key,
        scope,
        message: validation.message ?? "Value does not satisfy schema validation.",
      });
    }
  }

  return {
    created,
    metadataApplied,
    prompted,
    skipped,
    warnings,
  };
}
