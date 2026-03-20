import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import {
  type BrokerClientMessage,
  type BrokerRequest,
  type BrokerServerMessage,
  createSpawnEnvironment,
  type ExportBrokerRequest,
  type GetHistoryBrokerRequest,
  type GetSecretBrokerRequest,
  getProviderEndpoint,
  type ListValuesBrokerRequest,
  PROVIDER_PROTOCOL,
  PROVIDER_PROTOCOL_VERSION,
  type ProviderClientMessage,
  type ProviderServerMessage,
  type ResolveEnvironmentProviderRequest,
  type RunBrokerRequest,
  type RunProcessProviderRequest,
} from "../../packages/core/src/index";

interface ApprovalBrokerHandlers {
  brokerExport(request: ExportBrokerRequest): Promise<{ path: string }>;
  brokerGetHistory(request: GetHistoryBrokerRequest): Promise<{
    projectName: string;
    entries: Array<{ value: string; version: number; createdAt: number }>;
  }>;
  brokerGetSecret(request: GetSecretBrokerRequest): Promise<{ projectName: string; value: string }>;
  brokerListValues(request: ListValuesBrokerRequest): Promise<{
    projectName: string;
    secrets: Array<{ key: string; value: string; scope: string }>;
  }>;
  brokerPrepareRun(request: RunBrokerRequest): Promise<{
    projectId: string;
    projectName: string;
    env: Record<string, string>;
  }>;
  expireProviderSession(options?: { sessionId?: string; all?: boolean }): Record<string, unknown>;
  getProviderDiagnostics(): Record<string, unknown>;
  resolveProviderEnvironment(
    request: ResolveEnvironmentProviderRequest | RunBrokerRequest | RunProcessProviderRequest,
  ): Promise<{
    projectId: string;
    projectName: string;
    env: Record<string, string>;
  }>;
  logProviderRun(metadata: {
    requestId: string;
    projectId: string;
    projectName: string;
    scope?: string;
    cwd: string;
    argv: string[];
    processName?: string;
    processPid?: number;
    hasTty?: boolean;
  }): void;
}

type ConnectionProtocol = "legacy" | "provider" | null;

interface ManagedRunChild {
  child: ChildProcessWithoutNullStreams;
  terminationPromise: Promise<void> | null;
  usesProcessGroup: boolean;
}

interface ConnectionState {
  buffer: string;
  requestId: string | null;
  protocol: ConnectionProtocol;
  runChild: ManagedRunChild | null;
}

interface ProviderServerRuntime {
  activeRuns: Set<ManagedRunChild>;
  openSockets: Set<Socket>;
  shutdownPromise: Promise<void> | null;
  processExitHandler: (() => void) | null;
}

const providerServerRuntimes = new WeakMap<Server, ProviderServerRuntime>();
const RUN_TERMINATION_TIMEOUT_MS = 2_000;

export function startProviderServer(handlers: ApprovalBrokerHandlers): Server {
  const endpoint = getProviderEndpoint();
  const consumedRequestIds = new Set<string>();
  const runtime: ProviderServerRuntime = {
    activeRuns: new Set(),
    openSockets: new Set(),
    shutdownPromise: null,
    processExitHandler: null,
  };

  if (process.platform !== "win32" && existsSync(endpoint)) {
    unlinkSync(endpoint);
  }

  const server = createServer((socket) => {
    runtime.openSockets.add(socket);
    const state: ConnectionState = {
      buffer: "",
      requestId: null,
      protocol: null,
      runChild: null,
    };

    socket.on("data", (chunk) => {
      state.buffer += chunk.toString("utf8");

      while (true) {
        const newlineIndex = state.buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = state.buffer.slice(0, newlineIndex).trim();
        state.buffer = state.buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          sendError(
            socket,
            state.protocol,
            state.requestId ?? "unknown",
            "invalid_message",
            "Invalid broker message.",
          );
          socket.end();
          return;
        }

        if (isProviderMessage(message)) {
          void handleProviderMessage(socket, state, runtime, handlers, consumedRequestIds, message);
          continue;
        }

        void handleLegacyMessage(
          socket,
          state,
          runtime,
          handlers,
          consumedRequestIds,
          message as BrokerClientMessage,
        );
      }
    });

    socket.on("close", () => {
      runtime.openSockets.delete(socket);
      if (state.runChild) {
        void terminateManagedRun(state.runChild);
      }
    });
  });

  providerServerRuntimes.set(server, runtime);
  runtime.processExitHandler = () => {
    for (const runChild of runtime.activeRuns) {
      terminateManagedRunSync(runChild);
    }
  };
  process.on("exit", runtime.processExitHandler);

  server.once("close", () => {
    if (runtime.processExitHandler) {
      process.off("exit", runtime.processExitHandler);
      runtime.processExitHandler = null;
    }
    providerServerRuntimes.delete(server);
  });

  server.listen(endpoint);
  return server;
}

