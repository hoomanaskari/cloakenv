import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../../src/project/detector";

describe("Project detection", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses named .cloakenv markers to override the detected project name", () => {
    const root = mkdtempSync(join(tmpdir(), "cloakenv-detector-"));
    tempDirs.push(root);

    const appDir = join(root, "apps", "worker");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(root, ".cloakenv"), "project=shared-monorepo\n", "utf8");

    const detected = detectProject(appDir);

    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("shared-monorepo");
    expect(detected?.path).toBe(root);
  });

  test("keeps supporting empty .cloakenv markers as plain directory boundaries", () => {
    const root = mkdtempSync(join(tmpdir(), "cloakenv-detector-"));
    tempDirs.push(root);

    const serviceDir = join(root, "service");
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(join(serviceDir, ".cloakenv"), "", "utf8");

    const detected = detectProject(serviceDir);

    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("service");
    expect(detected?.path).toBe(serviceDir);
  });

  test("detects non-git package projects from package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "cloakenv-detector-"));
    tempDirs.push(root);

    const appDir = join(root, "apps", "demo-app");
    const srcDir = join(appDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(appDir, "package.json"),
      JSON.stringify({ name: "@acme/demo-app" }, null, 2),
      "utf8",
    );

    const detected = detectProject(srcDir);

    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("@acme/demo-app");
    expect(detected?.path).toBe(appDir);
    expect(detected?.gitRemote).toBeNull();
  });

  test("falls back to the manifest directory name when package.json has no name", () => {
    const root = mkdtempSync(join(tmpdir(), "cloakenv-detector-"));
    tempDirs.push(root);

    const appDir = join(root, "unnamed-app");
    const nestedDir = join(appDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(appDir, "package.json"), JSON.stringify({ private: true }, null, 2), "utf8");

    const detected = detectProject(nestedDir);

    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("unnamed-app");
    expect(detected?.path).toBe(appDir);
    expect(detected?.gitRemote).toBeNull();
  });
});
