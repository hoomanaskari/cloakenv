import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { AUTO_BACKUP_PASSPHRASE_ACCOUNT, getKeychainProvider, KEYCHAIN_SERVICE } from "../keychain";
import { DEFAULT_CLOAKED_BACKUP_FILENAME } from "../types/backup";
import { ConfigRepository } from "../vault/config-repo";
import { exportVault } from "./exporter";

/**
 * Trigger auto-backup if configured.
 * Called after every vault mutation (set, update, delete).
 */
export async function triggerAutoBackup(db: Database, masterKey: Buffer): Promise<boolean> {
  const configRepo = new ConfigRepository(db);
  const autoBackup = configRepo.get("autoBackup");
  const backupPath = configRepo.get("backupPath");

  if (!autoBackup || !backupPath) return false;

  const keychain = getKeychainProvider();
  const passphrase = await keychain.retrieve(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT);
  if (!passphrase) return false;

  try {
    await exportVault({
      db,
      masterKey,
      passphrase,
      outputPath: join(backupPath, DEFAULT_CLOAKED_BACKUP_FILENAME),
    });
    return true;
  } catch {
    // Auto-backup failures are non-fatal — logged but don't interrupt the user
    return false;
  }
}
