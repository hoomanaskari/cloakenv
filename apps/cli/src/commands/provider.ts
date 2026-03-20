import type { Server } from "node:net";
import { createInterface } from "node:readline/promises";
import {
  ConfigRepository,
  expireProviderSession,
  getDatabase,
  getProviderEndpoint,
  getProviderEndpointInfo,
  getProviderStatus,
} from "@cloakenv/core";
import type { Command } from "commander";
import { startProviderServer, stopProviderServer } from "../../../../src/bun/approval-broker";
import { createVaultHandlers } from "../../../../src/bun/handlers";
import type {
  ProviderDiagnosticsInfo,
  ProviderSessionExpiryResultInfo,
} from "../../../../src/shared/types";
import { getVaultContext } from "../utils/context";

interface StartProviderOptions {
  quiet?: boolean;
}

let approvalPromptQueue: Promise<void> = Promise.resolve();

export function registerProviderCommand(program: Command): void {
  const provider = program
    .command("provider")
    .description("Run the local CloakEnv provider in the foreground");

  provider
    .command("status")
    .description("Show provider reachability, approval mode, and session diagnostics")
    .action(async () => {
      const db = getDatabase();
      const repo = new ConfigRepository(db);
      const endpointInfo = getProviderEndpointInfo();
      const localConfig = repo.getAll();

      try {
        const diagnostics = await getProviderStatus<ProviderDiagnosticsInfo>();
        printProviderStatus(diagnostics);
      } catch (error) {
        printProviderStatus({
          reachable: false,
          mode: "desktop",
          approvalMode: "native",
          endpoint: endpointInfo.endpoint,
          endpointSource: endpointInfo.source,
          transport: endpointInfo.transport,
          authMode: localConfig.authMode,
          desktopSensitiveAvailable: localConfig.authMode === "keychain",
          providerSessionTtlMinutes: localConfig.providerSessionTtlMinutes,
          activeSessionCount: 0,
          activeSessions: [],
        });
        console.error(error instanceof Error ? error.message : "Provider status check failed.");
        process.exit(1);
      }
    });

  provider
    .command("expire [sessionId]")
    .description("Expire one provider session by id, or pass --all to clear every live session")
    .option("--all", "Expire all live provider sessions")
    .action(async (sessionId: string | undefined, options: { all?: boolean }) => {
      if (options.all && sessionId) {
        console.error("Use either a session id or --all, not both.");
        process.exit(1);
      }

      if (!options.all && !sessionId) {
        console.error("Provide a session id or use --all.");
        process.exit(1);
      }

      try {
        const result = await expireProviderSession<ProviderSessionExpiryResultInfo>({
          kind: "expire_session",
          requestId: crypto.randomUUID(),
          all: options.all ?? false,
          sessionId,
        });

        if (options.all) {
          console.log(
            `Expired ${result.expired} session${result.expired === 1 ? "" : "s"}. ${result.remaining} remaining.`,
          );
          return;
        }

        if (result.expired === 0) {
          console.log(`No active provider session matched ${sessionId}.`);
          return;
        }

        console.log(`Expired provider session ${result.expiredSessionId}.`);
        console.log(`${result.remaining} session${result.remaining === 1 ? "" : "s"} remain.`);
      } catch (error) {
        console.error(
          error instanceof Error ? error.message : "Failed to expire provider session.",
        );
        process.exit(1);
      }
    });

  provider
    .command("start")
    .description("Run the local provider in the foreground with terminal approvals")
    .option("--quiet", "Suppress startup and shutdown log lines")
    .action(async (options: StartProviderOptions) => {
      const endpoint = getProviderEndpoint();

      try {
        const vault = await getVaultContext();
        const handlers = createVaultHandlers({
          getMasterKey: async () => vault.masterKey,
          providerMode: "foreground",
          requestNativeApproval: async (dialog) => requestTerminalApproval(dialog),
          showNativeNotification: options.quiet
            ? undefined
            : (notification) => {
                const parts = [notification.title, notification.subtitle, notification.body].filter(
                  Boolean,
                );
                if (parts.length > 0) {
                  console.log(`[cloakenv provider] ${parts.join(" | ")}`);
                }
              },
        });
        const server = startProviderServer(handlers);

        await waitForServerReady(server);

        if (!options.quiet) {
          console.log(`[cloakenv provider] Listening on ${endpoint}`);
          console.log(
            "[cloakenv provider] Foreground approvals are enabled. Press Ctrl+C to stop.",
          );
        }

        await waitForShutdown(server, options.quiet ?? false);
      } catch (error) {
        console.error(formatProviderStartError(error, endpoint));
        process.exit(1);
      }
    });
}

