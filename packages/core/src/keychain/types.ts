export interface KeychainProvider {
  store(service: string, account: string, secret: string): Promise<void>;
  retrieve(service: string, account: string): Promise<string | null>;
  remove(service: string, account: string): Promise<void>;
}

export const KEYCHAIN_SERVICE = "com.cloakenv.vault";
export const KEYCHAIN_ACCOUNT = "master-key";
export const AUTO_BACKUP_PASSPHRASE_ACCOUNT = "auto-backup-passphrase";
