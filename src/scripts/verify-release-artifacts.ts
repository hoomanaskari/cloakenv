import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const artifactDir = join(process.cwd(), "artifacts");
if (!existsSync(artifactDir)) {
  throw new Error("Release artifact directory does not exist.");
}

const artifactFiles = listFiles(artifactDir);
const cliArtifactName = getCurrentCliArtifactFileName();
const hasStandaloneCli = artifactFiles.some((filePath) => filePath.endsWith(cliArtifactName));
const hasInstaller = artifactFiles.some((filePath) => {
  if (filePath.endsWith(cliArtifactName)) {
    return false;
  }

  return (
    filePath.endsWith(".dmg") ||
    filePath.endsWith(".zip") ||
    filePath.endsWith(".tar.gz") ||
    filePath.endsWith(".exe")
  );
});

if (!hasStandaloneCli) {
  throw new Error(`Expected standalone CLI artifact not found: ${cliArtifactName}`);
}

if (!hasInstaller) {
  throw new Error("No installer artifact was produced.");
}

console.log("[cloakenv] verified release artifacts");

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
