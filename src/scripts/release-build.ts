import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import packageJson from "../../package.json";

const projectRoot = process.cwd();
const artifactDir = join(projectRoot, "artifacts");
const cliReleaseDir = join(projectRoot, "apps", "cli", "dist", "release");
const currentCliArtifact = join(cliReleaseDir, getCurrentCliArtifactFileName());

const buildResult = Bun.spawnSync([process.execPath, "run", "build:prod"], {
  cwd: projectRoot,
  stdio: ["ignore", "inherit", "inherit"],
});

if (!buildResult.success) {
  process.exit(buildResult.exitCode ?? 1);
}

mkdirSync(artifactDir, { recursive: true });
copyFileSync(currentCliArtifact, join(artifactDir, basename(currentCliArtifact)));

const artifactFiles = listFiles(artifactDir).map((filePath) => ({
  path: filePath.replace(`${artifactDir}/`, ""),
  size: statSync(filePath).size,
}));

writeFileSync(
  join(artifactDir, `release-manifest-${process.platform}-${process.arch}.json`),
  JSON.stringify(
    {
      version: packageJson.version,
      platform: process.platform,
      arch: process.arch,
      generatedAt: new Date().toISOString(),
      artifacts: artifactFiles,
    },
    null,
    2,
  ),
  "utf8",
);

const verifyResult = Bun.spawnSync([process.execPath, "run", "release:verify"], {
  cwd: projectRoot,
  stdio: ["ignore", "inherit", "inherit"],
});

if (!verifyResult.success) {
  process.exit(verifyResult.exitCode ?? 1);
}

function getCurrentCliArtifactFileName(): string {
  if (process.platform === "darwin") {
    return `cloakenv-darwin-${process.arch}`;
  }

  if (process.platform === "linux") {
    return `cloakenv-linux-${process.arch}`;
  }

  if (process.platform === "win32") {
    return `cloakenv-windows-${process.arch}.exe`;
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}