export const startApprovalBroker = startProviderServer;
export const stopApprovalBroker = stopProviderServer;

export async function stopProviderServer(server: Server): Promise<void> {
  const runtime = providerServerRuntimes.get(server);
  if (!runtime) {
    await closeProviderServerSocket(server);
    return;
  }

  if (runtime.shutdownPromise) {
    await runtime.shutdownPromise;
    return;
  }

  runtime.shutdownPromise = (async () => {
    const closePromise = closeProviderServerSocket(server);

    for (const socket of runtime.openSockets) {
      socket.end();
    }

    await Promise.allSettled(
      [...runtime.activeRuns].map((runChild) => terminateManagedRun(runChild)),
    );

    for (const socket of runtime.openSockets) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }

    await closePromise;
  })();

  try {
    await runtime.shutdownPromise;
  } finally {
    runtime.shutdownPromise = null;
  }
}

function isProviderMessage(message: unknown): message is ProviderClientMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    (message as { protocol?: string }).protocol === PROVIDER_PROTOCOL
  );
}

async function handleLegacyMessage(
  socket: Socket,
  state: ConnectionState,
  runtime: ProviderServerRuntime,
  handlers: ApprovalBrokerHandlers,
  consumedRequestIds: Set<string>,
  message: BrokerClientMessage,
): Promise<void> {
  if (message.type === "request") {
    if (!bindRequest(socket, state, consumedRequestIds, "legacy", message.request.requestId)) {
      return;
    }

    if (message.request.kind === "run") {
      await handleRunRequest(socket, state, runtime, handlers, message.request, "legacy");
      return;
    }

    await handleSimpleLegacyRequest(socket, handlers, message.request);
    socket.end();
    return;
  }

  handleRunStreamMessage(socket, state, message.requestId, message.type, {
    chunk: "chunk" in message ? message.chunk : undefined,
    signal: "signal" in message ? message.signal : undefined,
  });
}

async function handleProviderMessage(
  socket: Socket,
  state: ConnectionState,
  runtime: ProviderServerRuntime,
  handlers: ApprovalBrokerHandlers,
  consumedRequestIds: Set<string>,
  message: ProviderClientMessage,
): Promise<void> {
  if (message.type === "request") {
    if (!bindRequest(socket, state, consumedRequestIds, "provider", message.request.requestId)) {
      return;
    }

    if (message.request.kind === "status") {
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId: message.request.requestId,
        ok: true,
        data: handlers.getProviderDiagnostics(),
      });
      socket.end();
      return;
    }

    if (message.request.kind === "expire_session") {
      try {
        sendProviderMessage(socket, {
          protocol: PROVIDER_PROTOCOL,
          version: PROVIDER_PROTOCOL_VERSION,
          type: "response",
          requestId: message.request.requestId,
          ok: true,
          data: handlers.expireProviderSession({
            sessionId: message.request.sessionId,
            all: message.request.all,
          }),
        });
      } catch (error) {
        sendError(
          socket,
          "provider",
          message.request.requestId,
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "request_failed",
          error instanceof Error ? error.message : "Failed to expire provider session.",
        );
      }
      socket.end();
      return;
    }

    if (message.request.kind === "run_process") {
      await handleRunRequest(socket, state, runtime, handlers, message.request, "provider");
      return;
    }

    await handleProviderResolveRequest(socket, handlers, message.request);
    socket.end();
    return;
  }

  handleRunStreamMessage(socket, state, message.requestId, message.type, {
    chunk: "chunk" in message ? message.chunk : undefined,
    signal: "signal" in message ? message.signal : undefined,
  });
}

