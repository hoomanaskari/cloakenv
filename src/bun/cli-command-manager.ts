import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { CliInstallResultInfo, CliInstallStatusInfo } from "../shared/types";

const CLI_NAME = "cloakenv";
const UNIX_BIN_DIR_NAME = ".local/bin";
const WINDOWS_BIN_DIR_NAME = "CloakEnv/bin";
const UNIX_PATH_MARKER_START = "# >>> CloakEnv CLI >>>";
const UNIX_PATH_MARKER_END = "# <<< CloakEnv CLI <<<";
const CLI_INSTALL_METADATA_FILE_UNIX = ".cloakenv-install.json";
const CLI_INSTALL_METADATA_FILE_WINDOWS = "cloakenv-install.json";

interface BundledCliManifest {
  cliFileName?: string;
  targetOs?: string;
  targetArch?: string;
  version?: string;
}

interface BundledCliInfo {
  digest: string;
  path: string;
  version: string | null;
}

interface CliInstallMetadata {
  bundledDigest: string;
  bundledVersion: string | null;
  installMethod: "bundled-copy";
  installPath: string;
  installedAt: number;
  managedBy: "cloakenv-desktop";
  schemaVersion: 1;
}

interface CliInstallState {
  binDirectory: string;
  bundledCli: BundledCliInfo | null;
  installPath: string;
  installed: boolean;
  installedDigest: string | null;
  installedVersion: string | null;
  legacyManaged: boolean;
  managed: boolean;
  metadata: CliInstallMetadata | null;
  pathConfigured: boolean;
  shellIntegrationPath: string | null;
  upToDate: boolean;
  updateAvailable: boolean;
}

export interface CliSyncResult {
  adoptedLegacyInstall: boolean;
  bundledVersion: string | null;
  installPath: string | null;
  managed: boolean;
  updated: boolean;
}

export interface CliCommandManagerOptions {
  arch: string;
  execPath: string;
  homeDir: string;
  importDir: string;
  localAppData?: string;
  now?: () => number;
  platform: NodeJS.Platform;
}

