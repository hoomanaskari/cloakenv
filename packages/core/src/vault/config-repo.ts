import type { Database } from "bun:sqlite";
import type { CloakEnvConfig } from "../types/config";

interface ConfigRow {
  key: string;
  value: string;
  updated_at: number;
}

const DEFAULTS: CloakEnvConfig = {
  backupPath: null,
  authMode: "keychain",
  autoBackup: true,
  onboardingCompleted: false,
  providerSessionTtlMinutes: 0,
  desktopAppearance: "dock_and_menu",
};

const KEY_MAP: Record<keyof CloakEnvConfig, string> = {
  backupPath: "backup_path",
  authMode: "auth_mode",
  autoBackup: "auto_backup",
  onboardingCompleted: "onboarding_completed",
  providerSessionTtlMinutes: "provider_session_ttl_minutes",
  desktopAppearance: "desktop_appearance",
};

export class ConfigRepository {
  constructor(private db: Database) {}

  get<K extends keyof CloakEnvConfig>(key: K): CloakEnvConfig[K] {
    const dbKey = KEY_MAP[key];
    const row = this.db.query<ConfigRow, [string]>("SELECT * FROM config WHERE key = ?").get(dbKey);

    if (!row) return DEFAULTS[key];

    return this.deserialize(key, row.value);
  }

  set<K extends keyof CloakEnvConfig>(key: K, value: CloakEnvConfig[K]): void {
    const dbKey = KEY_MAP[key];
    const serialized = this.serialize(value);
    const now = Math.floor(Date.now() / 1000);

    this.db.run("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)", [
      dbKey,
      serialized,
      now,
    ]);
  }

  getAll(): CloakEnvConfig {
    return {
      backupPath: this.get("backupPath"),
      authMode: this.get("authMode"),
      autoBackup: this.get("autoBackup"),
      onboardingCompleted: this.get("onboardingCompleted"),
      providerSessionTtlMinutes: this.get("providerSessionTtlMinutes"),
      desktopAppearance: this.get("desktopAppearance"),
    };
  }

  private serialize(value: unknown): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null) return "";
    return String(value);
  }

  private deserialize<K extends keyof CloakEnvConfig>(key: K, raw: string): CloakEnvConfig[K] {
    switch (key) {
      case "autoBackup":
      case "onboardingCompleted":
        return (raw === "true") as CloakEnvConfig[K];
      case "backupPath":
        return (raw === "" ? null : raw) as CloakEnvConfig[K];
      case "authMode":
        return raw as CloakEnvConfig[K];
      case "providerSessionTtlMinutes":
        return Number.isFinite(Number.parseInt(raw, 10))
          ? (Number.parseInt(raw, 10) as CloakEnvConfig[K])
          : DEFAULTS.providerSessionTtlMinutes;
      case "desktopAppearance":
        return (
          raw === "dock_only" || raw === "menu_only" ? raw : DEFAULTS.desktopAppearance
        ) as CloakEnvConfig[K];
      default:
        return raw as CloakEnvConfig[K];
    }
  }
}
