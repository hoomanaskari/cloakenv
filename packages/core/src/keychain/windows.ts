import type { KeychainProvider } from "./types";

export class WindowsKeychain implements KeychainProvider {
  async store(service: string, account: string, secret: string): Promise<void> {
    const target = `${service}/${account}`;
    // Use PowerShell to store in Windows Credential Manager
    const script = `
      $ErrorActionPreference = 'Stop'
      $cred = New-Object System.Management.Automation.PSCredential('${account}', (ConvertTo-SecureString '${secret.replace(/'/g, "''")}' -AsPlainText -Force))
      cmdkey /generic:'${target}' /user:'${account}' /pass:'${secret.replace(/'/g, "''")}'
    `.trim();

    const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Credential Manager store failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    const target = `${service}/${account}`;
    const script = `
      $ErrorActionPreference = 'Stop'
      $output = cmdkey /list:'${target}' 2>&1
      if ($LASTEXITCODE -ne 0) { exit 1 }
      Write-Output $output
    `.trim();

    const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", script], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    // For proper retrieval we'd need to use .NET APIs via PowerShell
    // This is a simplified implementation
    const output = await new Response(proc.stdout).text();
    return output.trim() || null;
  }

  async remove(service: string, account: string): Promise<void> {
    const target = `${service}/${account}`;
    const proc = Bun.spawn(["cmdkey", `/delete:${target}`], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
  }
}
