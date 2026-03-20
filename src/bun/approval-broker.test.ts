import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createConnection,
  createServer as createNetServer,
  type Server,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BrokerRequest,
  BrokerServerMessage,
  GetSecretBrokerRequest,
  ProviderRequest,
  ProviderServerMessage,
  ResolveEnvironmentProviderRequest,
  RunBrokerRequest,
  RunProcessProviderRequest,
} from "../../packages/core/src/approval/protocol";
import {
  PROVIDER_PROTOCOL,
  PROVIDER_PROTOCOL_VERSION,
} from "../../packages/core/src/approval/protocol";
import { startApprovalBroker, stopApprovalBroker } from "./approval-broker";

const originalBrokerEndpoint = process.env.CLOAKENV_APPROVAL_BROKER_ENDPOINT;
const originalProviderEndpoint = process.env.CLOAKENV_PROVIDER_ENDPOINT;
const testArtifacts: string[] = [];
const testServers: Server[] = [];

describe("approval broker", () => {
  afterEach(async () => {
    await Promise.all(testServers.splice(0).map((server) => stopApprovalBroker(server)));

    for (const artifact of testArtifacts.splice(0)) {
      rmSync(artifact, { recursive: true, force: true });
    }

    if (originalBrokerEndpoint) {
      process.env.CLOAKENV_APPROVAL_BROKER_ENDPOINT = originalBrokerEndpoint;
    } else {
      delete process.env.CLOAKENV_APPROVAL_BROKER_ENDPOINT;
    }

    if (originalProviderEndpoint) {
      process.env.CLOAKENV_PROVIDER_ENDPOINT = originalProviderEndpoint;
    } else {
      delete process.env.CLOAKENV_PROVIDER_ENDPOINT;
    }
  });

  test("run resolves executables from workspace node_modules/.bin directories", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "cloakenv-workspace-"));
    const appDir = join(workspaceDir, "apps", "client");
    const binDir = join(workspaceDir, "node_modules", ".bin");
    testArtifacts.push(workspaceDir);

    mkdirSync(appDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    writeWorkspaceCommand(binDir, "vite", "printf '%s' \"$TEST_SECRET\"");

    const endpoint = await startTestBroker({
      brokerPrepareRun: async () => ({
        projectId: "project-1",
        projectName: "workspace-project",
        env: { TEST_SECRET: "secret-from-broker" },
      }),
    });

    const messages = await sendBrokerRequest(endpoint, {
      kind: "run",
      requestId: crypto.randomUUID(),
      cwd: appDir,
      argv: ["vite"],
    } satisfies RunBrokerRequest);

    expect(readStdout(messages)).toBe("secret-from-broker");

    const exitMessage = messages.find(
      (message): message is Extract<BrokerServerMessage, { type: "run_exit" }> =>
        message.type === "run_exit",
    );
    expect(exitMessage?.exitCode).toBe(0);
  });

  test("run uses the caller PATH for shebang interpreters when provided", async () => {
    if (process.platform === "win32") {
      return;
    }

    const originalPath = process.env.PATH;
    if (!originalPath) {
      throw new Error("Expected PATH to be available for the test runner.");
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), "cloakenv-path-"));
    const appDir = join(workspaceDir, "apps", "client");
    const binDir = join(workspaceDir, "node_modules", ".bin");
    const vitePath = join(binDir, "vite");
    testArtifacts.push(workspaceDir);

    mkdirSync(appDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(vitePath, "#!/usr/bin/env sh\nprintf '%s' \"$TEST_SECRET\"\n");
    chmodSync(vitePath, 0o755);

    process.env.PATH = "";

    try {
      const endpoint = await startTestBroker({
        brokerPrepareRun: async () => ({
          projectId: "project-1",
          projectName: "workspace-project",
          env: { TEST_SECRET: "secret-from-broker" },
        }),
      });

      const messages = await sendBrokerRequest(endpoint, {
        kind: "run",
        requestId: crypto.randomUUID(),
        cwd: appDir,
        argv: ["vite"],
        launcherPath: originalPath,
      } satisfies RunBrokerRequest);

      expect(readStdout(messages)).toBe("secret-from-broker");

      const exitMessage = messages.find(
        (message): message is Extract<BrokerServerMessage, { type: "run_exit" }> =>
          message.type === "run_exit",
      );
      expect(exitMessage?.exitCode).toBe(0);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("spawn failures return an error without crashing the broker", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cloakenv-run-"));
    testArtifacts.push(cwd);

    const endpoint = await startTestBroker();

    const failedRunMessages = await sendBrokerRequest(endpoint, {
      kind: "run",
      requestId: crypto.randomUUID(),
      cwd,
      argv: ["missing-command"],
    } satisfies RunBrokerRequest);

    const errorResponse = failedRunMessages.find(
      (message): message is Extract<BrokerServerMessage, { type: "response"; ok: false }> =>
        message.type === "response" && !message.ok,
    );

    expect(errorResponse?.error.code).toBe("spawn_failed");

    await wait(25);

    const followUpMessages = await sendBrokerRequest(endpoint, {
      kind: "get",
      requestId: crypto.randomUUID(),
      cwd,
      key: "API_KEY",
      scope: ".env.local",
    } satisfies GetSecretBrokerRequest);

    const successResponse = followUpMessages.find(
      (message): message is Extract<BrokerServerMessage, { type: "response"; ok: true }> =>
        message.type === "response" && message.ok,
    );

    expect(successResponse?.data).toEqual({
      projectName: "test-project",
      value: "secret-value",
    });
  });

  test("stopping the broker terminates descendant dev-server processes and frees their port", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspaceDir = mkdtempSync(join(tmpdir(), "cloakenv-shutdown-"));
    testArtifacts.push(workspaceDir);

    const port = await reserveTcpPort();
    const wrapperPath = join(workspaceDir, "spawn-child-server.sh");
    writeFileSync(
      wrapperPath,
      [
        "#!/bin/sh",
        'bun -e \'const { createServer } = require("node:http"); const port = Number(process.argv[1]); const server = createServer((_req, res) => res.end("ok")); server.listen(port, "127.0.0.1"); const shutdown = () => server.close(() => process.exit(0)); process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown); setInterval(() => {}, 1000);\' "$1" &',
        "child=$!",
        'wait "$child"',
        "",
      ].join("\n"),
    );
    chmodSync(wrapperPath, 0o755);

    const endpoint = await startTestBroker();
    const server = testServers.at(-1);
    if (!server) {
      throw new Error("Expected a test broker server.");
    }

    const runSocket = await startBrokerRun(endpoint, {
      kind: "run",
      requestId: crypto.randomUUID(),
      cwd: workspaceDir,
      argv: ["/bin/sh", wrapperPath, String(port)],
    });

    await waitForPortState(port, "open");

    await stopApprovalBroker(server);
    runSocket.destroy();
    await waitForPortState(port, "closed");
  });

  test("run signal falls back to direct child signaling when process-group signaling is denied", async () => {
    if (process.platform === "win32") {
      return;
    }

    const cwd = mkdtempSync(join(tmpdir(), "cloakenv-run-signal-"));
    testArtifacts.push(cwd);

    const endpoint = await startTestBroker();
    const requestId = crypto.randomUUID();
    const originalProcessKill = process.kill;
    let attemptedProcessGroupKill = false;

    process.kill = ((pid, signal) => {
      if (pid < 0) {
        attemptedProcessGroupKill = true;
        const error = new Error(
          "kill() failed: EPERM: Operation not permitted",
        ) as NodeJS.ErrnoException;
        error.code = "EPERM";
        error.errno = 1;
        error.syscall = "kill";
        throw error;
      }

      return originalProcessKill(pid, signal);
    }) as typeof process.kill;

    try {
      const messages = await sendBrokerSignalDuringRun(
        endpoint,
        {
          kind: "run",
          requestId,
          cwd,
          argv: [
            "bun",
            "-e",
            'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);',
          ],
        } satisfies RunBrokerRequest,
        "SIGTERM",
      );

      expect(attemptedProcessGroupKill).toBe(true);

      const exitMessage = messages.find(
        (message): message is Extract<BrokerServerMessage, { type: "run_exit" }> =>
          message.type === "run_exit",
      );

      expect(exitMessage).toBeDefined();
      expect(exitMessage?.exitCode === 0 || exitMessage?.signal === "SIGTERM").toBe(true);

      const followUpMessages = await sendBrokerRequest(endpoint, {
        kind: "get",
        requestId: crypto.randomUUID(),
        cwd,
        key: "API_KEY",
        scope: ".env.local",
      } satisfies GetSecretBrokerRequest);

      const successResponse = followUpMessages.find(
        (message): message is Extract<BrokerServerMessage, { type: "response"; ok: true }> =>
          message.type === "response" && message.ok,
      );

      expect(successResponse?.data).toEqual({
        projectName: "test-project",
        value: "secret-value",
      });
    } finally {
      process.kill = originalProcessKill;
    }
  });

  test("provider resolve_environment returns an approved env map", async () => {
    const endpoint = await startTestBroker({
      resolveProviderEnvironment: async () => ({
        projectId: "project-1",
        projectName: "test-project",
        env: { API_KEY: "secret-value" },
      }),
    });

    const messages = await sendProviderRequest(endpoint, {
      kind: "resolve_environment",
      requestId: crypto.randomUUID(),
      cwd: process.cwd(),
      scope: "default",
    } satisfies ResolveEnvironmentProviderRequest);

    const response = messages.find(
      (message): message is Extract<ProviderServerMessage, { type: "response"; ok: true }> =>
        message.type === "response" && message.ok,
    );

    expect(response?.data).toEqual({
      projectId: "project-1",
      projectName: "test-project",
      env: { API_KEY: "secret-value" },
    });
  });

  test("provider status returns diagnostics without requiring approval", async () => {
    const endpoint = await startTestBroker({
      getProviderDiagnostics: () => ({
        reachable: true,
        mode: "desktop",
        endpoint,
        activeSessionCount: 0,
      }),
    });

    const messages = await sendProviderRequest(endpoint, {
      kind: "status",
      requestId: crypto.randomUUID(),
    });

    const response = messages.find(
      (message): message is Extract<ProviderServerMessage, { type: "response"; ok: true }> =>
        message.type === "response" && message.ok,
    );

    expect(response?.data).toEqual({
      reachable: true,
      mode: "desktop",
      endpoint,
      activeSessionCount: 0,
    });
  });

  test("provider expire_session returns expiration results", async () => {
    const endpoint = await startTestBroker({
      expireProviderSession: ({ sessionId }) => ({
        expired: sessionId ? 1 : 0,
        remaining: 0,
        expiredSessionId: sessionId ?? null,
      }),
    });

    const messages = await sendProviderRequest(endpoint, {
      kind: "expire_session",
      requestId: crypto.randomUUID(),
      sessionId: "session-123",
    });

    const response = messages.find(
      (message): message is Extract<ProviderServerMessage, { type: "response"; ok: true }> =>
        message.type === "response" && message.ok,
    );

    expect(response?.data).toEqual({
      expired: 1,
      remaining: 0,
      expiredSessionId: "session-123",
    });
  });
});

