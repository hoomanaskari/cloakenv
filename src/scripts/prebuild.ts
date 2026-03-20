#!/usr/bin/env bun
/**
 * Pre-build script for ElectroBun.
 * Runs Vite to build the web UI (with Tailwind CSS processing) before ElectroBun bundles the app.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "../..");
const webAppDir = join(projectRoot, "apps/web");

console.log("[prebuild] Building web UI with Vite...");

execSync("npx vite build", {
  cwd: webAppDir,
  stdio: "inherit",
});

console.log("[prebuild] Web UI built successfully.");
