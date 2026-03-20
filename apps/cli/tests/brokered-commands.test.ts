import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  BrokerClientMessage,
  BrokerServerMessage,
  ProviderClientMessage,
  ProviderServerMessage,
} from "@cloakenv/core";
import { PROVIDER_PROTOCOL, PROVIDER_PROTOCOL_VERSION } from "@cloakenv/core";

const repoRoot = resolve(import.meta.dir, "../..", "..");
const cliEntry = join(repoRoot, "apps/cli/src/index.ts");
const testArtifacts: string[] = [];
const testServers: Server[] = [];

describe("brokered CLI commands", () => {
  afterEach(async () => {
    await Promise.all(
      testServers.splice(0).map(
        (server) =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      ),
    );

    for (const artifact of testArtifacts.splice(0)) {
      rmSync(artifact, { recursive: true, force: true });
    }
  });

  test("get reports when desktop broker is unavailable", async () => {
    const endpoint = createBrokerEndpoint();
    const result = await runCli(["get", "API_KEY"], { endpoint });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "CloakEnv provider is not running. Start the desktop app or `cloakenv provider start` and try again.",
    );
  });

  test("get reports missing secrets from broker", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeBroker(endpoint, (socket, requestId) => {
      sendBrokerMessage(socket, {
        type: "response",
        requestId,
        ok: false,
        error: {
          code: "secret_not_found",
          message: 'Secret "API_KEY" not found in project "cloakenv".',
        },
      });
      socket.end();
    });

    const result = await runCli(["get", "API_KEY"], { endpoint });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Secret "API_KEY" not found in project "cloakenv".');
  });

  test("get includes requester metadata for trace visibility", async () => {
    const endpoint = createBrokerEndpoint();
    let capturedRequest: Extract<BrokerClientMessage, { type: "request" }>["request"] | null = null;

    await startFakeBroker(endpoint, (socket, requestId, message) => {
      capturedRequest = message.request;
      sendBrokerMessage(socket, {
        type: "response",
        requestId,
        ok: true,
        data: {
          projectName: "cloakenv",
          value: "secret-value",
        },
      });
      socket.end();
    });

    const result = await runCli(["get", "API_KEY"], { endpoint });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("secret-value");
    expect(capturedRequest?.kind).toBe("get");
    expect(capturedRequest?.cwd).toBe(repoRoot);
    expect(typeof capturedRequest?.requester?.processName).toBe("string");
    expect(capturedRequest?.requester?.processPid).toBeGreaterThan(0);
    expect(capturedRequest?.requester?.hasTty).toBe(false);
    expect(capturedRequest?.requester?.argv).toContain("get");
    expect(capturedRequest?.requester?.argv).toContain("API_KEY");
    expect(capturedRequest?.scope).toBeUndefined();
  });

  test("run reports unsupported desktop auth mode", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeProvider(endpoint, (socket, requestId) => {
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: false,
        error: {
          code: "auth_mode_unsupported",
          message:
            "Desktop-mediated sensitive access is not available when auth mode is set to passphrase.",
        },
      });
      socket.end();
    });

    const result = await runCli(["run", "--", "node", "-e", "console.log('hello')"], {
      endpoint,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Desktop-mediated sensitive access is not available when auth mode is set to passphrase.",
    );
    expect(result.stderr).toContain("run `cloakenv provider start` for foreground approvals.");
  });

  test("run resolves env and spawns locally after provider approval", async () => {
    const endpoint = createBrokerEndpoint();
    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;
    await startFakeProvider(endpoint, (socket, requestId, message) => {
      capturedRequest = message.request;
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: true,
        data: {
          projectId: "project-1",
          projectName: "cloakenv",
          env: {
            API_KEY: "secret-value",
          },
        },
      });
      socket.end();
    });

    const result = await runCli(
      ["run", "--", process.execPath, "-e", "console.log(process.env.API_KEY ?? 'missing')"],
      {
        endpoint,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("secret-value");
    expect(capturedRequest?.kind).toBe("resolve_environment");
  });

  test("run reports when no secrets are available", async () => {
    const endpoint = createBrokerEndpoint();
    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;
    await startFakeProvider(endpoint, (socket, requestId, message) => {
      capturedRequest = message.request;
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: false,
        error: {
          code: "no_secrets",
          message: 'No secrets found for scope "staging".',
        },
      });
      socket.end();
    });

    const result = await runCli(["run", "--scope", "staging", "--", "node", "-e", "1"], {
      endpoint,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No secrets found for scope "staging".');
    expect(capturedRequest?.kind).toBe("resolve_environment");
  });

  test("run reports local child spawn failures after env resolution", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeProvider(endpoint, (socket, requestId) => {
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: true,
        data: {
          projectId: "project-1",
          projectName: "cloakenv",
          env: {},
        },
      });
      socket.end();
    });

    const result = await runCli(["run", "--", "missing-command"], { endpoint });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing-command");
  });

  test("export reports broker-side export failures", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeBroker(endpoint, (socket, requestId) => {
      sendBrokerMessage(socket, {
        type: "response",
        requestId,
        ok: false,
        error: {
          code: "request_failed",
          message: "Failed to write export file.",
        },
      });
      socket.end();
    });

    const result = await runCli(["export", "--output", "./tmp.cloaked"], {
      endpoint,
      stdin: "thunder-cactus-orbit-maple-4821-signal\n",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to write export file.");
  });

  test("provider status reports session diagnostics from the running provider", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeProvider(endpoint, (socket, requestId, message) => {
      expect(message.request.kind).toBe("status");
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: true,
        data: {
          reachable: true,
          mode: "desktop",
          approvalMode: "native",
          endpoint,
          endpointSource: "env",
          transport: process.platform === "win32" ? "named_pipe" : "unix_socket",
          authMode: "keychain",
          desktopSensitiveAvailable: true,
          providerSessionTtlMinutes: 15,
          activeSessionCount: 1,
          activeSessions: [
            {
              id: "session-1",
              action: "resolve_environment",
              projectId: "project-1",
              projectName: "cloakenv",
              scope: ".env.local",
              workingDir: repoRoot,
              requesterLabel: "vite",
              commandPreview: "vite dev",
              createdAt: Date.now(),
              expiresAt: Date.now() + 60_000,
              reuseCount: 2,
            },
          ],
        },
      });
      socket.end();
    });

    const result = await runCli(["provider", "status"], { endpoint });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Reachable:              yes");
    expect(result.stdout).toContain("Provider session:       15 minutes");
    expect(result.stdout).toContain("Session leases:");
    expect(result.stdout).toContain("cloakenv :: .env.local :: resolve_environment :: vite");
  });

  test("provider expire clears a session by id", async () => {
    const endpoint = createBrokerEndpoint();
    await startFakeProvider(endpoint, (socket, requestId, message) => {
      expect(message.request.kind).toBe("expire_session");
      expect(message.request.sessionId).toBe("session-1");
      sendProviderMessage(socket, {
        protocol: PROVIDER_PROTOCOL,
        version: PROVIDER_PROTOCOL_VERSION,
        type: "response",
        requestId,
        ok: true,
        data: {
          expired: 1,
          remaining: 0,
          expiredSessionId: "session-1",
        },
      });
      socket.end();
    });

    const result = await runCli(["provider", "expire", "session-1"], { endpoint });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Expired provider session session-1.");
    expect(result.stdout).toContain("0 sessions remain.");
  });
});

