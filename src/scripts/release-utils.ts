import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

function toShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
