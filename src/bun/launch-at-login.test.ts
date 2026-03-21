import { describe, expect, test } from "bun:test";
import { resolveLaunchAtLoginTarget } from "./launch-at-login";

describe("launch-at-login", () => {
  test("builds a macOS launch agent for packaged apps", () => {
    const target = resolveLaunchAtLoginTarget({
      platform: "darwin",
      execPath: "/Applications/CloakEnv.app/Contents/MacOS/launcher",
      homeDir: "/Users/tester",
    });

    expect(target.platform).toBe("darwin");
    expect(target.filePath).toBe(
      "/Users/tester/Library/LaunchAgents/com.cloakenv.vault.launch-at-login.plist",
    );
    expect(target.contents).toContain("<string>/Applications/CloakEnv.app</string>");
    expect(target.contents).toContain("<string>com.cloakenv.vault.launch-at-login</string>");
  });

  test("builds a Linux autostart desktop file for packaged apps", () => {
    const target = resolveLaunchAtLoginTarget({
      platform: "linux",
      execPath: "/opt/CloakEnv/bin/launcher",
      homeDir: "/home/tester",
    });

    expect(target.platform).toBe("linux");
    expect(target.filePath).toBe("/home/tester/.config/autostart/com.cloakenv.vault.desktop");
    expect(target.contents).toContain('Exec="/opt/CloakEnv/bin/launcher"');
    expect(target.contents).toContain('Path="/opt/CloakEnv/bin"');
  });

  test("builds a Windows Run entry for packaged apps", () => {
    const target = resolveLaunchAtLoginTarget({
      platform: "win32",
      execPath: String.raw`C:\Users\tester\AppData\Roaming\CloakEnv\app\bin\launcher.exe`,
    });

    expect(target.platform).toBe("win32");
    expect(target.valueName).toBe("CloakEnv");
    expect(target.valueData).toBe(
      String.raw`"C:\Users\tester\AppData\Roaming\CloakEnv\app\bin\launcher.exe"`,
    );
  });

  test("rejects unsupported dev-style executables on Linux", () => {
    expect(() =>
      resolveLaunchAtLoginTarget({
        platform: "linux",
        execPath: "/usr/local/bin/bun",
      }),
    ).toThrow("packaged linux app install");
  });
});