function bindRequest(
  socket: Socket,
  state: ConnectionState,
  consumedRequestIds: Set<string>,
  protocol: Exclude<ConnectionProtocol, null>,
  requestId: string,
): boolean {
  if (state.requestId) {
    sendError(
      socket,
      state.protocol,
      state.requestId,
      "request_already_bound",
      "Only one request is allowed per connection.",
    );
    socket.end();
    return false;
  }

  if (consumedRequestIds.has(requestId)) {
    sendError(
      socket,
      protocol,
      requestId,
      "request_replayed",
      "This request id has already been used.",
    );
    socket.end();
    return false;
  }

  consumedRequestIds.add(requestId);
  state.requestId = requestId;
  state.protocol = protocol;
  return true;
}

function handleRunStreamMessage(
  socket: Socket,
  state: ConnectionState,
  requestId: string,
  type: "stdin" | "stdin_end" | "signal",
  payload: { chunk?: string; signal?: NodeJS.Signals },
): void {
  if (!state.requestId || requestId !== state.requestId) {
    sendError(
      socket,
      state.protocol,
      state.requestId ?? "unknown",
      "request_mismatch",
      "Run stream does not match the active request.",
    );
    socket.end();
    return;
  }

  if (!state.runChild) {
    return;
  }

  if (type === "stdin" && payload.chunk) {
    state.runChild.child.stdin.write(Buffer.from(payload.chunk, "base64"));
    return;
  }

  if (type === "stdin_end") {
    state.runChild.child.stdin.end();
    return;
  }

  if (type === "signal" && payload.signal) {
    void terminateManagedRun(state.runChild, payload.signal);
  }
}

async function handleSimpleLegacyRequest(
  socket: Socket,
  handlers: ApprovalBrokerHandlers,
  request: Exclude<BrokerRequest, RunBrokerRequest>,
): Promise<void> {
  try {
    if (request.kind === "get") {
      const result = await handlers.brokerGetSecret(request);
      sendLegacyMessage(socket, {
        type: "response",
        requestId: request.requestId,
        ok: true,
        data: result,
      });
      return;
    }

    if (request.kind === "history") {
      const result = await handlers.brokerGetHistory(request);
      sendLegacyMessage(socket, {
        type: "response",
        requestId: request.requestId,
        ok: true,
        data: result,
      });
      return;
    }

    if (request.kind === "list_values") {
      const result = await handlers.brokerListValues(request);
      sendLegacyMessage(socket, {
        type: "response",
        requestId: request.requestId,
        ok: true,
        data: result,
      });
      return;
    }

    const result = await handlers.brokerExport(request);
    sendLegacyMessage(socket, {
      type: "response",
      requestId: request.requestId,
      ok: true,
      data: result,
    });
  } catch (error) {
    sendError(
      socket,
      "legacy",
      request.requestId,
      normalizeErrorCode(error),
      error instanceof Error ? error.message : "Broker request failed.",
    );
  }
}

async function handleProviderResolveRequest(
  socket: Socket,
  handlers: ApprovalBrokerHandlers,
  request: ResolveEnvironmentProviderRequest,
): Promise<void> {
  try {
    const result = await handlers.resolveProviderEnvironment(request);
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "response",
      requestId: request.requestId,
      ok: true,
      data: result,
    });
  } catch (error) {
    sendError(
      socket,
      "provider",
      request.requestId,
      normalizeErrorCode(error),
      error instanceof Error ? error.message : "Provider request failed.",
    );
  }
}

