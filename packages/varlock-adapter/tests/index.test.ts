import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import type { ProviderClientMessage } from "@cloakenv/core";
import { PROVIDER_PROTOCOL, PROVIDER_PROTOCOL_VERSION } from "@cloakenv/core";
import { prepareVarlockEnvironment } from "../src";

const originalEndpoint = process.env.CLOAKENV_PROVIDER_ENDPOINT;
const originalApiKey = process.env.API_KEY;
const testArtifacts: string[] = [];
const testServers: Server[] = [];

describe("@cloakenv/varlock-adapter", () => {
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
      rmSync(artifact, { force: true });
    }

    if (originalEndpoint) {
      process.env.CLOAKENV_PROVIDER_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.CLOAKENV_PROVIDER_ENDPOINT;
    }

    if (typeof originalApiKey === "string") {
      process.env.API_KEY = originalApiKey;
    } else {
      delete process.env.API_KEY;
    }
  });

  test("prepares and injects env before a Varlock-style bootstrap", async () => {
    const endpoint = createProviderEndpoint();
    process.env.CLOAKENV_PROVIDER_ENDPOINT = endpoint;

    let capturedRequest: Extract<ProviderClientMessage, { type: "request" }>["request"] | null =
      null;

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

          capturedRequest = message.request;
          socket.write(
            `${JSON.stringify({
              protocol: PROVIDER_PROTOCOL,
              version: PROVIDER_PROTOCOL_VERSION,
              type: "response",
              requestId: message.request.requestId,
              ok: true,
              data: {
                projectId: "project-1",
                projectName: "demo-app",
                env: {
                  API_KEY: "resolved-from-provider",
                },
              },
            })}\n`,
          );
          socket.end();
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

    const prepared = await prepareVarlockEnvironment({
      projectName: "demo-app",
      scope: ".env.local",
    });

    expect(capturedRequest?.kind).toBe("resolve_environment");
    expect(capturedRequest?.projectName).toBe("demo-app");
    expect(capturedRequest?.scope).toBe(".env.local");
    expect(capturedRequest?.requester?.processName).toBeDefined();
    expect(prepared.projectId).toBe("project-1");
    expect(prepared.projectName).toBe("demo-app");
    expect(prepared.env.API_KEY).toBe("resolved-from-provider");
    expect(process.env.API_KEY).toBe("resolved-from-provider");
  });
});

function createProviderEndpoint(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\cloakenv-varlock-${crypto.randomUUID()}`;
  }

  const endpoint = join("/tmp", `ce-varlock-${crypto.randomUUID().slice(0, 8)}.sock`);
  testArtifacts.push(endpoint);
  return endpoint;
}
