import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface DetectedProject {
  name: string;
  path: string;
  gitRemote: string | null;
}

interface ProjectManifest {
  filename: string;
  readName?: (manifestPath: string) => string | null;
}

const PROJECT_MANIFESTS: ProjectManifest[] = [
  {
    filename: "package.json",
    readName: readJsonManifestName,
  },
  {
    filename: "pyproject.toml",
    readName: readPyprojectName,
  },
  {
    filename: "Cargo.toml",
    readName: (manifestPath) => readTomlSectionName(manifestPath, "package"),
  },
  {
    filename: "go.mod",
    readName: readGoModuleName,
  },
  {
    filename: "composer.json",
    readName: readJsonManifestName,
  },
  {
    filename: "deno.json",
    readName: readJsonManifestName,
  },
  {
    filename: "deno.jsonc",
    readName: readJsonManifestName,
  },
  {
    filename: "bunfig.toml",
  },
];

/**
 * Detect the project from the current working directory.
 * Walks up the directory tree looking for:
 * 1. `.cloakenv` marker file (monorepo sub-project)
 * 2. `.git/` directory (project root)
 * 3. Supported project manifests for non-Git package workflows
 */
export function detectProject(cwd?: string): DetectedProject | null {
  const startDir = resolve(cwd ?? process.cwd());

  const markerMatch = findNearestAncestor(startDir, (dir) => {
    const markerPath = join(dir, ".cloakenv");
    if (!existsSync(markerPath)) {
      return null;
    }

    const gitRemote = getGitRemote(dir);
    const overriddenName = readMarkerProjectName(markerPath);
    return {
      name: overriddenName ?? generateProjectName(dir, gitRemote),
      path: dir,
      gitRemote,
    };
  });
  if (markerMatch) {
    return markerMatch;
  }

  const gitMatch = findNearestAncestor(startDir, (dir) => {
    if (existsSync(join(dir, ".git"))) {
      const gitRemote = getGitRemote(dir);
      return {
        name: generateProjectName(dir, gitRemote),
        path: dir,
        gitRemote,
      };
    }
    return null;
  });
  if (gitMatch) {
    return gitMatch;
  }

  return findNearestAncestor(startDir, detectProjectFromManifest);
}

function readMarkerProjectName(markerPath: string): string | null {
  try {
    const raw = readFileSync(markerPath, "utf8").trim();
    if (!raw) {
      return null;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      if (trimmed.startsWith("project=")) {
        const value = trimmed.slice("project=".length).trim();
        return value || null;
      }

      return trimmed;
    }
  } catch {
    return null;
  }

  return null;
}

function getGitRemote(projectDir: string): string | null {
  try {
    const proc = Bun.spawnSync(["git", "remote", "get-url", "origin"], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

function generateProjectName(path: string, gitRemote: string | null): string {
  if (gitRemote) {
    // Extract repo name from remote URL
    // e.g., "git@github.com:user/repo.git" -> "repo"
    // e.g., "https://github.com/user/repo.git" -> "repo"
    const match = gitRemote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  }

  // Fallback: use directory name
  return basename(path) || "unnamed";
}

function detectProjectFromManifest(dir: string): DetectedProject | null {
  for (const manifest of PROJECT_MANIFESTS) {
    const manifestPath = join(dir, manifest.filename);
    if (!existsSync(manifestPath)) {
      continue;
    }

    const gitRemote = getGitRemote(dir);
    const manifestName = manifest.readName?.(manifestPath);
    return {
      name: manifestName ?? generateProjectName(dir, gitRemote),
      path: dir,
      gitRemote,
    };
  }

  return null;
}

function findNearestAncestor<T>(startDir: string, matcher: (dir: string) => T | null): T | null {
  let dir = startDir;

  while (true) {
    const match = matcher(dir);
    if (match) {
      return match;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

function readJsonManifestName(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
  } catch {
    return null;
  }
}

function readPyprojectName(manifestPath: string): string | null {
  const raw = readManifestFile(manifestPath);
  if (!raw) {
    return null;
  }

  return extractTomlSectionName(raw, "project") ?? extractTomlSectionName(raw, "tool.poetry");
}

function readGoModuleName(manifestPath: string): string | null {
  const raw = readManifestFile(manifestPath);
  if (!raw) {
    return null;
  }

  const moduleMatch = raw.match(/^\s*module\s+(\S+)\s*$/m);
  if (!moduleMatch) {
    return null;
  }

  const modulePath = moduleMatch[1].replace(/\/+$/, "");
  const name = modulePath.split("/").pop()?.trim();
  return name || null;
}

function readTomlSectionName(manifestPath: string, section: string): string | null {
  const raw = readManifestFile(manifestPath);
  if (!raw) {
    return null;
  }

  return extractTomlSectionName(raw, section);
}

function readManifestFile(manifestPath: string): string | null {
  try {
    return readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
}

function extractTomlSectionName(raw: string, section: string): string | null {
  const escapedSection = escapeRegExp(section);
  const sectionMatch = raw.match(
    new RegExp(`(?:^|\\n)\\[${escapedSection}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`),
  );

  if (!sectionMatch) {
    return null;
  }

  const nameMatch = sectionMatch[1].match(/^\s*name\s*=\s*["']([^"']+)["']\s*$/m);
  return nameMatch?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate a stable project identifier from path and git remote.
 */
export function generateProjectId(path: string, gitRemote: string | null): string {
  const input = gitRemote ? `${gitRemote}:${path}` : path;
  return createHash("sha256").update(input).digest("hex").substring(0, 16);
}
