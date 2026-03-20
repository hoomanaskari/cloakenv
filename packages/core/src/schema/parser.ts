import {
  type ParsedEnvSpecConfigItem,
  type ParsedEnvSpecDecorator,
  type ParsedEnvSpecFile,
  ParsedEnvSpecFunctionCall,
  ParsedEnvSpecStaticValue,
  parseEnvSpecDotEnvFile,
} from "@env-spec/parser";
import type {
  EnvSpecEntry,
  EnvSpecRootDecorators,
  EnvSpecType,
  ParsedEnvSpec,
} from "../types/schema";

const ROOT_DECORATOR_NAMES = new Set(["defaultSensitive", "defaultRequired", "currentEnv"]);

interface LegacyRootDecorator {
  line: number;
  name: string;
  value?: string;
}

/**
 * Parse an @env-spec format file content into structured data.
 * Uses the official parser, then normalizes into CloakEnv's lightweight schema shape.
 */
export function parseEnvSpec(content: string): ParsedEnvSpec {
  const file = parseEnvSpecDotEnvFile(content);
  const legacyRootDecorators = collectLegacyRootDecorators(content);
  const legacyRootLines = new Set(legacyRootDecorators.map((decorator) => decorator.line));
  const rootDecorators = readRootDecorators(file, legacyRootDecorators, legacyRootLines);
  const entries = file.configItems.map((item) => buildEntry(item, rootDecorators, legacyRootLines));

  return { rootDecorators, entries };
}

function collectLegacyRootDecorators(content: string): LegacyRootDecorator[] {
  const lines = content.split("\n");
  const decorators: LegacyRootDecorator[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith("#")) {
      break;
    }

    const comment = line.slice(1).trim();
    if (!comment.startsWith("@")) {
      break;
    }

    const match = comment.match(/^@(\w+)/);
    if (!match || !ROOT_DECORATOR_NAMES.has(match[1])) {
      break;
    }

    decorators.push({
      line: index + 1,
      name: match[1],
      value: readLegacyDecoratorValue(comment),
    });
  }

  return decorators;
}

function readRootDecorators(
  file: ParsedEnvSpecFile,
  legacyRootDecorators: LegacyRootDecorator[],
  legacyRootLines: Set<number>,
): EnvSpecRootDecorators {
  const root: EnvSpecRootDecorators = {};
  const seen = new Set<string>();

  for (const decorator of file.decoratorsArray) {
    applyRootDecorator(root, decorator);
    seen.add(decorator.name);
  }

  for (const decorator of legacyRootDecorators) {
    if (seen.has(decorator.name)) {
      continue;
    }

    applyLegacyRootDecorator(root, decorator);
    seen.add(decorator.name);
  }

  if (legacyRootLines.size === 0 || seen.size === ROOT_DECORATOR_NAMES.size) {
    return root;
  }

  for (const item of file.configItems) {
    for (const decorator of item.decoratorsArray) {
      if (!isDecoratorOnLines(decorator, legacyRootLines)) {
        continue;
      }
      if (!ROOT_DECORATOR_NAMES.has(decorator.name) || seen.has(decorator.name)) {
        continue;
      }

      applyRootDecorator(root, decorator);
      seen.add(decorator.name);
    }
  }

  return root;
}

function applyRootDecorator(root: EnvSpecRootDecorators, decorator: ParsedEnvSpecDecorator): void {
  const value = normalizeDecoratorValue(decorator);

  switch (decorator.name) {
    case "defaultSensitive":
      root.defaultSensitive = value === undefined ? true : value === true || value === "true";
      break;
    case "defaultRequired":
      if (value === "infer") {
        root.defaultRequired = "infer";
      } else {
        root.defaultRequired = value === undefined ? true : value === true || value === "true";
      }
      break;
    case "currentEnv":
      root.currentEnv = value === undefined ? undefined : String(value);
      break;
  }
}