async function handleRunRequest(
  socket: Socket,
  state: ConnectionState,
  runtime: ProviderServerRuntime,
  handlers: ApprovalBrokerHandlers,
  request: RunBrokerRequest | RunProcessProviderRequest,
  protocol: Exclude<ConnectionProtocol, null>,
): Promise<void> {
  try {
    const prepared =
      protocol === "provider"
        ? await handlers.resolveProviderEnvironment(request)
        : await handlers.brokerPrepareRun(request as RunBrokerRequest);
    const env = createSpawnEnvironment({
      cwd: request.cwd,
      baseEnv: process.env,
      injectedEnv: prepared.env,
      launcherPath: request.launcherPath,
    });
    const child = spawn(request.argv[0], request.argv.slice(1), {
      cwd: request.cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const managedRun = createManagedRunChild(child);

    state.runChild = managedRun;
    runtime.activeRuns.add(managedRun);
    handlers.logProviderRun({
      requestId: request.requestId,
      projectId: prepared.projectId,
      projectName: prepared.projectName,
      scope: request.scope,
      cwd: request.cwd,
      argv: request.argv,
      processName: request.requester?.processName,
      processPid: request.requester?.processPid,
      hasTty: request.requester?.hasTty,
    });

    sendRunStarted(socket, protocol, request.requestId);

    child.stdout.on("data", (chunk: Buffer) => {
      sendStdout(socket, protocol, request.requestId, chunk.toString("base64"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      sendStderr(socket, protocol, request.requestId, chunk.toString("base64"));
    });

    child.once("error", (error) => {
      runtime.activeRuns.delete(managedRun);
      if (state.runChild === managedRun) {
        state.runChild = null;
      }
      sendError(socket, protocol, request.requestId, "spawn_failed", error.message);
      socket.end();
    });

    child.once("close", (exitCode, signal) => {
      runtime.activeRuns.delete(managedRun);
      if (state.runChild === managedRun) {
        state.runChild = null;
      }
      sendRunExit(socket, protocol, request.requestId, exitCode, signal);
      socket.end();
    });
  } catch (error) {
    sendError(
      socket,
      protocol,
      request.requestId,
      normalizeErrorCode(error),
      error instanceof Error ? error.message : "Run request failed.",
    );
    socket.end();
  }
}

function sendError(
  socket: Socket,
  protocol: ConnectionProtocol,
  requestId: string,
  code: string,
  message: string,
): void {
  if (protocol === "provider") {
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "response",
      requestId,
      ok: false,
      error: {
        code,
        message,
      },
    });
    return;
  }

  sendLegacyMessage(socket, {
    type: "response",
    requestId,
    ok: false,
    error: {
      code,
      message,
    },
  });
}

function sendRunStarted(
  socket: Socket,
  protocol: Exclude<ConnectionProtocol, null>,
  requestId: string,
): void {
  if (protocol === "provider") {
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "run_started",
      requestId,
    });
    return;
  }

  sendLegacyMessage(socket, {
    type: "run_started",
    requestId,
  });
}

function sendStdout(
  socket: Socket,
  protocol: Exclude<ConnectionProtocol, null>,
  requestId: string,
  chunk: string,
): void {
  if (protocol === "provider") {
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "stdout",
      requestId,
      chunk,
    });
    return;
  }

  sendLegacyMessage(socket, {
    type: "stdout",
    requestId,
    chunk,
  });
}

function sendStderr(
  socket: Socket,
  protocol: Exclude<ConnectionProtocol, null>,
  requestId: string,
  chunk: string,
): void {
  if (protocol === "provider") {
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "stderr",
      requestId,
      chunk,
    });
    return;
  }

  sendLegacyMessage(socket, {
    type: "stderr",
    requestId,
    chunk,
  });
}

