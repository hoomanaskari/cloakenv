#!/usr/bin/env node

import { resolve } from "node:path";
import { resolveVarlockSecret } from "./index.js";

async function main(argv: string[]): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  if (parsed.command !== "get" || !parsed.key) {
    printUsage();
    process.exit(1);
  }

  try {
    const result = await resolveVarlockSecret(parsed.key, {
      cwd: parsed.cwd ? resolve(parsed.cwd) : process.cwd(),
      projectName: parsed.projectName,
      scope: parsed.scope,
      scopeEnv: parsed.scopeEnv,
    });

    process.stdout.write(`${result.value}\n`);
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exit(1);
  }
}

interface ParsedArgs {
  command?: string;
  cwd?: string;
  help?: boolean;
  key?: string;
  projectName?: string;
  scope?: string;
  scopeEnv: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    scopeEnv: [],
  };

  const args = [...argv];
  if (args[0] === "--help" || args[0] === "-h") {
    parsed.help = true;
    return parsed;
  }

  parsed.command = args.shift();

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      return parsed;
    }

    if (token === "--project") {
      parsed.projectName = requireValue(args.shift(), token);
      continue;
    }

    if (token === "--scope") {
      parsed.scope = requireValue(args.shift(), token);
      continue;
    }

    if (token === "--scope-env") {
      parsed.scopeEnv.push(requireValue(args.shift(), token));
      continue;
    }

    if (token === "--cwd") {
      parsed.cwd = requireValue(args.shift(), token);
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (!parsed.key) {
      parsed.key = token;
      continue;
    }

    throw new Error(`Unexpected argument: ${token}`);
  }

  return parsed;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  cloakenv-varlock get <KEY> [--project <name>] [--scope <tag>] [--scope-env <ENV_VAR>] [--cwd <dir>]",
      "",
      "Examples:",
      "  cloakenv-varlock get API_KEY --scope development",
      "  cloakenv-varlock get API_KEY --scope ${APP_ENV}",
      "  cloakenv-varlock get API_KEY --scope-env APP_ENV",
    ].join("\n"),
  );
  process.stdout.write("\n");
}

function formatCliError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  switch (code) {
    case "approval_denied":
      return "Request denied in CloakEnv desktop.";
    default:
      return error.message;
  }
}

await main(process.argv.slice(2));