function applyLegacyRootDecorator(
  root: EnvSpecRootDecorators,
  decorator: LegacyRootDecorator,
): void {
  switch (decorator.name) {
    case "defaultSensitive":
      root.defaultSensitive = decorator.value === undefined ? true : decorator.value === "true";
      break;
    case "defaultRequired":
      if (decorator.value === "infer") {
        root.defaultRequired = "infer";
      } else {
        root.defaultRequired = decorator.value === undefined ? true : decorator.value === "true";
      }
      break;
    case "currentEnv":
      root.currentEnv = decorator.value;
      break;
  }
}

function buildEntry(
  item: ParsedEnvSpecConfigItem,
  rootDefaults: EnvSpecRootDecorators,
  legacyRootLines: Set<number>,
): EnvSpecEntry {
  const entry: EnvSpecEntry = {
    key: item.key,
    defaultValue: readDefaultValue(item),
    description: item.description || null,
    type: null,
    sensitive: rootDefaults.defaultSensitive ?? null,
    required: null,
    example: null,
    docsUrls: [],
  };

  for (const decorator of item.decoratorsArray) {
    if (
      isDecoratorOnLines(decorator, legacyRootLines) &&
      ROOT_DECORATOR_NAMES.has(decorator.name)
    ) {
      continue;
    }

    handleDecorator(decorator, entry);
  }

  return entry;
}

function readDefaultValue(item: ParsedEnvSpecConfigItem): string | null {
  if (!item.value) {
    return null;
  }

  if (item.value instanceof ParsedEnvSpecStaticValue) {
    if (item.value.value === undefined || item.value.value === null) {
      return null;
    }
    return String(item.value.value);
  }

  if (item.value instanceof ParsedEnvSpecFunctionCall) {
    return item.value.toString();
  }

  return item.value.toString();
}

function handleDecorator(decorator: ParsedEnvSpecDecorator, entry: EnvSpecEntry): void {
  const value = normalizeDecoratorValue(decorator);

  switch (decorator.name) {
    case "type":
      entry.type = parseType(decorator.data.value?.toString() ?? String(value ?? "string"));
      break;
    case "sensitive":
      entry.sensitive = value === undefined ? true : value === true || value === "true";
      break;
    case "public":
      entry.sensitive = false;
      break;
    case "required":
      entry.required = true;
      break;
    case "optional":
      entry.required = false;
      break;
    case "example":
      entry.example = value === undefined ? null : String(value);
      break;
    case "docs":
    case "docsUrl":
      if (value !== undefined && value !== null) {
        entry.docsUrls.push(String(value));
      }
      break;
  }
}

function normalizeDecoratorValue(decorator: ParsedEnvSpecDecorator): unknown {
  if (!decorator.data.value) {
    return undefined;
  }

  if (decorator.data.value instanceof ParsedEnvSpecStaticValue) {
    return decorator.data.value.value;
  }

  return decorator.simplifiedValue ?? decorator.data.value.toString();
}

function isDecoratorOnLines(decorator: ParsedEnvSpecDecorator, lines: Set<number>): boolean {
  const line = decorator.data._location?.start?.line;
  return typeof line === "number" && lines.has(line);
}

function readLegacyDecoratorValue(comment: string): string | undefined {
  const eqIndex = comment.indexOf("=");
  if (eqIndex === -1) {
    return undefined;
  }

  return comment.slice(eqIndex + 1).trim();
}

/**
 * Parse a type declaration like "string(startsWith=sk_)" or "enum(a, b, c)" or "url"
 */
function parseType(raw: string): EnvSpecType {
  const parenMatch = raw.match(/^(\w+)\((.+)\)$/);

  if (!parenMatch) {
    return { name: raw.trim(), params: {} };
  }

  const [, typeName, paramsStr] = parenMatch;
  const params: Record<string, string> = {};

  const parts = splitParams(paramsStr);
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1) {
      const key = part.substring(0, eqIndex).trim();
      const value = part
        .substring(eqIndex + 1)
        .trim()
        .replace(/^["'`]|["'`]$/g, "");
      params[key] = value;
      continue;
    }

    const trimmed = part.trim().replace(/^["'`]|["'`]$/g, "");
    params[trimmed] = "true";
  }

  return { name: typeName, params };
}

function splitParams(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) {
        inQuote = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