async function startTestBroker(
  overrides: Partial<{
    brokerGetSecret(
      request: GetSecretBrokerRequest,
    ): Promise<{ projectName: string; value: string }>;
    brokerPrepareRun(request: RunBrokerRequest): Promise<{
      projectId: string;
      projectName: string;
      env: Record<string, string>;
    }>;
    resolveProviderEnvironment(
      request: ResolveEnvironmentProviderRequest | RunBrokerRequest | RunProcessProviderRequest,
    ): Promise<{
      projectId: string;
      projectName: string;
      env: Record<string, string>;
    }>;
    expireProviderSession(options?: { sessionId?: string; all?: boolean }): Record<string, unknown>;
    getProviderDiagnostics(): Record<string, unknown>;
  }> = {},
): Promise<string> {
  const endpoint = createBrokerEndpoint();
  process.env.CLOAKENV_APPROVAL_BROKER_ENDPOINT = endpoint;
  process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;

  const server = startApprovalBroker({
    brokerExport: async () => ({ path: "/tmp/export.cloaked" }),
    brokerGetHistory: async () => ({
      projectName: "test-project",
      entries: [],
    }),
    brokerGetSecret:
      overrides.brokerGetSecret ??
      (async () => ({
        projectName: "test-project",
        value: "secret-value",
      })),
    brokerListValues: async () => ({
      projectName: "test-project",
      secrets: [],
    }),
    brokerPrepareRun:
      overrides.brokerPrepareRun ??
      (async () => ({
        projectId: "project-1",
        projectName: "test-project",
        env: {},
      })),
    expireProviderSession:
      overrides.expireProviderSession ??
      (() => ({
        expired: 0,
        remaining: 0,
        expiredSessionId: null,
      })),
    getProviderDiagnostics:
      overrides.getProviderDiagnostics ??
      (() => ({
        reachable: true,
        mode: "desktop",
        activeSessionCount: 0,
      })),
    resolveProviderEnvironment:
      overrides.resolveProviderEnvironment ??
      (async () => ({
        projectId: "project-1",
        projectName: "test-project",
        env: {},
      })),
    logProviderRun: () => {},
  });

  testServers.push(server);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.once("listening", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return endpoint;
}

function createBrokerEndpoint(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cloakenv-broker-test-${crypto.randomUUID()}`;
  }

  const dir = mkdtempSync(join(tmpdir(), "cloakenv-broker-test-"));
  testArtifacts.push(dir);
  return join(dir, "approval-broker.sock");
}

async function sendBrokerRequest(
  endpoint: string,
  request: BrokerRequest,
): Promise<BrokerServerMessage[]> {
  return new Promise<BrokerServerMessage[]>((resolve, reject) => {
    const socket = createConnection(endpoint);
    const messages: BrokerServerMessage[] = [];
    let buffer = "";

    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "request", request })}\n`);
    });

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

        messages.push(JSON.parse(line) as BrokerServerMessage);
      }
    });

    socket.on("close", () => {
      resolve(messages);
    });
  });
}

