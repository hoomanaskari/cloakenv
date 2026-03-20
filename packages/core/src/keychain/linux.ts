import type { KeychainProvider } from "./types";

export class LinuxKeychain implements KeychainProvider {
  async store(service: string, account: string, secret: string): Promise<void> {
    const proc = Bun.spawn(
      [
        "secret-tool",
        "store",
        "--label",
        `${service}/${account}`,
        "service",
        service,
        "account",
        account,
      ],
      {
        stdin: new TextEncoder().encode(secret),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Secret Service store failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    const proc = Bun.spawn(["secret-tool", "lookup", "service", service, "account", account], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    const output = await new Response(proc.stdout).text();
    return output || null;
  }

  async remove(service: string, account: string): Promise<void> {
    const proc = Bun.spawn(["secret-tool", "clear", "service", service, "account", account], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
  }
}