async function startFakeBroker(
  endpoint: string,
  onRequest: (socket: Socket, requestId: string, message: BrokerClientMessage) => void,
): Promise<void> {
  const server = createServer((socket) => {
    let buffer = "";

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

        const message = JSON.parse(line) as BrokerClientMessage;
        if (message.type !== "request") {
          continue;
        }

        onRequest(socket, message.request.requestId, message);
      }
    });
  });

  testServers.push(server);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(endpoint, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function startFakeProvider(
  endpoint: string,
  onRequest: (socket: Socket, requestId: string, message: ProviderClientMessage) => void,
): Promise<void> {
  const server = createServer((socket) => {
    let buffer = "";

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

        const message = JSON.parse(line) as ProviderClientMessage;
        if (
          message.protocol !== PROVIDER_PROTOCOL ||
          message.version !== PROVIDER_PROTOCOL_VERSION ||
          message.type !== "request"
        ) {
          continue;
        }

        onRequest(socket, message.request.requestId, message);
      }
    });
  });

  testServers.push(server);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(endpoint, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

function createBrokerEndpoint(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cloakenv-test-${crypto.randomUUID()}`;
  }

  const dir = mkdtempSync(join(tmpdir(), "cloakenv-cli-test-"));
  testArtifacts.push(dir);
  return join(dir, "approval-broker.sock");
}

async function runCli(
  args: string[],
  options: {
    endpoint: string;
    stdin?: string;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["run", cliEntry, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLOAKENV_APPROVAL_BROKER_ENDPOINT: options.endpoint,
      CLOAKENV_PROVIDER_ENDPOINT: options.endpoint,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (options.stdin) {
    child.stdin.write(options.stdin);
  }
  child.stdin.end();

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code) => resolveExit(code ?? 1));
  });

  return { exitCode, stdout, stderr };
}

function sendBrokerMessage(socket: Socket, message: BrokerServerMessage): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

function sendProviderMessage(socket: Socket, message: ProviderServerMessage): void {
  socket.write(`${JSON.stringify(message)}\n`);
}
