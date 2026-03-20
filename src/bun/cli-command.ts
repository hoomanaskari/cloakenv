import { Utils } from "electrobun/bun";
import type { CliInstallResultInfo, CliInstallStatusInfo } from "../shared/types";
import { type CliSyncResult, createCliCommandManager } from "./cli-command-manager";

let cliCommandManager: ReturnType<typeof createCliCommandManager> | null = null;

function getCliCommandManager() {
  if (cliCommandManager) {
    return cliCommandManager;
  }

  cliCommandManager = createCliCommandManager({
    arch: process.arch,
    execPath: process.execPath,
    homeDir: Utils.paths.home,
    importDir: import.meta.dir,
    localAppData: process.env.LOCALAPPDATA,
    platform: process.platform,
  });

  return cliCommandManager;
}

export function getCliInstallStatus(): CliInstallStatusInfo {
  return getCliCommandManager().getCliInstallStatus();
}

export function installCliCommand(): CliInstallResultInfo {
  return getCliCommandManager().installCliCommand();
}

export function syncInstalledCliCommand(): CliSyncResult {
  return getCliCommandManager().syncInstalledCliCommand();
}
