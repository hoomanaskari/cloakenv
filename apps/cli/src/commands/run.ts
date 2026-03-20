import { type ChildProcess, spawn } from "node:child_process";
import { createSpawnEnvironment, getProcessContext } from "@cloakenv/core";
import type { Command } from "commander";
import { formatSensitiveRequestError } from "../utils/approval-broker";
import { resolveEnvironment } from "../utils/provider-client";

const RUN_TERMINATION_TIMEOUT_MS = 2_000;

export function registerRunCommand(program: Command): void {
  program.enablePositionalOptions();

  program
    .command("run")
    .description("Spawn a child process with decrypted secrets as environment variables")
    .option("--scope <tag>", "Only inject secrets matching this scope")
    .option("--project <name>", "Explicit project name")
    .argument("<command...>", "Command to run (after --)")
    .passThroughOptions()
    .action(async (commandArgs: string[], options: { scope?: string; project?: string }) => {
      const requester = getProcessContext();
      const cwd = process.cwd();

      try {
        const resolved = await resolveEnvironment({
          kind: "resolve_environment",
          requestId: crypto.randomUUID(),
          projectName: options.project,
          cwd,
          requester,
          scope: options.scope,
        });
        const env = createSpawnEnvironment({
          cwd,
          baseEnv: process.env,
          injectedEnv: resolved.env,
          launcherPath: process.env.PATH,
        });
        const exitCode = await runLocalCommand(commandArgs, {
          cwd,
          env,
        });

        process.exit(exitCode);
      } catch (error) {
        console.error(formatSensitiveRequestError(error));
        process.exit(1);
      }
    });
}

async function runLocalCommand(
  argv: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<number> {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let signalForwardPromise: Promise<void> | null = null;

    const cleanup = () => {
      clearTerminationTimer();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      child.off("error", onError);
      child.off("close", onClose);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    let terminationTimer: NodeJS.Timeout | null = null;
    const clearTerminationTimer = () => {
      if (!terminationTimer) {
        return;
      }

      clearTimeout(terminationTimer);
      terminationTimer = null;
    };

    const scheduleForcedTermination = () => {
      if (terminationTimer || hasChildExited(child)) {
        return;
      }

      terminationTimer = setTimeout(() => {
        if (!hasChildExited(child)) {
          sendSignalToChildProcess(child, "SIGKILL");
        }
      }, RUN_TERMINATION_TIMEOUT_MS);
      terminationTimer.unref?.();
    };

    const forwardSignal = async (signal: NodeJS.Signals) => {
      if (hasChildExited(child)) {
        return;
      }

      if (signalForwardPromise) {
        sendSignalToChildProcess(child, signal);
        return signalForwardPromise;
      }

      signalForwardPromise = new Promise<void>((resolveSignal) => {
        scheduleForcedTermination();

        const onSettled = () => {
          child.off("close", onSettled);
          child.off("exit", onSettled);
          resolveSignal();
        };

        child.once("close", onSettled);
        child.once("exit", onSettled);
        sendSignalToChildProcess(child, signal);
      });

      try {
        await signalForwardPromise;
      } finally {
        signalForwardPromise = null;
      }
    };

    const onSigint = () => {
      void forwardSignal("SIGINT");
    };

    const onSigterm = () => {
      void forwardSignal("SIGTERM");
    };

    const onError = (error: Error) => {
      finish(() => reject(error));
    };

    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      finish(() => resolve(normalizeExitCode(exitCode, signal)));
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function sendSignalToChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (hasChildExited(child)) {
    return;
  }

  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    try {
      child.kill(signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return;
  }

  if (process.platform === "win32") {
    terminateWindowsProcessTree(pid, signal, child);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (isMissingProcessError(error)) {
      return;
    }

    if (!isPermissionProcessError(error)) {
      throw error;
    }

    try {
      child.kill(signal);
    } catch (killError) {
      if (!isMissingProcessError(killError)) {
        throw killError;
      }
    }
  }
}

function terminateWindowsProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  child: ChildProcess,
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

function hasChildExited(child: ChildProcess): boolean {
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
