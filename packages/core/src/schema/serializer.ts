import type { SchemaMetadata } from "../types/schema";

interface SerializableEntry {
  key: string;
  defaultValue: string | null;
  sensitive: boolean;
  schema: SchemaMetadata | null;
}

/**
 * Generate an @env-spec format .env.schema file from vault data.
 * Secret values are NOT included — only key names and metadata.
 */
export function serializeEnvSpec(
  entries: SerializableEntry[],
  options?: { defaultSensitive?: boolean },
): string {
  const lines: string[] = [];

  // Root decorators
  if (options?.defaultSensitive !== undefined) {
    lines.push(`# @defaultSensitive=${options.defaultSensitive}`);
  }
  lines.push("# @defaultRequired=infer");
  lines.push("");

  for (const entry of entries) {
    const meta = entry.schema;

    // Description
    if (meta?.description) {
      lines.push(`# ${meta.description}`);
    }

    // Type decorator
    if (meta?.typeName) {
      const typeStr =
        meta.typeParams && Object.keys(meta.typeParams).length > 0
          ? `${meta.typeName}(${formatTypeParams(meta.typeParams)})`
          : meta.typeName;
      lines.push(`# @type=${typeStr}`);
    }

    // Sensitivity
    if (meta?.sensitive !== undefined) {
      lines.push(`# @sensitive=${meta.sensitive}`);
    }

    // Required
    if (meta?.required !== undefined) {
      lines.push(meta.required ? "# @required" : "# @optional");
    }

    // Example
    if (meta?.example) {
      lines.push(`# @example=${meta.example}`);
    }

    // Docs
    if (meta?.docsUrls) {
      for (const url of meta.docsUrls) {
        lines.push(`# @docs(${url})`);
      }
    }

    // KEY=default_value (omit value for sensitive entries)
    const value = entry.sensitive ? "" : (entry.defaultValue ?? "");
    lines.push(`${entry.key}=${value}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatTypeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