function sendRunExit(
  socket: Socket,
  protocol: Exclude<ConnectionProtocol, null>,
  requestId: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): void {
  if (protocol === "provider") {
    sendProviderMessage(socket, {
      protocol: PROVIDER_PROTOCOL,
      version: PROVIDER_PROTOCOL_VERSION,
      type: "run_exit",
      requestId,
      exitCode,
      signal,
    });
    return;
  }

  sendLegacyMessage(socket, {
    type: "run_exit",
    requestId,
    exitCode,
    signal,
  });
}

function sendLegacyMessage(socket: Socket, message: BrokerServerMessage): void {
  sendSerializedMessage(socket, message);
}

function sendProviderMessage(socket: Socket, message: ProviderServerMessage): void {
  sendSerializedMessage(socket, message);
}

function sendSerializedMessage(
  socket: Socket,
  message: BrokerServerMessage | ProviderServerMessage,
): void {
  if (!canWriteToSocket(socket)) {
    return;
  }

  try {
    socket.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    if (isWriteAfterEndError(error)) {
      return;
    }

    throw error;
  }
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return "request_failed";
}

function canWriteToSocket(socket: Socket): boolean {
  return socket.writable && !socket.destroyed && !socket.writableEnded;
}

function isWriteAfterEndError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

function createManagedRunChild(child: ChildProcessWithoutNullStreams): ManagedRunChild {
  return {
    child,
    terminationPromise: null,
    usesProcessGroup: process.platform !== "win32",
  };
}

async function terminateManagedRun(
  runChild: ManagedRunChild,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (hasChildExited(runChild.child)) {
    return;
  }

  if (runChild.terminationPromise) {
    sendSignalToManagedRun(runChild, signal);
    await runChild.terminationPromise;
    return;
  }

  runChild.terminationPromise = new Promise<void>((resolve) => {
    const cleanup = () => {
      clearTimeout(escalationTimer);
      runChild.child.off("close", onSettled);
      runChild.child.off("exit", onSettled);
    };
    const onSettled = () => {
      cleanup();
      resolve();
    };
    const escalationTimer = setTimeout(() => {
      if (!hasChildExited(runChild.child)) {
        sendSignalToManagedRun(runChild, "SIGKILL");
      }
    }, RUN_TERMINATION_TIMEOUT_MS);

    escalationTimer.unref?.();
    runChild.child.once("close", onSettled);
    runChild.child.once("exit", onSettled);
    sendSignalToManagedRun(runChild, signal);
  });

  try {
    await runChild.terminationPromise;
  } finally {
    runChild.terminationPromise = null;
  }
}

function terminateManagedRunSync(runChild: ManagedRunChild): void {
  if (hasChildExited(runChild.child)) {
    return;
  }

  sendSignalToManagedRun(runChild, "SIGTERM");
}

function sendSignalToManagedRun(runChild: ManagedRunChild, signal: NodeJS.Signals): void {
  if (hasChildExited(runChild.child)) {
    return;
  }

  const pid = runChild.child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    try {
      runChild.child.kill(signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return;
  }

  if (process.platform === "win32") {
    terminateWindowsProcessTree(pid, signal, runChild.child);
    return;
  }

  if (runChild.usesProcessGroup) {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return;
      }

      if (!isPermissionProcessError(error)) {
        throw error;
      }

      runChild.usesProcessGroup = false;
    }
  }

  try {
    runChild.child.kill(signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function terminateWindowsProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  child: ChildProcessWithoutNullStreams,
): void {
  const taskkillArgs = ["/PID", String(pid), "/T"];
  if (signal === "SIGKILL") {
    taskkillArgs.push("/F");
  }

  const killer = spawn("taskkill", taskkillArgs, {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.once("error", () => {
    try {
      child.kill(signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  });
}

function hasChildExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function isMissingProcessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ESRCH"
  );
}

function isPermissionProcessError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EPERM"
  );
}

async function closeProviderServerSocket(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isServerNotRunningError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ERR_SERVER_NOT_RUNNING"
  );
}