async function sendProviderRequest(
  endpoint: string,
  request: ProviderRequest,
): Promise<ProviderServerMessage[]> {
  return new Promise<ProviderServerMessage[]>((resolve, reject) => {
    const socket = createConnection(endpoint);
    const messages: ProviderServerMessage[] = [];
    let buffer = "";

    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          protocol: PROVIDER_PROTOCOL,
          version: PROVIDER_PROTOCOL_VERSION,
          type: "request",
          request,
        })}\n`,
      );
    });

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

        messages.push(JSON.parse(line) as ProviderServerMessage);
      }
    });

    socket.on("close", () => {
      resolve(messages);
    });
  });
}

function readStdout(messages: BrokerServerMessage[]): string {
  return messages
    .filter(
      (message): message is Extract<BrokerServerMessage, { type: "stdout" }> =>
        message.type === "stdout",
    )
    .map((message) => Buffer.from(message.chunk, "base64").toString("utf8"))
    .join("");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}

async function startBrokerRun(endpoint: string, request: RunBrokerRequest): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(endpoint);
    let buffer = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    socket.once("error", (error) => {
      finish(() => reject(error));
    });

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "request", request })}\n`);
    });

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
        if (message.type === "run_started") {
          finish(() => resolve(socket));
          return;
        }

        if (message.type === "response" && !message.ok) {
          finish(() =>
            reject(
              new Error(
                `Failed to start brokered run: ${message.error.code} ${message.error.message}`,
              ),
            ),
          );
          return;
        }
      }
    });

    socket.once("close", () => {
      finish(() => reject(new Error("Broker run socket closed before the process started.")));
    });
  });
}