async function requestTerminalApproval(dialog: {
  title: string;
  message: string;
  detail: string;
}): Promise<boolean> {
  return runExclusiveApprovalPrompt(async () => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error("[cloakenv provider] Approval requested without an interactive terminal.");
      return false;
    }

    process.stdout.write(`\n[cloakenv provider] ${dialog.title}\n`);
    process.stdout.write(`${dialog.message}\n`);
    if (dialog.detail.trim()) {
      process.stdout.write(`${dialog.detail}\n`);
    }

    return promptForTerminalConfirmation("Approve this request?", false);
  });
}

async function runExclusiveApprovalPrompt<T>(task: () => Promise<T>): Promise<T> {
  const previous = approvalPromptQueue;
  let release: (() => void) | null = null;
  approvalPromptQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release?.();
  }
}

async function promptForTerminalConfirmation(
  message: string,
  defaultValue: boolean,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
    const response = await rl.question(`${message}${suffix}`);
    return parseConfirmationResponse(response, defaultValue);
  } finally {
    rl.close();
  }
}

function parseConfirmationResponse(response: string, defaultValue: boolean): boolean {
  const normalized = response.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (normalized === "y" || normalized === "yes") {
    return true;
  }

  if (normalized === "n" || normalized === "no") {
    return false;
  }

  return defaultValue;
}

async function waitForServerReady(server: Server): Promise<void> {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

async function waitForShutdown(server: Server, quiet: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let shuttingDown = false;

    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void stopProviderServer(server)
        .then(() => {
          cleanup();
          if (!quiet) {
            console.log("[cloakenv provider] Stopped.");
          }
          resolve();
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    };

    const onSigint = () => shutdown();
    const onSigterm = () => shutdown();
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      server.off("error", onError);
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    server.once("error", onError);
  });
}

function formatProviderStartError(error: unknown, endpoint: string): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EADDRINUSE"
  ) {
    return `CloakEnv provider is already running on ${endpoint}. Stop the existing desktop or foreground provider before starting another one.`;
  }

  return error instanceof Error ? error.message : "Failed to start the CloakEnv provider.";
}

function printProviderStatus(diagnostics: ProviderDiagnosticsInfo): void {
  console.log("CloakEnv Provider Status:\n");
  console.log(`  Reachable:              ${diagnostics.reachable ? "yes" : "no"}`);
  console.log(`  Mode:                   ${diagnostics.mode}`);
  console.log(`  Approval mode:          ${diagnostics.approvalMode}`);
  console.log(`  Endpoint:               ${diagnostics.endpoint}`);
  console.log(
    `  Endpoint source:        ${diagnostics.endpointSource === "env" ? "environment override" : "default"}`,
  );
  console.log(`  Transport:              ${diagnostics.transport}`);
  console.log(`  Auth mode:              ${diagnostics.authMode}`);
  console.log(
    `  Desktop sensitive use:  ${diagnostics.desktopSensitiveAvailable ? "available" : "disabled"}`,
  );
  console.log(
    `  Provider session:       ${
      diagnostics.providerSessionTtlMinutes > 0
        ? `${diagnostics.providerSessionTtlMinutes} minute${diagnostics.providerSessionTtlMinutes === 1 ? "" : "s"}`
        : "disabled"
    }`,
  );
  console.log(`  Active sessions:        ${diagnostics.activeSessionCount}`);

  if (diagnostics.activeSessions.length === 0) {
    return;
  }

  console.log("\n  Session leases:");
  for (const session of diagnostics.activeSessions) {
    console.log(
      `  - ${session.projectName} :: ${session.scope} :: ${session.action} :: ${session.requesterLabel}`,
    );
    console.log(`    id:      ${session.id}`);
    console.log(`    command: ${session.commandPreview}`);
    console.log(`    folder:  ${session.workingDir}`);
    console.log(
      `    expires: ${new Date(session.expiresAt).toLocaleString()} (reused ${session.reuseCount} times)`,
    );
  }
}
