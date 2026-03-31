import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../../package.json";
import { assertMacArtifactsReadyForDistribution, readMacArtifactVersionInfo } from "./release-utils";

const projectRoot = process.cwd();
const artifactsDir = join(projectRoot, "artifacts");
const rawTag = process.argv[2];

if (rawTag === "--help" || rawTag === "-h") {
  console.log("Usage: bun run release:upload:macos -- [tag]");
  console.log("Uploads the local macOS release artifacts from artifacts/ to the given GitHub release tag.");
  console.log(`Defaults to v${packageJson.version} when no tag is provided.`);
  process.exit(0);
}

const tag = rawTag ?? `v${packageJson.version}`;

const requiredArtifacts = [
  "cloakenv-darwin-arm64",
  "release-manifest-darwin-arm64.json",
  "stable-macos-arm64-CloakEnv.app.tar.zst",
  "stable-macos-arm64-CloakEnv.dmg",
  "stable-macos-arm64-update.json",
];

const missingArtifacts = requiredArtifacts.filter(
  (fileName) => !existsSync(join(artifactsDir, fileName)),
);

if (missingArtifacts.length > 0) {
  console.error("[cloakenv] missing required macOS artifacts:");
  for (const fileName of missingArtifacts) {
    console.error(`- ${fileName}`);
  }
  process.exit(1);
}

const macPatchArtifacts = readdirSync(artifactsDir)
  .filter((fileName) => /^stable-macos-arm64-.*\.patch$/.test(fileName))
  .sort();

const filesToUpload = [...requiredArtifacts, ...macPatchArtifacts].map((fileName) =>
  join(artifactsDir, fileName),
);

const versionInfo = readMacArtifactVersionInfo(artifactsDir);
if (!versionInfo.baseUrl.trim()) {
  console.error("[cloakenv] packaged macOS build is missing an updater release feed URL.");
  console.error("[cloakenv] rebuild with `bun run release:build` or set CLOAKENV_RELEASE_BASE_URL.");
  process.exit(1);
}

try {
  assertMacArtifactsReadyForDistribution(artifactsDir);
} catch (error) {
  console.error("[cloakenv] macOS release artifacts are not ready for public distribution.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`[cloakenv] verified macOS updater feed ${versionInfo.baseUrl}`);
console.log(`[cloakenv] uploading ${filesToUpload.length} macOS release artifact(s) to ${tag}`);

const uploadResult = Bun.spawnSync(["gh", "release", "upload", tag, ...filesToUpload, "--clobber"], {
  cwd: projectRoot,
  stdio: ["ignore", "inherit", "inherit"],
});

if (!uploadResult.success) {
  process.exit(uploadResult.exitCode ?? 1);
}

console.log(`[cloakenv] macOS artifacts uploaded to ${tag}`);
