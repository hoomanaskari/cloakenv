import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import type { ProviderClientMessage } from "@cloakenv/core";
import { resolveVarlockSecret } from "../src";

const originalBrokerEndpoint = process.env.CLOAKENV_APPROVAL_BROKER_ENDPOINT;
const originalProviderEndpoint = process.env.CLOAKENV_PROVIDER_ENDPOINT;
const originalCacheDir = process.env.CLOAKENV_VARLOCK_CACHE_DIR;
const testArtifacts: string[] = [];
const testServers: Server[] = [];

describe("@cloakenv/varlock-helper", () => {
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
      rmSync(artifact, { force: true, recursive: true });
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

    if (originalCacheDir) {
      process.env.CLOAKENV_VARLOCK_CACHE_DIR = originalCacheDir;
    } else {
      delete process.env.CLOAKENV_VARLOCK_CACHE_DIR;
    }

    delete process.env.APP_ENV;
  });

  test("resolves one secret through batched provider environment resolution", async () => {
    const endpoint = createProviderEndpoint();
    process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;
    process.env.CLOAKENV_VARLOCK_CACHE_DIR = createCacheDir();

    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;

    const server = await createResolveEnvironmentServer(endpoint, ({ request }) => {
      capturedRequest = request;
      return {
        env: {
          API_KEY: "resolved-from-provider",
        },
        projectId: "project-1",
        projectName: "demo-app",
      };
    });
    testServers.push(server);

    const workspaceDir = mkdtempSync(join("/tmp", "ce-varlock-helper-"));
    testArtifacts.push(workspaceDir);

    const resolved = await resolveVarlockSecret("API_KEY", {
      cwd: workspaceDir,
      projectName: "demo-app",
      scope: "development",
    });

    expect(capturedRequest?.kind).toBe("resolve_environment");
    expect(capturedRequest?.projectName).toBe("demo-app");
    expect(capturedRequest?.scope).toBe("development");
    expect(capturedRequest?.cwd).toBe(workspaceDir);
    expect(capturedRequest?.requester?.processName).toBeDefined();
    expect(resolved.projectName).toBe("demo-app");
    expect(resolved.value).toBe("resolved-from-provider");
  });

  test("reads scope from an environment variable when requested", async () => {
    const endpoint = createProviderEndpoint();
    process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;
    process.env.CLOAKENV_VARLOCK_CACHE_DIR = createCacheDir();
    process.env.APP_ENV = "preview";

    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;

    const server = await createResolveEnvironmentServer(endpoint, ({ request }) => {
      capturedRequest = request;
      return {
        env: {
          API_KEY: "scoped-value",
        },
        projectId: "project-2",
        projectName: "demo-app",
      };
    });
    testServers.push(server);

    await resolveVarlockSecret("API_KEY", {
      scopeEnv: "APP_ENV",
    });

    expect(capturedRequest?.scope).toBe("preview");
  });

  test("caches the resolved environment across multiple key lookups", async () => {
    const endpoint = createProviderEndpoint();
    process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;
    process.env.CLOAKENV_VARLOCK_CACHE_DIR = createCacheDir();

    let requestCount = 0;

    const server = await createResolveEnvironmentServer(endpoint, () => {
      requestCount += 1;
      return {
        env: {
          API_KEY: "cached-api-key",
          DATABASE_URL: "postgres://demo_user:demo_pass@localhost:5432/demo",
        },
        projectId: "project-3",
        projectName: "cached-demo",
      };
    });
    testServers.push(server);

    const workspaceDir = mkdtempSync(join("/tmp", "ce-varlock-helper-cache-"));
    testArtifacts.push(workspaceDir);

    const [apiKey, databaseUrl] = await Promise.all([
      resolveVarlockSecret("API_KEY", {
        cwd: workspaceDir,
        projectName: "cached-demo",
        scope: "development",
      }),
      resolveVarlockSecret("DATABASE_URL", {
        cwd: workspaceDir,
        projectName: "cached-demo",
        scope: "development",
      }),
    ]);

    expect(requestCount).toBe(1);
    expect(apiKey.value).toBe("cached-api-key");
    expect(databaseUrl.value).toBe("postgres://demo_user:demo_pass@localhost:5432/demo");
  });

  test("cli reuses the same cached environment across separate processes", async () => {
    const endpoint = createProviderEndpoint();
    process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;
    process.env.CLOAKENV_VARLOCK_CACHE_DIR = createCacheDir();

    let requestCount = 0;
    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;

    const server = await createResolveEnvironmentServer(endpoint, ({ request }) => {
      requestCount += 1;
      capturedRequest = request;
      return {
        env: {
          API_KEY: "cli-api-key",
          DATABASE_URL: "postgres://demo_user:demo_pass@localhost:5432/cli_demo",
        },
        projectId: "project-4",
        projectName: "cli-demo",
      };
    });
    testServers.push(server);

    const workspaceDir = mkdtempSync(join("/tmp", "ce-varlock-helper-cli-"));
    testArtifacts.push(workspaceDir);
    const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;

    const first = Bun.spawn({
      cmd: ["bun", cliPath, "get", "API_KEY", "--scope", "development"],
      cwd: workspaceDir,
      env: {
        ...process.env,
        CLOAKENV_PROVIDER_ENDPOINT: endpoint,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const second = Bun.spawn({
      cmd: ["bun", cliPath, "get", "DATABASE_URL", "--scope", "development"],
      cwd: workspaceDir,
      env: {
        ...process.env,
        CLOAKENV_PROVIDER_ENDPOINT: endpoint,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [firstExitCode, firstStdout, firstStderr, secondExitCode, secondStdout, secondStderr] =
      await Promise.all([
        first.exited,
        new Response(first.stdout).text(),
        new Response(first.stderr).text(),
        second.exited,
        new Response(second.stdout).text(),
        new Response(second.stderr).text(),
      ]);

    expect(firstExitCode).toBe(0);
    expect(secondExitCode).toBe(0);
    expect(firstStdout).toBe("cli-api-key\n");
    expect(secondStdout).toBe("postgres://demo_user:demo_pass@localhost:5432/cli_demo\n");
    expect(firstStderr).toBe("");
    expect(secondStderr).toBe("");
    expect(requestCount).toBe(1);
    expect(
      capturedRequest?.cwd === workspaceDir || capturedRequest?.cwd === `/private${workspaceDir}`,
    ).toBe(true);
    expect(capturedRequest?.kind).toBe("resolve_environment");
    expect(capturedRequest?.scope).toBe("development");
  });
});

async function createResolveEnvironmentServer(
  endpoint: string,
  handler: (payload: {
    request: Extract<ProviderClientMessage, { type: "request" }>["request"];
  }) => {
    env: Record<string, string>;
    projectId?: string;
    projectName: string;
  },
): Promise<Server> {
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
        if (message.type !== "request") {
          continue;
        }

        const data = handler({
          request: message.request,
        });

        socket.write(
          `${JSON.stringify({
            protocol: "cloakenv-provider",
            version: 1,
            type: "response",
            requestId: message.request.requestId,
            ok: true,
            data,
          })}\n`,
        );
        socket.end();
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(endpoint, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return server;
}

function createProviderEndpoint(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cloakenv-varlock-helper-${crypto.randomUUID()}`;
  }

  const endpoint = join("/tmp", `ce-varlock-helper-${crypto.randomUUID().slice(0, 8)}.sock`);
  testArtifacts.push(endpoint);
  return endpoint;
}

function createCacheDir(): string {
  const dir = mkdtempSync(join("/tmp", "ce-varlock-cache-"));
  testArtifacts.push(dir);
  return dir;
}
