import { connect, type Socket } from "node:net";
import { getProviderEndpoint } from "./path";
import {
  type ExpireProviderSessionRequest,
  PROVIDER_PROTOCOL,
  PROVIDER_PROTOCOL_VERSION,
  type ProviderClientMessage,
  type ProviderRequest,
  type ProviderServerMessage,
  type ProviderStatusRequest,
  type ResolveEnvironmentProviderRequest,
  type RunProcessProviderRequest,
} from "./protocol";

interface ProviderError extends Error {
  code?: string;
}

async function requestProviderResponse<T>(request: ProviderRequest): Promise<T> {
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

        const message = JSON.parse(line) as ProviderServerMessage;
        if (
          message.protocol !== PROVIDER_PROTOCOL ||
          message.version !== PROVIDER_PROTOCOL_VERSION ||
          message.type !== "response" ||
          message.requestId !== request.requestId
        ) {
          continue;
        }

        if (message.ok) {
          finish(() => resolve(message.data as T));
        } else {
          finish(() => reject(createProviderError(message.error.message, message.error.code)));
        }
      }
    });

    socket.on("error", (error) => {
      finish(() => reject(normalizeProviderConnectionError(error)));
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

export async function resolveProviderEnvironment(
  request: ResolveEnvironmentProviderRequest,
): Promise<{ projectId: string; projectName: string; env: Record<string, string> }> {
  return requestProviderResponse(request);
}

export async function getProviderStatus<T>(request?: ProviderStatusRequest): Promise<T> {
  const statusRequest = request ?? {
    kind: "status",
    requestId: crypto.randomUUID(),
  };

  return requestProviderResponse<T>(statusRequest);
}

export async function expireProviderSession<T>(request?: ExpireProviderSessionRequest): Promise<T> {
  const expireRequest = request ?? {
    kind: "expire_session",
    requestId: crypto.randomUUID(),
    all: true,
  };

  return requestProviderResponse<T>(expireRequest);
}

export async function runProviderCommand(request: RunProcessProviderRequest): Promise<number> {
  const socket = await connectProvider();

  return new Promise<number>((resolve, reject) => {
    let buffer = "";
    let settled = false;
    let runStarted = false;
    let stdinAttached = false;
    let stdinEndedBeforeRunStart = false;
    const pendingStdinChunks: string[] = [];

    const flushPendingStdin = () => {
      if (!runStarted) {
        return;
      }

      while (pendingStdinChunks.length > 0) {
        const chunk = pendingStdinChunks.shift();
        if (!chunk) {
          continue;
        }

        sendProviderMessage(socket, {
          protocol: PROVIDER_PROTOCOL,
          version: PROVIDER_PROTOCOL_VERSION,
          type: "stdin",
          requestId: request.requestId,
          chunk,
        });
      }

      if (stdinEndedBeforeRunStart) {
        sendProviderMessage(socket, {
          protocol: PROVIDER_PROTOCOL,
          version: PROVIDER_PROTOCOL_VERSION,
          type: "stdin_end",
          requestId: request.requestId,
        });
        stdinEndedBeforeRunStart = false;
      }
    };

    const onStdinData = (chunk: Buffer | string) => {
      const encodedChunk = Buffer.isBuffer(chunk)
        ? chunk.toString("base64")
        : Buffer.from(chunk, "utf8").toString("base64");

      if (!runStarted) {
        pendingStdinChunks.push(encodedChunk);
        return;
      }

      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "stdin",
        requestId: request.requestId,
        chunk: encodedChunk,
      });
    };

    const onStdinEnd = () => {
      if (!runStarted) {
        stdinEndedBeforeRunStart = true;
        return;
      }

      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "stdin_end",
        requestId: request.requestId,
      });
    };

    const onSigint = () => {
      sendProviderSignal(socket, request.requestId, "SIGINT");
    };

    const onSigterm = () => {
      sendProviderSignal(socket, request.requestId, "SIGTERM");
    };

    const attachStdin = () => {
      if (stdinAttached) {
        return;
      }

      stdinAttached = true;
      process.stdin.on("data", onStdinData);
      process.stdin.on("end", onStdinEnd);
      process.stdin.resume();
    };

    const cleanup = () => {
      process.stdin.off("data", onStdinData);
      process.stdin.off("end", onStdinEnd);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      socket.removeAllListeners();
      socket.end();
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    if (!process.stdin.isTTY) {
      attachStdin();
    }
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

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

        const message = JSON.parse(line) as ProviderServerMessage;
        if (
          message.protocol !== PROVIDER_PROTOCOL ||
          message.version !== PROVIDER_PROTOCOL_VERSION ||
          message.requestId !== request.requestId
        ) {
          continue;
        }

        if (message.type === "stdout") {
          process.stdout.write(Buffer.from(message.chunk, "base64"));
          continue;
        }

        if (message.type === "stderr") {
          process.stderr.write(Buffer.from(message.chunk, "base64"));
          continue;
        }

        if (message.type === "run_started") {
          runStarted = true;
          if (process.stdin.isTTY) {
            attachStdin();
          }
          flushPendingStdin();
          continue;
        }

        if (message.type === "response") {
          if (message.ok) {
            continue;
          }

          finish(() => reject(createProviderError(message.error.message, message.error.code)));
          return;
        }

        if (message.type === "run_exit") {
          finish(() => resolve(normalizeExitCode(message.exitCode, message.signal)));
          return;
        }
      }
    });

    socket.on("error", (error) => {
      finish(() => reject(normalizeProviderConnectionError(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        finish(() => reject(new Error("Provider connection closed before the command exited.")));
      }
    });

    sendProviderMessage(socket, request);
  });
}

export function normalizeProviderConnectionError(error: unknown): Error {
  const message =
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ECONNREFUSED")
      ? "CloakEnv provider is not running. Start the desktop app or `cloakenv provider start` and try again."
      : error instanceof Error
        ? error.message
        : "Could not connect to the local provider.";

  return new Error(message);
}

async function connectProvider(): Promise<Socket> {
  const endpoint = getProviderEndpoint();

  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(endpoint);
    const onError = (error: Error) => {
      socket.destroy();
      reject(normalizeProviderConnectionError(error));
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function sendProviderSignal(socket: Socket, requestId: string, signal: NodeJS.Signals): void {
  sendProviderMessage(socket, {
    protocol: PROVIDER_PROTOCOL,
    version: PROVIDER_PROTOCOL_VERSION,
    type: "signal",
    requestId,
    signal,
  });
}

function sendProviderMessage(
  socket: Socket,
  request: ProviderRequest | ProviderClientMessage,
): void {
  const message: ProviderClientMessage =
    "protocol" in request
      ? request
      : {
          protocol: PROVIDER_PROTOCOL,
          version: PROVIDER_PROTOCOL_VERSION,
          type: "request",
          request,
        };

  socket.write(`${JSON.stringify(message)}\n`);
}

function createProviderError(message: string, code?: string): ProviderError {
  const error = new Error(message) as ProviderError;
  error.code = code;
  return error;
}

function normalizeExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
  if (typeof exitCode === "number") {
    return exitCode;
  }

  if (signal === "SIGINT") {
    return 130;
  }

  if (signal === "SIGTERM") {
    return 143;
  }

  return 1;
}
