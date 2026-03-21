import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 as pathWin32 } from "node:path";

const WINDOWS_RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
const APP_NAME = "CloakEnv";
const APP_IDENTIFIER = "com.cloakenv.vault";

interface LaunchAtLoginOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  homeDir?: string;
  appName?: string;
  appIdentifier?: string;
}

interface MacLaunchAtLoginTarget {
  platform: "darwin";
  filePath: string;
  contents: string;
}

interface LinuxLaunchAtLoginTarget {
  platform: "linux";
  filePath: string;
  contents: string;
}

interface WindowsLaunchAtLoginTarget {
  platform: "win32";
  valueName: string;
  valueData: string;
}

type LaunchAtLoginTarget =
  | MacLaunchAtLoginTarget
  | LinuxLaunchAtLoginTarget
  | WindowsLaunchAtLoginTarget;

export function setLaunchAtLoginEnabled(
  enabled: boolean,
  options: LaunchAtLoginOptions = {},
): void {
  const target = resolveLaunchAtLoginTarget(options);

  if (target.platform === "win32") {
    const result = Bun.spawnSync(
      enabled
        ? [
            "reg.exe",
            "add",
            WINDOWS_RUN_KEY,
            "/v",
            target.valueName,
            "/t",
            "REG_SZ",
            "/d",
            target.valueData,
            "/f",
          ]
        : ["reg.exe", "delete", WINDOWS_RUN_KEY, "/v", target.valueName, "/f"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (result.success) {
      return;
    }

    const stderr = result.stderr.toString().trim();
    const stdout = result.stdout.toString().trim();
    if (!enabled && /unable to find|cannot find/i.test(`${stdout}\n${stderr}`)) {
      return;
    }

    throw new Error(stderr || stdout || "Failed to update launch-at-login.");
  }

  if (!enabled) {
    if (existsSync(target.filePath)) {
      rmSync(target.filePath, { force: true });
    }
    return;
  }

  mkdirSync(dirname(target.filePath), { recursive: true });
  writeFileSync(target.filePath, target.contents, "utf8");
}

export function resolveLaunchAtLoginTarget(
  options: LaunchAtLoginOptions = {},
): LaunchAtLoginTarget {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const homeDir = options.homeDir ?? homedir();
  const appName = options.appName ?? APP_NAME;
  const appIdentifier = options.appIdentifier ?? APP_IDENTIFIER;

  if (platform === "darwin") {
    const appBundlePath = resolve(dirname(execPath), "..", "..");
    if (!appBundlePath.endsWith(".app")) {
      throw new Error("Launch at login requires a packaged macOS app bundle.");
    }

    return {
      platform,
      filePath: join(homeDir, "Library", "LaunchAgents", `${appIdentifier}.launch-at-login.plist`),
      contents: buildMacLaunchAgentPlist(appBundlePath, appIdentifier),
    };
  }

  if (platform === "linux") {
    assertLauncherExecutable(execPath, "linux");
    return {
      platform,
      filePath: join(homeDir, ".config", "autostart", `${appIdentifier}.desktop`),
      contents: buildLinuxAutostartDesktopFile(execPath, appName),
    };
  }

  if (platform === "win32") {
    assertLauncherExecutable(execPath, "win32");
    return {
      platform,
      valueName: appName,
      valueData: `"${execPath}"`,
    };
  }

  throw new Error(`Launch at login is not supported on ${platform}.`);
}

function assertLauncherExecutable(execPath: string, platform: "linux" | "win32"): void {
  const executableName =
    platform === "win32" ? pathWin32.basename(execPath).toLowerCase() : basename(execPath).toLowerCase();
  const expectedName = platform === "win32" ? "launcher.exe" : "launcher";
  if (executableName !== expectedName) {
    throw new Error(`Launch at login requires a packaged ${platform} app install.`);
  }
}

function buildMacLaunchAgentPlist(appBundlePath: string, appIdentifier: string): string {
  const label = `${appIdentifier}.launch-at-login`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${escapeXml(label)}</string>`,
    "    <key>ProgramArguments</key>",
    "    <array>",
    "      <string>/usr/bin/open</string>",
    `      <string>${escapeXml(appBundlePath)}</string>`,
    "    </array>",
    "    <key>RunAtLoad</key>",
    "    <true/>",
    "  </dict>",
    "</plist>",
    "",
  ].join("\n");
}

function buildLinuxAutostartDesktopFile(execPath: string, appName: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    `Name=${escapeDesktopEntryValue(appName)}`,
    `Comment=${escapeDesktopEntryValue(`Launch ${appName} when you sign in`)}`,
    `Exec=${quoteDesktopExecArg(execPath)}`,
    `Path=${quoteDesktopExecArg(dirname(execPath))}`,
    "Terminal=false",
    "StartupNotify=false",
    "X-GNOME-Autostart-enabled=true",
    "Hidden=false",
    "",
  ].join("\n");
}

function quoteDesktopExecArg(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", '\\"')}"`;
}

function escapeDesktopEntryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