async function sendBrokerSignalDuringRun(
  endpoint: string,
  request: RunBrokerRequest,
  signal: NodeJS.Signals,
): Promise<BrokerServerMessage[]> {
  return new Promise<BrokerServerMessage[]>((resolve, reject) => {
    const socket = createConnection(endpoint);
    const messages: BrokerServerMessage[] = [];
    let buffer = "";
    let sentSignal = false;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    socket.once("error", (error) => {
      finish(() => reject(error));
    });

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "request", request })}\n`);
    });

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
        messages.push(message);

        if (message.type === "response" && !message.ok) {
          finish(() =>
            reject(
              new Error(
                `Failed to stream brokered run: ${message.error.code} ${message.error.message}`,
              ),
            ),
          );
          socket.destroy();
          return;
        }

        if (message.type === "run_started" && !sentSignal) {
          sentSignal = true;
          socket.write(
            `${JSON.stringify({ type: "signal", requestId: request.requestId, signal })}\n`,
          );
        }
      }
    });

    socket.once("close", () => {
      finish(() => resolve(messages));
    });
  });
}

async function reserveTcpPort(): Promise<number> {
  const server = createNetServer();

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a TCP port for the shutdown test.");
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });

  return address.port;
}

async function waitForPortState(port: number, state: "open" | "closed"): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const isOpen = await isTcpPortOpen(port);
    if ((state === "open" && isOpen) || (state === "closed" && !isOpen)) {
      return;
    }

    await wait(50);
  }

  throw new Error(`Timed out waiting for port ${port} to become ${state}.`);
}

async function isTcpPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function writeWorkspaceCommand(binDir: string, commandName: string, scriptBody: string): void {
  if (process.platform === "win32") {
    writeFileSync(join(binDir, `${commandName}.cmd`), `@echo off\r\n${scriptBody}\r\n`);
    return;
  }

  const commandPath = join(binDir, commandName);
  writeFileSync(commandPath, `#!/bin/sh\n${scriptBody}\n`);
  chmodSync(commandPath, 0o755);
}
