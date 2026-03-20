import { ConfigRepository, getDatabase } from "@cloakenv/core";
import type { Command } from "commander";
import {
  ensureAutoBackupPassphraseStored,
  hasStoredAutoBackupPassphrase,
} from "../utils/backup-policy";

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage CloakEnv configuration");

  config
    .command("backup-path <path>")
    .description("Set or update the auto-backup directory path")
    .action(async (path: string) => {
      const db = getDatabase();
      const repo = new ConfigRepository(db);
      repo.set("backupPath", path);
      if (repo.get("autoBackup")) {
        await ensureAutoBackupPassphraseStored();
      }
      console.log(`Backup path set to: ${path}`);
    });

  config
    .command("backup-passphrase")
    .description("Set or rotate the stored auto-backup passphrase")
    .action(async () => {
      await ensureAutoBackupPassphraseStored(true);
    });

  config
    .command("auth-mode <mode>")
    .description("Set authentication mode (keychain or passphrase)")
    .action((mode: string) => {
      if (mode !== "keychain" && mode !== "passphrase") {
        console.error('Auth mode must be "keychain" or "passphrase".');
        process.exit(1);
      }
      const db = getDatabase();
      const repo = new ConfigRepository(db);
      repo.set("authMode", mode);
      console.log(`Auth mode set to: ${mode}`);
    });

  config
    .command("provider-session <minutes>")
    .description("Set the provider approval session window in minutes, or 0 to disable reuse")
    .action((minutes: string) => {
      const parsed = Number.parseInt(minutes, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        console.error("Provider session window must be a non-negative integer.");
        process.exit(1);
      }

      const db = getDatabase();
      const repo = new ConfigRepository(db);
      repo.set("providerSessionTtlMinutes", parsed);
      console.log(
        parsed > 0
          ? `Provider session window set to ${parsed} minute${parsed === 1 ? "" : "s"}.`
          : "Provider session reuse disabled.",
      );
    });

  config
    .command("show")
    .description("Display current configuration settings")
    .action(async () => {
      const db = getDatabase();
      const repo = new ConfigRepository(db);
      const all = repo.getAll();
      const hasBackupPassphrase = await hasStoredAutoBackupPassphrase();

      console.log("CloakEnv Configuration:\n");
      console.log(`  Backup path:  ${all.backupPath ?? "(not set)"}`);
      console.log(`  Auth mode:    ${all.authMode}`);
      console.log(`  Auto-backup:  ${all.autoBackup ? "enabled" : "disabled"}`);
      console.log(
        `  Provider session:  ${
          all.providerSessionTtlMinutes > 0
            ? `${all.providerSessionTtlMinutes} minute${all.providerSessionTtlMinutes === 1 ? "" : "s"}`
            : "disabled"
        }`,
      );
      console.log(`  Backup passphrase:  ${hasBackupPassphrase ? "configured" : "missing"}`);
    });
}
