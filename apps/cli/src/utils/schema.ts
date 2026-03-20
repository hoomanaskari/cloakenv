import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedEnvSpec } from "@cloakenv/core";
import { parseEnvSpec } from "@cloakenv/core";

export function loadSchemaFromFile(filePath: string): { path: string; spec: ParsedEnvSpec } {
  const resolvedPath = resolve(filePath);
  return {
    path: resolvedPath,
    spec: parseEnvSpec(readFileSync(resolvedPath, "utf8")),
  };
}

export function loadProjectSchema(options: {
  projectPath?: string | null;
  cwd?: string;
}): { path: string; spec: ParsedEnvSpec } | null {
  const candidates = new Set<string>();

  if (options.projectPath) {
    candidates.add(resolve(join(options.projectPath, ".env.schema")));
  }

  candidates.add(resolve(options.cwd ?? process.cwd(), ".env.schema"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return loadSchemaFromFile(candidate);
    }
  }

  return null;
}
