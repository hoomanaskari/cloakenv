import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

const PROVIDER_PROTOCOL = "cloakenv-provider";
const PROVIDER_PROTOCOL_VERSION = 1;
const WINDOWS_PROVIDER_PIPE = "\\\\.\\pipe\\cloakenv-provider";
const PROVIDER_ENDPOINT_ENV_VAR = "CLOAKENV_PROVIDER_ENDPOINT";
const BROKER_ENDPOINT_ENV_VAR = "CLOAKENV_APPROVAL_BROKER_ENDPOINT";
const CACHE_DIR_ENV_VAR = "CLOAKENV_VARLOCK_CACHE_DIR";
const CACHE_DIR_NAME = "cloakenv-varlock-helper";
const CACHE_RECORD_VERSION = 1;
const CACHE_MAX_AGE_MS = 15 * 60_000;
const LOCK_MAX_AGE_MS = 30_000;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const LOCK_WAIT_INTERVAL_MS = 50;
const GENERIC_SHELL_NAMES = new Set(["bash", "dash", "fish", "pwsh", "sh", "zsh"]);

export interface BrokerRequesterInfo {
  argv: string[];
  hasTty: boolean;
  processName: string;
  processPid: number;
}

export interface ResolveVarlockSecretOptions {
  cwd?: string;
  projectName?: string;
  requestId?: string;
  requester?: Partial<BrokerRequesterInfo>;
  scope?: string;
  scopeEnv?: string | string[];
}

export interface ResolvedVarlockEnvironment {
  env: Record<string, string>;
  projectId?: string;
  projectName: string;
  requester: BrokerRequesterInfo;
}

export interface ResolvedVarlockSecret {
  projectName: string;
  requester: BrokerRequesterInfo;
  value: string;
}

interface ResolveEnvironmentProviderRequest {
  cwd: string;
  kind: "resolve_environment";
  projectName?: string;
  requestId: string;
  requester?: BrokerRequesterInfo;
  scope?: string;
}

interface ProviderRequestEnvelope {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "request";
  request: ResolveEnvironmentProviderRequest;
}

interface ProviderSuccessResponse<T> {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "response";
  requestId: string;
  ok: true;
  data: T;
}

interface ProviderErrorResponse {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

type ProviderServerMessage<T> = ProviderErrorResponse | ProviderSuccessResponse<T>;

interface CachedEnvironmentRecord {
  createdAt: number;
  cwd: string;
  env: Record<string, string>;
  projectId?: string;
  projectName: string;
  runRootCommand: string;
  runRootPid: number;
  scope: string;
  version: number;
}

interface RunCacheContext {
  cachePath: string;
  cwd: string;
  lockPath: string;
  runRootCommand: string;
  runRootPid: number;
}

interface ProcessSnapshot {
  command: string;
  pid: number;
  ppid: number;
  processName: string;
}

interface RunContext {
  processName?: string;
  processPid?: number;
  runRootCommand: string;
  runRootPid: number;
  argv?: string[];
}

export async function resolveVarlockEnvironment(
  options: ResolveVarlockSecretOptions = {},
): Promise<ResolvedVarlockEnvironment> {
  const cwd = options.cwd ?? process.cwd();
  const scope = resolveScope(options.scope, options.scopeEnv);
  const runContext = detectRunContext();
  const requester = buildRequester(options.requester, runContext);
  const cacheContext = createRunCacheContext({
    cwd,
    projectName: options.projectName,
    runRootCommand: runContext.runRootCommand,
    runRootPid: runContext.runRootPid,
    scope,
  });

  pruneCacheArtifacts();

  const cached = await resolveCachedEnvironment(cacheContext, async () => {
    return invokeProviderResolveEnvironment({
      kind: "resolve_environment",
      requestId: options.requestId ?? crypto.randomUUID(),
      projectName: options.projectName,
      cwd,
      requester,
      scope,
    });
  });

  return {
    ...cached,
    requester,
  };
}

export async function resolveVarlockSecret(
  key: string,
  options: ResolveVarlockSecretOptions = {},
): Promise<ResolvedVarlockSecret> {
  const resolved = await resolveVarlockEnvironment(options);
  if (!Object.hasOwn(resolved.env, key)) {
    throw new Error(
      `Resolved environment for project "${resolved.projectName}" does not include "${key}".`,
    );
  }

  return {
    projectName: resolved.projectName,
    requester: resolved.requester,
    value: resolved.env[key] ?? "",
  };
}

function resolveScope(explicitScope?: string, scopeEnv?: string | string[]): string | undefined {
  if (explicitScope?.trim()) {
    return explicitScope.trim();
  }

  const envNames = Array.isArray(scopeEnv)
    ? scopeEnv
    : typeof scopeEnv === "string"
      ? [scopeEnv]
      : ["CLOAKENV_SCOPE"];

  for (const envName of envNames) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function buildRequester(
  override?: Partial<BrokerRequesterInfo>,
  detected?: Partial<BrokerRequesterInfo>,
): BrokerRequesterInfo {
  const context = getProcessContext();
  return {
    processName: override?.processName ?? detected?.processName ?? context.processName,
    processPid: override?.processPid ?? detected?.processPid ?? context.processPid,
    argv: override?.argv ?? detected?.argv ?? context.argv,
    hasTty: override?.hasTty ?? detected?.hasTty ?? context.hasTty,
  };
}

async function resolveCachedEnvironment(
  context: RunCacheContext,
  load: () => Promise<{ env: Record<string, string>; projectId?: string; projectName: string }>,
): Promise<{ env: Record<string, string>; projectId?: string; projectName: string }> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  while (true) {
    const cached = readCachedEnvironment(context);
    if (cached) {
      return cached;
    }

    const lockFd = tryAcquireLock(context.lockPath);
    if (lockFd !== null) {
      try {
        const alreadyResolved = readCachedEnvironment(context);
        if (alreadyResolved) {
          return alreadyResolved;
        }

        const resolved = await load();
        writeCachedEnvironment(context, resolved);
        return resolved;
      } finally {
        releaseLock(lockFd, context.lockPath);
      }
    }

    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the CloakEnv Varlock environment cache.");
    }

    await sleep(LOCK_WAIT_INTERVAL_MS);
  }
}

