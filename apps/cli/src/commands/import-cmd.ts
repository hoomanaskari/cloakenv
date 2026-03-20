import {
  ConfigRepository,
  deriveMasterKey,
  getDatabase,
  getKeychainProvider,
  importVault,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  triggerAutoBackup,
} from "@cloakenv/core";
import type { Command } from "commander";
import { ensureAutoBackupReady } from "../utils/backup-policy";

export function registerImportCommand(program: Command): void {
  program
    .command("import <path>")
    .description("Restore vault from an encrypted .cloaked backup file")
    .action(async (filePath: string) => {
      const db = getDatabase();
      const configRepo = new ConfigRepository(db);

      if (!configRepo.get("backupPath")) {
        console.error("Backup path is required before modifying the vault.");
        console.error("Run 'cloakenv config backup-path <path>' and try again.");
        process.exit(1);
      }
      await ensureAutoBackupReady(configRepo);

      // Get master key for the local vault
      const keychain = getKeychainProvider();
      const stored = await keychain.retrieve(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

      let masterKey: Buffer;
      if (stored) {
        masterKey = Buffer.from(stored, "hex");
      } else {
        const { key } = await deriveMasterKey(crypto.randomUUID());
        await keychain.store(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.toString("hex"));
        masterKey = key;
      }

      // Get passphrase for the .cloaked file
      process.stdout.write("Enter passphrase for .cloaked file: ");
      const passphrase = readLine();
      if (!passphrase) {
        console.error("Passphrase is required.");
        process.exit(1);
      }

      try {
        const result = await importVault({
          db,
          masterKey,
          filePath,
          passphrase,
        });

        console.log(`\nImport complete!`);
        console.log(`  Projects imported: ${result.projectsImported}`);
        console.log(`  Secrets imported: ${result.secretsImported}`);

        await triggerAutoBackup(db, masterKey);
      } catch (err) {
        console.error(`\nImport failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function readLine(): string | null {
  try {
    const buf = new Uint8Array(1024);
    const n = require("node:fs").readSync(0, buf);
    return new TextDecoder().decode(buf.subarray(0, n)).trim() || null;
  } catch {
    return null;
  }
}
