import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { Subprocess } from "bun";

export interface SpawnOptions {
  command: string[];
  env: Record<string, string>;
  cwd?: string;
  launcherPath?: string;
}

export interface CreateSpawnEnvironmentOptions {
  cwd?: string;
  baseEnv?: NodeJS.ProcessEnv;
  injectedEnv: Record<string, string>;
  launcherPath?: string;
}

export function createSpawnEnvironment(options: CreateSpawnEnvironmentOptions): NodeJS.ProcessEnv {
  const cwd = options.cwd ?? process.cwd();
  const baseEnv = options.baseEnv ?? process.env;
  const env = { ...baseEnv, ...options.injectedEnv };
  const pathKey = getPathEnvKey(env);
  const workspaceBinPaths = collectWorkspaceBinPaths(cwd);
  const pathValue = getRunPathValue(env, options.injectedEnv, options.launcherPath);

  if (workspaceBinPaths.length === 0 && pathValue === env[pathKey]) {
    return env;
  }

  const pathEntries = [
    ...workspaceBinPaths,
    ...(pathValue ? pathValue.split(delimiter).filter(Boolean) : []),
  ];

  return {
    ...env,
    [pathKey]: dedupePathEntries(pathEntries).join(delimiter),
  };
}

/**
 * Spawn a child process with secrets injected as environment variables.
 * The child inherits stdio for interactive use.
 */
export function spawnWithSecrets(options: SpawnOptions): Subprocess {
  return Bun.spawn(options.command, {
    env: createSpawnEnvironment({
      cwd: options.cwd,
      baseEnv: process.env,
      injectedEnv: options.env,
      launcherPath: options.launcherPath,
    }),
    stdio: ["inherit", "inherit", "inherit"],
    cwd: options.cwd ?? process.cwd(),
  });
}

function getRunPathValue(
  env: NodeJS.ProcessEnv,
  injectedEnv: Record<string, string>,
  launcherPath?: string,
): string | undefined {
  const injectedPath = getPathEnvValue(injectedEnv);
  if (injectedPath !== undefined) {
    return injectedPath;
  }

  if (launcherPath !== undefined) {
    return launcherPath;
  }

  return getPathEnvValue(env);
}

function collectWorkspaceBinPaths(startDir: string): string[] {
  const binPaths: string[] = [];
  let currentDir = resolve(startDir);

  while (true) {
    const binPath = join(currentDir, "node_modules", ".bin");
    if (existsSync(binPath)) {
      binPaths.push(binPath);
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return binPaths;
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const isCaseInsensitive = process.platform === "win32";

  return entries.filter((entry) => {
    const normalized = isCaseInsensitive ? entry.toLowerCase() : entry;
    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function getPathEnvKey(env: NodeJS.ProcessEnv | Record<string, string>): string {
  if (process.platform !== "win32") {
    return "PATH";
  }

  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function getPathEnvValue(env: NodeJS.ProcessEnv | Record<string, string>): string | undefined {
  return env[getPathEnvKey(env)];
}