export function createCliCommandManager(options: CliCommandManagerOptions) {
  const now = options.now ?? (() => Date.now());

  const isWindows = (): boolean => options.platform === "win32";

  const getCliExecutableName = (): string => (isWindows() ? `${CLI_NAME}.exe` : CLI_NAME);

  const getCompiledCliArtifactFileName = (): string | null => {
    if (options.platform === "darwin" && options.arch === "arm64") {
      return "cloakenv-darwin-arm64";
    }

    if (options.platform === "darwin" && options.arch === "x64") {
      return "cloakenv-darwin-x64";
    }

    if (options.platform === "linux" && options.arch === "x64") {
      return "cloakenv-linux-x64";
    }

    if (options.platform === "win32" && options.arch === "x64") {
      return "cloakenv-windows-x64.exe";
    }

    return null;
  };

  const getTargetBinDirectory = (): string =>
    isWindows()
      ? join(
          options.localAppData ?? join(options.homeDir, "AppData", "Local"),
          WINDOWS_BIN_DIR_NAME,
        )
      : join(options.homeDir, UNIX_BIN_DIR_NAME);

  const getInstalledCliPath = (): string => join(getTargetBinDirectory(), getCliExecutableName());

  const getCliMetadataPath = (): string =>
    join(
      getTargetBinDirectory(),
      isWindows() ? CLI_INSTALL_METADATA_FILE_WINDOWS : CLI_INSTALL_METADATA_FILE_UNIX,
    );

  const getBundledCliDirectories = (): string[] => {
    const execDir = dirname(options.execPath);
    const candidates = [
      resolve(execDir, "..", "Resources", "cli"),
      resolve(execDir, "..", "..", "Resources", "cli"),
      resolve(options.importDir, "cli"),
      resolve(options.importDir, "..", "Resources", "cli"),
      resolve(options.importDir, "..", "..", "apps", "cli", "dist", "release"),
      resolve(options.importDir, "..", "..", "apps", "cli", "dist", "bin"),
    ];

    return [...new Set(candidates)];
  };

  const getShellProfilePath = (): string | null => {
    if (isWindows()) {
      return null;
    }

    const shell = process.env.SHELL ?? "";
    if (shell.endsWith("zsh")) {
      return join(options.homeDir, ".zprofile");
    }

    if (shell.endsWith("bash")) {
      return join(options.homeDir, ".bash_profile");
    }

    return join(options.homeDir, ".profile");
  };

  const splitPathEntries = (pathValue: string | undefined): string[] =>
    (pathValue ?? "")
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const hasPathEntry = (pathValue: string | undefined, entry: string): boolean => {
    const normalizedEntry = isWindows() ? entry.toLowerCase() : entry;
    return splitPathEntries(pathValue).some(
      (candidate) => (isWindows() ? candidate.toLowerCase() : candidate) === normalizedEntry,
    );
  };

  const hasUnixPathBootstrap = (profilePath: string | null): boolean => {
    if (!profilePath || !existsSync(profilePath)) {
      return false;
    }

    const contents = readFileSync(profilePath, "utf8");
    const binDirectory = getTargetBinDirectory();
    return (
      contents.includes(UNIX_PATH_MARKER_START) &&
      contents.includes(UNIX_PATH_MARKER_END) &&
      contents.includes(binDirectory)
    );
  };

  const ensureParentDirectory = (filePath: string): void => {
    mkdirSync(dirname(filePath), { recursive: true });
  };

  const ensureUnixPathConfigured = (
    binDirectory: string,
  ): {
    pathConfigured: boolean;
    requiresRestart: boolean;
    shellIntegrationPath: string | null;
  } => {
    const profilePath = getShellProfilePath();
    const alreadyInCurrentPath = hasPathEntry(process.env.PATH, binDirectory);
    if (alreadyInCurrentPath) {
      return {
        pathConfigured: true,
        requiresRestart: false,
        shellIntegrationPath: profilePath,
      };
    }

    if (!profilePath) {
      return {
        pathConfigured: false,
        requiresRestart: true,
        shellIntegrationPath: null,
      };
    }

    if (!hasUnixPathBootstrap(profilePath)) {
      ensureParentDirectory(profilePath);
      const existing = existsSync(profilePath) ? readFileSync(profilePath, "utf8") : "";
      const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : "";
      const snippet = [
        UNIX_PATH_MARKER_START,
        `export PATH="${binDirectory}:$PATH"`,
        UNIX_PATH_MARKER_END,
        "",
      ].join("\n");
      writeFileSync(profilePath, `${existing}${separator}${snippet}`, "utf8");
    }

    process.env.PATH = [binDirectory, ...splitPathEntries(process.env.PATH)].join(delimiter);

    return {
      pathConfigured: true,
      requiresRestart: true,
      shellIntegrationPath: profilePath,
    };
  };

  const runWindowsPathUpdate = (binDirectory: string): void => {
    const powershellScript = [
      "$binDir = $args[0]",
      "$existing = [Environment]::GetEnvironmentVariable('Path', 'User')",
      "if ([string]::IsNullOrWhiteSpace($existing)) {",
      "  $next = $binDir",
      "} else {",
      "  $parts = $existing.Split(';') | Where-Object { $_ -and $_.Trim().Length -gt 0 }",
      "  if ($parts -contains $binDir) {",
      "    $next = $existing",
      "  } else {",
      "    $next = ($parts + $binDir) -join ';'",
      "  }",
      "}",
      "[Environment]::SetEnvironmentVariable('Path', $next, 'User')",
    ].join("; ");

    const result = Bun.spawnSync(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        powershellScript,
        binDirectory,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (!result.success) {
      const stderr = result.stderr.toString().trim();
      throw new Error(stderr || "Failed to update the Windows user PATH.");
    }
  };

  const ensureWindowsPathConfigured = (
    binDirectory: string,
  ): {
    pathConfigured: boolean;
    requiresRestart: boolean;
    shellIntegrationPath: string | null;
  } => {
    const alreadyConfigured = hasPathEntry(process.env.PATH, binDirectory);
    if (!alreadyConfigured) {
      runWindowsPathUpdate(binDirectory);
      process.env.PATH = [binDirectory, ...splitPathEntries(process.env.PATH)].join(delimiter);
    }

    return {
      pathConfigured: true,
      requiresRestart: !alreadyConfigured,
      shellIntegrationPath: null,
    };
  };

  const isInstalledCliPresent = (installPath: string): boolean => {
    if (!existsSync(installPath)) {
      return false;
    }

    try {
      return existsSync(readlinkSync(installPath));
    } catch {
      return true;
    }
  };

  const readBundledCliManifest = (directory: string): BundledCliManifest | null => {
    const manifestPath = join(directory, "manifest.json");
    if (!existsSync(manifestPath)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(manifestPath, "utf8")) as BundledCliManifest;
    } catch {
      return null;
    }
  };

  const computeFileDigest = (filePath: string): string =>
    createHash("sha256").update(readFileSync(filePath)).digest("hex");

  const getBundledCliInfo = (): BundledCliInfo | null => {
    for (const directory of getBundledCliDirectories()) {
      const manifest = readBundledCliManifest(directory);
      const compiledArtifactName = getCompiledCliArtifactFileName();
      const candidates = [
        join(directory, getCliExecutableName()),
        manifest?.cliFileName ? join(directory, manifest.cliFileName) : null,
        compiledArtifactName ? join(directory, compiledArtifactName) : null,
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of [...new Set(candidates)]) {
        if (!existsSync(candidate)) {
          continue;
        }

        return {
          digest: computeFileDigest(candidate),
          path: candidate,
          version: manifest?.version ?? null,
        };
      }
    }

    return null;
  };

  const readInstallMetadata = (): CliInstallMetadata | null => {
    const metadataPath = getCliMetadataPath();
    if (!existsSync(metadataPath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<CliInstallMetadata>;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.managedBy !== "cloakenv-desktop" ||
        parsed.installMethod !== "bundled-copy" ||
        typeof parsed.installPath !== "string" ||
        typeof parsed.bundledDigest !== "string"
      ) {
        return null;
      }

      return {
        bundledDigest: parsed.bundledDigest,
        bundledVersion:
          typeof parsed.bundledVersion === "string" || parsed.bundledVersion === null
            ? parsed.bundledVersion
            : null,
        installMethod: "bundled-copy",
        installPath: parsed.installPath,
        installedAt: typeof parsed.installedAt === "number" ? parsed.installedAt : 0,
        managedBy: "cloakenv-desktop",
        schemaVersion: 1,
      };
    } catch {
      return null;
    }
  };

  const writeInstallMetadata = (metadata: Omit<CliInstallMetadata, "schemaVersion">): void => {
    writeFileSync(
      getCliMetadataPath(),
      JSON.stringify(
        {
          schemaVersion: 1,
          ...metadata,
        } satisfies CliInstallMetadata,
        null,
        2,
      ),
      "utf8",
    );
  };

  const isManagedMetadata = (
    metadata: CliInstallMetadata | null,
    installPath: string,
  ): metadata is CliInstallMetadata => metadata !== null && metadata.installPath === installPath;

  const writeBundledCliToInstallPath = (
    bundledCli: BundledCliInfo,
    installPath: string,
    binDirectory: string,
  ): void => {
    mkdirSync(binDirectory, { recursive: true });
    copyFileSync(bundledCli.path, installPath);

    if (!isWindows()) {
      chmodSync(installPath, 0o755);
    }

    writeInstallMetadata({
      bundledDigest: bundledCli.digest,
      bundledVersion: bundledCli.version,
      installMethod: "bundled-copy",
      installPath,
      installedAt: now(),
      managedBy: "cloakenv-desktop",
    });
  };

  const resolveInstallState = (): CliInstallState => {
    const bundledCli = getBundledCliInfo();
    const installPath = getInstalledCliPath();
    const binDirectory = getTargetBinDirectory();
    const installed = isInstalledCliPresent(installPath);
    const shellIntegrationPath = getShellProfilePath();
    const pathConfigured = isWindows()
      ? hasPathEntry(process.env.PATH, binDirectory)
      : hasPathEntry(process.env.PATH, binDirectory) || hasUnixPathBootstrap(shellIntegrationPath);
    const metadata = readInstallMetadata();
    const legacyManaged =
      installed && !isManagedMetadata(metadata, installPath) && (isWindows() || pathConfigured);
    const managed = installed && (isManagedMetadata(metadata, installPath) || legacyManaged);
    const installedDigest = installed && managed ? computeFileDigest(installPath) : null;
    const updateAvailable =
      installed &&
      managed &&
      bundledCli !== null &&
      installedDigest !== null &&
      installedDigest !== bundledCli.digest;
    const upToDate =
      installed &&
      managed &&
      bundledCli !== null &&
      installedDigest !== null &&
      installedDigest === bundledCli.digest;
    const installedVersion =
      metadata?.bundledVersion ?? (upToDate && bundledCli !== null ? bundledCli.version : null);

    return {
      binDirectory,
      bundledCli,
      installPath,
      installed,
      installedDigest,
      installedVersion,
      legacyManaged,
      managed,
      metadata,
      pathConfigured,
      shellIntegrationPath: pathConfigured ? shellIntegrationPath : null,
      upToDate,
      updateAvailable,
    };
  };

  const getCliInstallStatus = (): CliInstallStatusInfo => {
    const state = resolveInstallState();

    return {
      bundled: state.bundledCli !== null,
      bundledVersion: state.bundledCli?.version ?? null,
      installed: state.installed,
      installedVersion: state.installedVersion,
      installPath: state.installed ? state.installPath : null,
      binDirectory: state.binDirectory,
      managed: state.managed,
      pathConfigured: state.pathConfigured,
      shellIntegrationPath: state.shellIntegrationPath,
      upToDate: state.upToDate,
      updateAvailable: state.updateAvailable,
    };
  };

  const installCliCommand = (): CliInstallResultInfo => {
    const bundledCli = getBundledCliInfo();
    if (!bundledCli) {
      throw new Error("The packaged CLI binary is not available in this build.");
    }

    const installPath = getInstalledCliPath();
    const binDirectory = getTargetBinDirectory();
    const previousDigest = isInstalledCliPresent(installPath)
      ? computeFileDigest(installPath)
      : null;

    writeBundledCliToInstallPath(bundledCli, installPath, binDirectory);

    const pathSetup = isWindows()
      ? ensureWindowsPathConfigured(binDirectory)
      : ensureUnixPathConfigured(binDirectory);

    return {
      installPath,
      binDirectory,
      bundledVersion: bundledCli.version,
      installedVersion: bundledCli.version,
      managed: true,
      updated: previousDigest !== null && previousDigest !== bundledCli.digest,
      pathConfigured: pathSetup.pathConfigured,
      shellIntegrationPath: pathSetup.shellIntegrationPath,
      requiresRestart: pathSetup.requiresRestart,
    };
  };

  const syncInstalledCliCommand = (): CliSyncResult => {
    const state = resolveInstallState();
    if (!state.bundledCli || !state.installed || !state.managed) {
      return {
        adoptedLegacyInstall: false,
        bundledVersion: state.bundledCli?.version ?? null,
        installPath: state.installed ? state.installPath : null,
        managed: state.managed,
        updated: false,
      };
    }

    const adoptedLegacyInstall =
      state.legacyManaged || !isManagedMetadata(state.metadata, state.installPath);
    if (!state.updateAvailable && !adoptedLegacyInstall) {
      return {
        adoptedLegacyInstall: false,
        bundledVersion: state.bundledCli.version,
        installPath: state.installPath,
        managed: true,
        updated: false,
      };
    }

    writeBundledCliToInstallPath(state.bundledCli, state.installPath, state.binDirectory);

    return {
      adoptedLegacyInstall,
      bundledVersion: state.bundledCli.version,
      installPath: state.installPath,
      managed: true,
      updated: state.updateAvailable,
    };
  };

  return {
    getCliInstallStatus,
    installCliCommand,
    syncInstalledCliCommand,
  };
}
