import { connect, type Socket } from "node:net";
import { getApprovalBrokerEndpoint } from "./path";
import type {
  BrokerClientMessage,
  BrokerRequest,
  BrokerServerMessage,
  RunBrokerRequest,
} from "./protocol";

interface BrokerError extends Error {
  code?: string;
}

export async function invokeApprovalBrokerRequest<T>(request: BrokerRequest): Promise<T> {
  const socket = await connectApprovalBroker();

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

        const message = JSON.parse(line) as BrokerServerMessage;
        if (message.type !== "response" || message.requestId !== request.requestId) {
          continue;
        }

        if (message.ok) {
          finish(() => resolve(message.data as T));
        } else {
          finish(() => reject(createApprovalBrokerError(message.error.message, message.error.code)));
        }
      }
    });

    socket.on("error", (error) => {
      finish(() => reject(normalizeApprovalBrokerConnectionError(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        finish(() =>
          reject(new Error("Broker connection closed before a response was received.")),
        );
      }
    });

    sendApprovalBrokerMessage(socket, {
      type: "request",
      request,
    });
  });
}

export async function runApprovalBrokerCommand(request: RunBrokerRequest): Promise<number> {
  const socket = await connectApprovalBroker();

  return new Promise<number>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const onStdinData = (chunk: Buffer | string) => {
      sendApprovalBrokerMessage(socket, {
        type: "stdin",
        requestId: request.requestId,
        chunk: Buffer.isBuffer(chunk)
          ? chunk.toString("base64")
          : Buffer.from(chunk, "utf8").toString("base64"),
      });
    };

    const onStdinEnd = () => {
      sendApprovalBrokerMessage(socket, {
        type: "stdin_end",
        requestId: request.requestId,
      });
    };

    const onSigint = () => {
      sendApprovalBrokerSignal(socket, request.requestId, "SIGINT");
    };

    const onSigterm = () => {
      sendApprovalBrokerSignal(socket, request.requestId, "SIGTERM");
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

    process.stdin.on("data", onStdinData);
    process.stdin.on("end", onStdinEnd);
    process.stdin.resume();
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

        const message = JSON.parse(line) as BrokerServerMessage;
        if (message.requestId !== request.requestId) {
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

        if (message.type === "response") {
          if (message.ok) {
            continue;
          }

          finish(() => reject(createApprovalBrokerError(message.error.message, message.error.code)));
          return;
        }

        if (message.type === "run_exit") {
          finish(() => resolve(normalizeRunExitCode(message.exitCode, message.signal)));
          return;
        }
      }
    });

    socket.on("error", (error) => {
      finish(() => reject(normalizeApprovalBrokerConnectionError(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        finish(() => reject(new Error("Broker connection closed before the command exited.")));
      }
    });

    sendApprovalBrokerMessage(socket, {
      type: "request",
      request,
    });
  });
}

export function normalizeApprovalBrokerConnectionError(error: unknown): Error {
  const message =
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ECONNREFUSED")
      ? "CloakEnv provider is not running. Start the desktop app or `cloakenv provider start` and try again."
      : error instanceof Error
        ? error.message
        : "Could not connect to the approval broker.";

  return new Error(message);
}

async function connectApprovalBroker(): Promise<Socket> {
  const endpoint = getApprovalBrokerEndpoint();

  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(endpoint);
    const onError = (error: Error) => {
      socket.destroy();
      reject(normalizeApprovalBrokerConnectionError(error));
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function sendApprovalBrokerSignal(
  socket: Socket,
  requestId: string,
  signal: NodeJS.Signals,
): void {
  sendApprovalBrokerMessage(socket, {
    type: "signal",
    requestId,
    signal,
  });
}

function sendApprovalBrokerMessage(socket: Socket, message: BrokerClientMessage): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

function createApprovalBrokerError(message: string, code?: string): BrokerError {
  const error = new Error(message) as BrokerError;
  error.code = code;
  return error;
}

function normalizeRunExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
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
