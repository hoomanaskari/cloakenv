import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const targetOs = requireEnv("ELECTROBUN_OS");
const targetArch = requireEnv("ELECTROBUN_ARCH");
const wrapperBundlePath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH ?? null;
const buildDir = requireEnv("ELECTROBUN_BUILD_DIR");
const appVersion = process.env.ELECTROBUN_APP_VERSION ?? "0.0.0";

const cliTarget = getCliCompileTarget(targetOs, targetArch);
const cliFileName = getCliArtifactFileName(targetOs, targetArch);
const bundledCliRuntimeFileName = targetOs === "win" ? "cloakenv.exe" : "cloakenv";
const projectRoot = process.cwd();
const releaseDir = join(projectRoot, "apps", "cli", "dist", "release");
const builtCliPath = join(releaseDir, cliFileName);
const developerIdIdentity = process.env.ELECTROBUN_DEVELOPER_ID?.trim() ?? "";
mkdirSync(releaseDir, { recursive: true });

console.log(`[cloakenv] building bundled CLI for ${targetOs}-${targetArch} (${cliTarget})`);

const buildResult = Bun.spawnSync(
  [
    process.execPath,
    "build",
    "./apps/cli/src/index.ts",
    "--compile",
    "--target",
    cliTarget,
    "--outfile",
    builtCliPath,
  ],
  {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  },
);

if (!buildResult.success) {
  process.exit(buildResult.exitCode ?? 1);
}

if (targetOs === "macos" && developerIdIdentity) {
  console.log(`[cloakenv] signing bundled CLI with ${developerIdIdentity}`);
  execFileSync(
    "codesign",
    [
      "--force",
      "--verbose",
      "--timestamp",
      "--options",
      "runtime",
      "--identifier",
      "com.cloakenv.vault.cloakenv-cli",
      "--sign",
      developerIdIdentity,
      builtCliPath,
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
}

for (const bundlePath of getCandidateBundlePaths()) {
  const resourcesPath = getBundleResourcesPath(bundlePath, targetOs);
  const bundledCliDir = join(resourcesPath, "cli");
  const bundledCliPath = join(bundledCliDir, bundledCliRuntimeFileName);
  const manifestPath = join(bundledCliDir, "manifest.json");

  mkdirSync(bundledCliDir, { recursive: true });
  copyFileSync(builtCliPath, bundledCliPath);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        cliFileName,
        targetOs,
        targetArch,
        version: appVersion,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`[cloakenv] bundled CLI copied to ${bundledCliPath}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getCandidateBundlePaths(): string[] {
  const candidates = new Set<string>();
  if (wrapperBundlePath) {
    candidates.add(wrapperBundlePath);
  }

  if (existsSync(buildDir)) {
    for (const entry of readdirSync(buildDir)) {
      const fullPath = join(buildDir, entry);
      if (!statSync(fullPath, { throwIfNoEntry: false })?.isDirectory()) {
        continue;
      }

      if (targetOs === "macos") {
        if (entry.endsWith(".app")) {
          candidates.add(fullPath);
        }
        continue;
      }

      if (existsSync(join(fullPath, "Resources"))) {
        candidates.add(fullPath);
      }
    }
  }

  if (candidates.size === 0) {
    throw new Error(`Could not find a bundle directory in ${buildDir}`);
  }

  return [...candidates];
}

function getBundleResourcesPath(bundlePath: string, os: string): string {
  return os === "macos" ? join(bundlePath, "Contents", "Resources") : join(bundlePath, "Resources");
}

function getCliCompileTarget(os: string, arch: string): string {
  if (os === "macos" && arch === "arm64") {
    return "bun-darwin-arm64";
  }

  if (os === "macos" && arch === "x64") {
    return "bun-darwin-x64";
  }

  if (os === "linux" && arch === "x64") {
    return "bun-linux-x64";
  }

  if (os === "win" && arch === "x64") {
    return "bun-windows-x64";
  }

  throw new Error(`Unsupported bundled CLI target: ${os}-${arch}`);
}

function getCliArtifactFileName(os: string, arch: string): string {
  if (os === "macos") {
    return `cloakenv-darwin-${arch}`;
  }

  if (os === "linux") {
    return `cloakenv-linux-${arch}`;
  }

  if (os === "win") {
    return `cloakenv-windows-${arch}.exe`;
  }

  throw new Error(`Unsupported bundled CLI platform: ${os}`);
}
