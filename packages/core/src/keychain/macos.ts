import type { KeychainProvider } from "./types";

export class MacOSKeychain implements KeychainProvider {
  private readonly bin = "/usr/bin/security";

  async store(service: string, account: string, secret: string): Promise<void> {
    // Delete existing entry first (ignore errors if not found)
    await this.remove(service, account).catch(() => {});

    const proc = Bun.spawn(
      [this.bin, "add-generic-password", "-s", service, "-a", account, "-w", secret, "-U"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Keychain store failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    const proc = Bun.spawn(
      [this.bin, "find-generic-password", "-s", service, "-a", account, "-w"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    const output = await new Response(proc.stdout).text();
    return output.trim();
  }

  async remove(service: string, account: string): Promise<void> {
    const proc = Bun.spawn([this.bin, "delete-generic-password", "-s", service, "-a", account], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
  }
}
