import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliCommandManager } from "./cli-command-manager";

const testArtifacts: string[] = [];
const originalShell = process.env.SHELL;
const originalPath = process.env.PATH;

afterEach(() => {
  process.env.SHELL = originalShell;
  process.env.PATH = originalPath;

  for (const artifact of testArtifacts.splice(0)) {
    rmSync(artifact, { force: true, recursive: true });
  }
});

describe("cli command manager", () => {
  test("installs the bundled CLI and records managed metadata", () => {
    const workspace = createTestWorkspace();
    writeBundledCliArtifact(workspace.rootDir, "cli-v1", "1.2.3");
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin";

    const manager = createTestManager(workspace);
    const result = manager.installCliCommand();

    expect(result.updated).toBe(false);
    expect(result.managed).toBe(true);
    expect(result.bundledVersion).toBe("1.2.3");
    expect(readInstalledCli(workspace.homeDir)).toBe("cli-v1");
    expect(existsSync(getMetadataPath(workspace.homeDir))).toBe(true);

    const status = manager.getCliInstallStatus();
    expect(status.bundled).toBe(true);
    expect(status.bundledVersion).toBe("1.2.3");
    expect(status.installed).toBe(true);
    expect(status.installedVersion).toBe("1.2.3");
    expect(status.managed).toBe(true);
    expect(status.upToDate).toBe(true);
    expect(status.updateAvailable).toBe(false);
    expect(status.pathConfigured).toBe(true);
  });

  test("adopts and updates legacy managed installs on startup sync", () => {
    const workspace = createTestWorkspace();
    writeBundledCliArtifact(workspace.rootDir, "cli-v2", "2.0.0");
    writeLegacyInstalledCli(workspace.homeDir, "legacy-cli");
    writeLegacyShellBootstrap(workspace.homeDir);
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin";

    const manager = createTestManager(workspace);
    const sync = manager.syncInstalledCliCommand();

    expect(sync.managed).toBe(true);
    expect(sync.updated).toBe(true);
    expect(sync.adoptedLegacyInstall).toBe(true);
    expect(readInstalledCli(workspace.homeDir)).toBe("cli-v2");
    expect(existsSync(getMetadataPath(workspace.homeDir))).toBe(true);

    const status = manager.getCliInstallStatus();
    expect(status.managed).toBe(true);
    expect(status.upToDate).toBe(true);
    expect(status.installedVersion).toBe("2.0.0");
  });

  test("does not overwrite unmanaged installs without management metadata", () => {
    const workspace = createTestWorkspace();
    writeBundledCliArtifact(workspace.rootDir, "bundled-cli", "3.0.0");
    writeLegacyInstalledCli(workspace.homeDir, "custom-cli");
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin";

    const manager = createTestManager(workspace);
    const sync = manager.syncInstalledCliCommand();

    expect(sync.managed).toBe(false);
    expect(sync.updated).toBe(false);
    expect(sync.adoptedLegacyInstall).toBe(false);
    expect(readInstalledCli(workspace.homeDir)).toBe("custom-cli");

    const status = manager.getCliInstallStatus();
    expect(status.installed).toBe(true);
    expect(status.managed).toBe(false);
    expect(status.updateAvailable).toBe(false);
  });

  test("uses digests to refresh managed installs even when the version string is unchanged", () => {
    const workspace = createTestWorkspace();
    writeBundledCliArtifact(workspace.rootDir, "cli-v1", "0.1.0");
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin";

    const manager = createTestManager(workspace);
    manager.installCliCommand();

    writeBundledCliArtifact(workspace.rootDir, "cli-v2", "0.1.0");

    const preSyncStatus = manager.getCliInstallStatus();
    expect(preSyncStatus.updateAvailable).toBe(true);
    expect(preSyncStatus.installedVersion).toBe("0.1.0");

    const sync = manager.syncInstalledCliCommand();
    expect(sync.updated).toBe(true);
    expect(sync.managed).toBe(true);
    expect(readInstalledCli(workspace.homeDir)).toBe("cli-v2");

    const status = manager.getCliInstallStatus();
    expect(status.upToDate).toBe(true);
    expect(status.updateAvailable).toBe(false);
    expect(status.installedVersion).toBe("0.1.0");
  });
});

function createTestWorkspace(): { homeDir: string; importDir: string; rootDir: string } {
  const rootDir = join(tmpdir(), `cloakenv-cli-${crypto.randomUUID()}`);
  mkdirSync(rootDir, { recursive: true });
  testArtifacts.push(rootDir);

  const homeDir = join(rootDir, "home");
  const importDir = join(rootDir, "src", "bun");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(importDir, { recursive: true });

  return { homeDir, importDir, rootDir };
}

function createTestManager(workspace: { homeDir: string; importDir: string; rootDir: string }) {
  return createCliCommandManager({
    arch: "arm64",
    execPath: join(workspace.rootDir, "fake-app", "CloakEnv"),
    homeDir: workspace.homeDir,
    importDir: workspace.importDir,
    platform: "darwin",
  });
}

function writeBundledCliArtifact(rootDir: string, contents: string, version: string): void {
  const bundledDir = join(rootDir, "apps", "cli", "dist", "bin");
  mkdirSync(bundledDir, { recursive: true });
  writeFileSync(join(bundledDir, "cloakenv-darwin-arm64"), contents, "utf8");
  writeFileSync(
    join(bundledDir, "manifest.json"),
    JSON.stringify(
      {
        cliFileName: "cloakenv-darwin-arm64",
        targetArch: "arm64",
        targetOs: "macos",
        version,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeLegacyInstalledCli(homeDir: string, contents: string): void {
  const binDir = join(homeDir, ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "cloakenv"), contents, "utf8");
}

function writeLegacyShellBootstrap(homeDir: string): void {
  const binDir = join(homeDir, ".local", "bin");
  writeFileSync(
    join(homeDir, ".zprofile"),
    ["# >>> CloakEnv CLI >>>", `export PATH="${binDir}:$PATH"`, "# <<< CloakEnv CLI <<<", ""].join(
      "\n",
    ),
    "utf8",
  );
}

function readInstalledCli(homeDir: string): string {
  return readFileSync(join(homeDir, ".local", "bin", "cloakenv"), "utf8");
}

function getMetadataPath(homeDir: string): string {
  return join(homeDir, ".local", "bin", ".cloakenv-install.json");
}
