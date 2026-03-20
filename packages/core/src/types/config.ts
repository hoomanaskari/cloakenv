export interface CloakEnvConfig {
  backupPath: string | null;
  authMode: "keychain" | "passphrase";
  autoBackup: boolean;
  onboardingCompleted: boolean;
  providerSessionTtlMinutes: number;
  desktopAppearance: "dock_and_menu" | "dock_only" | "menu_only";
}

export type ConfigKey = keyof CloakEnvConfig;
