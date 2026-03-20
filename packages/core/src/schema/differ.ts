import type { ParsedEnvSpec, SchemaDiffEntry } from "../types/schema";

/**
 * Compare vault entries against a parsed .env.schema file.
 * Returns entries that are missing, extra, or changed.
 */
export function diffSchema(
  vaultKeys: Array<{ key: string; scope: string }>,
  schema: ParsedEnvSpec,
  scope = "default",
): SchemaDiffEntry[] {
  const diffs: SchemaDiffEntry[] = [];
  const schemaKeys = new Set(schema.entries.map((entry) => `${scope}:${entry.key}`));
  const vaultKeySet = new Set(vaultKeys.map((entry) => `${entry.scope}:${entry.key}`));

  // Keys in schema but not in vault = "missing"
  for (const entry of schema.entries) {
    if (!vaultKeySet.has(`${scope}:${entry.key}`)) {
      diffs.push({
        key: entry.key,
        scope,
        type: "missing",
        details: "Defined in schema but not in vault",
      });
    }
  }

  // Keys in vault but not in schema = "extra"
  for (const entry of vaultKeys) {
    if (!schemaKeys.has(`${entry.scope}:${entry.key}`)) {
      diffs.push({
        key: entry.key,
        scope: entry.scope,
        type: "extra",
        details: "In vault but not defined in schema",
      });
    }
  }

  return diffs;
}
