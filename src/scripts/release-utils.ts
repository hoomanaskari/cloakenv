import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PackagedVersionInfo {
  version: string;
  hash: string;
  channel: string;
  baseUrl: string;
  name: string;
  identifier: string;
}

export function resolveReleaseBaseUrl(projectRoot: string): string {
  const explicitBaseUrl = process.env.CLOAKENV_RELEASE_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const repository = getGitHubRepository(projectRoot);
  if (!repository) {
    throw new Error(
      [
        "Unable to determine the GitHub release feed URL for this build.",
        "Set CLOAKENV_RELEASE_BASE_URL explicitly or ensure the origin remote points at a GitHub repository.",
      ].join(" "),
    );
  }

  return `https://github.com/${repository}/releases/latest/download`;
}

export function readMacArtifactVersionInfo(artifactsDir: string): PackagedVersionInfo {
  const tarballPath = join(artifactsDir, "stable-macos-arm64-CloakEnv.app.tar.zst");
  if (!existsSync(tarballPath)) {
    throw new Error(`Expected macOS app tarball not found: ${tarballPath}`);
  }

  const extractionResult = spawnSync(
    "zsh",
    [
      "-lc",
      `zstd -dc ${toShellLiteral(tarballPath)} | tar -xOf - CloakEnv.app/Contents/Resources/version.json`,
    ],
    {
      cwd: artifactsDir,
      encoding: "utf8",
    },
  );

  if (extractionResult.status !== 0) {
    const details = extractionResult.stderr.trim() || extractionResult.stdout.trim();
    throw new Error(
      `Unable to read packaged macOS updater metadata from ${tarballPath}${details ? `: ${details}` : ""}`,
    );
  }

  const rawJson = extractionResult.stdout.trim();
  if (!rawJson) {
    throw new Error(`Packaged macOS updater metadata is empty in ${tarballPath}`);
  }

  return JSON.parse(rawJson) as PackagedVersionInfo;
}

export function assertMacArtifactsReadyForDistribution(artifactsDir: string): void {
  const policyTool = findExecutable("syspolicy_check");
  if (!policyTool) {
    throw new Error("macOS distribution validation requires syspolicy_check to be available.");
  }

  const tarballPath = join(artifactsDir, "stable-macos-arm64-CloakEnv.app.tar.zst");
  const dmgPath = join(artifactsDir, "stable-macos-arm64-CloakEnv.dmg");
  const workDir = mkdtempSync(join(tmpdir(), "cloakenv-release-check-"));
  const mountPoint = join(workDir, "mnt");

  try {
    runShellCommand(
      `mkdir -p ${toShellLiteral(workDir)} && zstd -dc ${toShellLiteral(tarballPath)} | tar -xf - -C ${toShellLiteral(workDir)}`,
      `Unable to extract ${tarballPath} for distribution validation.`,
    );
    assertDistributionApproved(
      policyTool,
      join(workDir, "CloakEnv.app"),
      "packaged updater bundle",
    );

    runCommand(
      "hdiutil",
      ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath],
      `Unable to mount ${dmgPath} for distribution validation.`,
    );
    try {
      assertDistributionApproved(
        policyTool,
        join(mountPoint, "CloakEnv.app"),
        "installer app bundle",
      );
    } finally {
      spawnSync("hdiutil", ["detach", mountPoint], {
        stdio: "ignore",
      });
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function getGitHubRepository(projectRoot: string): string | null {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return parseGitHubRepository(result.stdout.trim());
}

function assertDistributionApproved(
  policyTool: string,
  appPath: string,
  label: string,
): void {
  const result = spawnSync(policyTool, ["distribution", appPath], {
    encoding: "utf8",
  });

  if (result.status === 0) {
    return;
  }

  const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  throw new Error(
    [
      `macOS distribution validation failed for the ${label}.`,
      details || `syspolicy_check exited with status ${result.status ?? "unknown"}.`,
    ].join("\n"),
  );
}

function findExecutable(name: string): string | null {
  const result = spawnSync("which", [name], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function parseGitHubRepository(remoteUrl: string): string | null {
  const normalizedUrl = remoteUrl.replace(/\/+$/, "");

  const httpsMatch = normalizedUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = normalizedUrl.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i,
  );
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  return null;
}

function runCommand(command: string, args: string[], errorMessage: string): void {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });

  if (result.status === 0) {
    return;
  }

  const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  throw new Error(`${errorMessage}${details ? `\n${details}` : ""}`);
}

function runShellCommand(command: string, errorMessage: string): void {
  runCommand("zsh", ["-lc", command], errorMessage);
}

function toShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
