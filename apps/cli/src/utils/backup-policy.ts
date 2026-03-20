import {
  AUTO_BACKUP_PASSPHRASE_ACCOUNT,
  type ConfigRepository,
  evaluatePassphrase,
  getKeychainProvider,
  KEYCHAIN_SERVICE,
} from "@cloakenv/core";

export function ensureBackupPathConfigured(configRepo: ConfigRepository): void {
  if (configRepo.get("backupPath")) {
    return;
  }

  console.error("Backup path is required before modifying the vault.");
  console.error("Run 'cloakenv config backup-path <path>' and try again.");
  process.exit(1);
}

export async function ensureAutoBackupReady(configRepo: ConfigRepository): Promise<void> {
  if (!configRepo.get("autoBackup")) {
    return;
  }

  const keychain = getKeychainProvider();
  const passphrase = await keychain.retrieve(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT);
  if (passphrase) {
    return;
  }

  console.error("Auto-backup is enabled but no backup passphrase is configured.");
  console.error("Run 'cloakenv config backup-passphrase' and try again.");
  process.exit(1);
}

export async function ensureAutoBackupPassphraseStored(forcePrompt = false): Promise<void> {
  const keychain = getKeychainProvider();
  const existing = await keychain.retrieve(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT);
  if (existing && !forcePrompt) {
    return;
  }

  process.stdout.write(
    forcePrompt ? "Enter new auto-backup passphrase: " : "Enter auto-backup passphrase: ",
  );
  const passphrase = readLine();
  if (!passphrase) {
    console.error("Auto-backup passphrase is required.");
    process.exit(1);
  }

  const strength = evaluatePassphrase(passphrase);
  if (!strength.isAcceptable) {
    console.error(`\nPassphrase too weak (score: ${strength.score}/4, required: 4/4).`);
    if (strength.feedback.warning) {
      console.error(`Warning: ${strength.feedback.warning}`);
    }
    if (strength.feedback.suggestions.length > 0) {
      console.error(`Suggestions: ${strength.feedback.suggestions.join(". ")}`);
    }
    console.error(
      "\nTip: Use a passphrase of 4+ random words (e.g., 'cloakenv generate-passphrase')",
    );
    process.exit(1);
  }

  await keychain.store(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT, passphrase);
  console.log(existing ? "Auto-backup passphrase updated." : "Auto-backup passphrase stored.");
}

export async function hasStoredAutoBackupPassphrase(): Promise<boolean> {
  const keychain = getKeychainProvider();
  return (await keychain.retrieve(KEYCHAIN_SERVICE, AUTO_BACKUP_PASSPHRASE_ACCOUNT)) !== null;
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