function createRunCacheContext(options: {
  cwd: string;
  projectName?: string;
  runRootCommand: string;
  runRootPid: number;
  scope?: string;
}): RunCacheContext {
  const cacheDir = getCacheDir();
  const cacheHash = createHash("sha256")
    .update(
      JSON.stringify({
        version: CACHE_RECORD_VERSION,
        cwd: options.cwd,
        projectName: options.projectName ?? "",
        runRootCommand: options.runRootCommand,
        runRootPid: options.runRootPid,
        scope: options.scope ?? "",
      }),
    )
    .digest("hex");

  return {
    cachePath: join(cacheDir, `${cacheHash}.json`),
    cwd: options.cwd,
    lockPath: join(cacheDir, `${cacheHash}.lock`),
    runRootCommand: options.runRootCommand,
    runRootPid: options.runRootPid,
  };
}

function getCacheDir(): string {
  const override = process.env[CACHE_DIR_ENV_VAR]?.trim();
  const dir = override || join(tmpdir(), CACHE_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function readCachedEnvironment(
  context: RunCacheContext,
): { env: Record<string, string>; projectId?: string; projectName: string } | null {
  try {
    const raw = readFileSync(context.cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedEnvironmentRecord>;

    if (
      parsed.version !== CACHE_RECORD_VERSION ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.projectName !== "string" ||
      !isStringRecord(parsed.env) ||
      typeof parsed.runRootPid !== "number" ||
      typeof parsed.runRootCommand !== "string"
    ) {
      rmSync(context.cachePath, { force: true });
      return null;
    }

    if (parsed.createdAt + CACHE_MAX_AGE_MS < Date.now()) {
      rmSync(context.cachePath, { force: true });
      return null;
    }

    if (parsed.runRootPid !== context.runRootPid) {
      rmSync(context.cachePath, { force: true });
      return null;
    }

    if (parsed.runRootCommand !== context.runRootCommand) {
      rmSync(context.cachePath, { force: true });
      return null;
    }

    if (!isProcessAlive(parsed.runRootPid)) {
      rmSync(context.cachePath, { force: true });
      return null;
    }

    return {
      env: parsed.env,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
      projectName: parsed.projectName,
    };
  } catch {
    return null;
  }
}

function writeCachedEnvironment(
  context: RunCacheContext,
  resolved: { env: Record<string, string>; projectId?: string; projectName: string },
): void {
  const tempPath = `${context.cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const payload: CachedEnvironmentRecord = {
    createdAt: Date.now(),
    cwd: context.cwd,
    env: resolved.env,
    projectId: resolved.projectId,
    projectName: resolved.projectName,
    runRootCommand: context.runRootCommand,
    runRootPid: context.runRootPid,
    scope: "",
    version: CACHE_RECORD_VERSION,
  };

  writeFileSync(tempPath, JSON.stringify(payload), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tempPath, context.cachePath);
}

function tryAcquireLock(lockPath: string): number | null {
  pruneStaleLock(lockPath);

  try {
    return openSync(lockPath, "wx", 0o600);
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "EEXIST") {
      return null;
    }

    throw error;
  }
}

function releaseLock(lockFd: number, lockPath: string): void {
  try {
    closeSync(lockFd);
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function pruneStaleLock(lockPath: string): void {
  try {
    const stats = statSync(lockPath);
    if (Date.now() - stats.mtimeMs > LOCK_MAX_AGE_MS) {
      rmSync(lockPath, { force: true });
    }
  } catch {}
}

function pruneCacheArtifacts(): void {
  const cacheDir = getCacheDir();
  for (const entry of readdirSync(cacheDir)) {
    const fullPath = join(cacheDir, entry);
    try {
      const stats = statSync(fullPath);
      const ageMs = Date.now() - stats.mtimeMs;

      if (entry.endsWith(".lock")) {
        if (ageMs > LOCK_MAX_AGE_MS) {
          rmSync(fullPath, { force: true });
        }
        continue;
      }

      if (!entry.endsWith(".json") || ageMs <= CACHE_MAX_AGE_MS) {
        continue;
      }

      rmSync(fullPath, { force: true });
    } catch {}
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = getErrorCode(error);
    return code === "EPERM";
  }
}

function detectRunContext(): RunContext {
  const ancestry = getProcessAncestry(process.ppid);
  const preferred =
    ancestry.find((processInfo) => processInfo.command.toLowerCase().includes("varlock")) ??
    ancestry.find((processInfo) => !GENERIC_SHELL_NAMES.has(processInfo.processName.toLowerCase())) ??
    null;

  if (!preferred) {
    return {
      runRootCommand: `pid:${process.ppid}`,
      runRootPid: process.ppid,
    };
  }

  const command = preferred.command.trim();
  return {
    processName: preferred.processName,
    processPid: preferred.pid,
    runRootCommand: command || preferred.processName,
    runRootPid: preferred.pid,
    argv: command ? [command] : [preferred.processName],
  };
}

function getProcessAncestry(startPid: number, maxDepth = 8): ProcessSnapshot[] {
  if (!Number.isInteger(startPid) || startPid <= 0 || process.platform === "win32") {
    return [];
  }

  const ancestry: ProcessSnapshot[] = [];
  let currentPid = startPid;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const snapshot = inspectProcess(currentPid);
    if (!snapshot) {
      break;
    }

    ancestry.push(snapshot);

    if (snapshot.ppid <= 1 || snapshot.ppid === snapshot.pid) {
      break;
    }

    currentPid = snapshot.ppid;
  }

  return ancestry;
}

function inspectProcess(pid: number): ProcessSnapshot | null {
  const result = spawnSync("ps", ["-o", "pid=,ppid=,command=", "-p", String(pid)], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const line = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    return null;
  }

  const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const command = match[3].trim();
  const entrypoint = command.split(/\s+/, 1)[0] ?? "unknown";

  return {
    command,
    pid: Number(match[1]),
    ppid: Number(match[2]),
    processName: basename(entrypoint),
  };
}

async function invokeProviderResolveEnvironment(
  request: ResolveEnvironmentProviderRequest,
): Promise<{ env: Record<string, string>; projectId?: string; projectName: string }> {
  return requestProviderResponse(request);
}

async function requestProviderResponse<T>(
  request: ResolveEnvironmentProviderRequest,
): Promise<T> {
  const socket = await connectProvider();

  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.end();
      callback();
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as ProviderServerMessage<T>;
        if (
          message.protocol !== PROVIDER_PROTOCOL ||
          message.version !== PROVIDER_PROTOCOL_VERSION ||
          message.type !== "response" ||
          message.requestId !== request.requestId
        ) {
          continue;
        }

        if (message.ok) {
          finish(() => resolve(message.data));
        } else {
          finish(() =>
            reject(createProviderError(message.error.message, message.error.code)),
          );
        }
      }
    });

    socket.on("error", (error) => {
      finish(() => reject(normalizeConnectionError(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        finish(() =>
          reject(new Error("Provider connection closed before a response was received.")),
        );
      }
    });

    sendProviderMessage(socket, request);
  });
}

async function connectProvider(): Promise<Socket> {
  const endpoint = getProviderEndpoint();

  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(endpoint);
    const onError = (error: Error) => {
      socket.destroy();
      reject(normalizeConnectionError(error));
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function sendProviderMessage(socket: Socket, request: ResolveEnvironmentProviderRequest): void {
  const payload: ProviderRequestEnvelope = {
    protocol: PROVIDER_PROTOCOL,
    version: PROVIDER_PROTOCOL_VERSION,
    type: "request",
    request,
  };

  socket.write(`${JSON.stringify(payload)}\n`);
}

function getProviderEndpoint(): string {
  const override = process.env[PROVIDER_ENDPOINT_ENV_VAR] ?? process.env[BROKER_ENDPOINT_ENV_VAR];
  if (override) {
    return override;
  }

  if (process.platform === "win32") {
    return WINDOWS_PROVIDER_PIPE;
  }

  return join(homedir(), ".config", "cloakenv", "provider.sock");
}

function getProcessContext(): BrokerRequesterInfo {
  const entrypoint = process.argv[1] ?? process.argv[0] ?? "unknown";
  const normalizedEntrypoint = entrypoint.replaceAll("\\", "/");
  const normalizedName = normalizedEntrypoint.includes("/apps/cli/")
    ? "cloakenv cli"
    : basename(entrypoint);

  return {
    processName: normalizedName,
    processPid: process.pid,
    argv: process.argv.slice(1),
    hasTty: Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY),
  };
}

function createProviderError(message: string, code?: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function normalizeConnectionError(error: unknown): Error {
  const code = getErrorCode(error);
  const message =
    code === "ENOENT" || code === "ECONNREFUSED"
      ? "CloakEnv provider is not running. Start the desktop app or `cloakenv provider start` and try again."
      : error instanceof Error
        ? error.message
        : "Could not connect to the CloakEnv provider.";

  return new Error(message);
}

function getErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
