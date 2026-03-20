import type { AppUpdateStatusInfo, ConfigInfo } from "@shared/types";
import {
  Archive,
  Download,
  FolderOpen,
  KeyRound,
  MonitorSmartphone,
  RefreshCw,
  Shield,
  TerminalSquare,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type CliInstallStatusInfo, useRPC } from "@/hooks/use-rpc";
import { DESKTOP_EVENT_APP_UPDATE_STATUS_CHANGED } from "@/lib/desktop-events";
import { type ThemePreference, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const INITIAL_CONFIG: ConfigInfo = {
  backupPath: null,
  authMode: "keychain",
  autoBackup: true,
  onboardingCompleted: false,
  autoBackupPassphraseConfigured: false,
  providerSessionTtlMinutes: 0,
  desktopAppearance: "dock_and_menu",
};

type PreferenceView = "general" | "security" | "backups" | "integrations";

const SIDEBAR_ITEMS: Array<{
  value: PreferenceView;
  label: string;
  icon: typeof Shield;
}> = [
  { value: "general", label: "General", icon: MonitorSmartphone },
  { value: "security", label: "Security", icon: Shield },
  { value: "backups", label: "Backups", icon: Archive },
  { value: "integrations", label: "Integrations", icon: TerminalSquare },
];

export function PreferencesSurface({ className }: { className?: string }) {
  const rpc = useRPC();
  const [view, setView] = useState<PreferenceView>("general");
  const [config, setConfig] = useState<ConfigInfo>(INITIAL_CONFIG);
  const [loading, setLoading] = useState(false);
  const [cliInstallStatus, setCliInstallStatus] = useState<CliInstallStatusInfo | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatusInfo | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] = useState("");
  const [showBackupPassphrase, setShowBackupPassphrase] = useState(false);

  const themePreference = useAppStore((s) => s.themePreference);
  const setThemePreference = useAppStore((s) => s.setThemePreference);

  const backupPassphraseMismatch =
    backupPassphraseConfirmation.length > 0 && backupPassphrase !== backupPassphraseConfirmation;

  const loadConfig = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setConfig(await rpc.getConfig());
  }, [rpc]);

  const loadCliInstallStatus = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setCliInstallStatus(await rpc.getCliInstallStatus());
  }, [rpc]);

  const loadAppUpdateStatus = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setAppUpdateStatus(await rpc.getAppUpdateStatus());
  }, [rpc]);

  useEffect(() => {
    if (!rpc) {
      return;
    }

    void Promise.all([loadConfig(), loadCliInstallStatus(), loadAppUpdateStatus()]);
  }, [rpc, loadAppUpdateStatus, loadCliInstallStatus, loadConfig]);

  useEffect(() => {
    if (
      !rpc ||
      !appUpdateStatus ||
      (!appUpdateStatus.checking && !appUpdateStatus.downloading && !appUpdateStatus.applying)
    ) {
      return;
    }

    const timer = setInterval(() => {
      void loadAppUpdateStatus();
    }, 1_000);

    return () => clearInterval(timer);
  }, [appUpdateStatus, loadAppUpdateStatus, rpc]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStatusChanged = (event: Event) => {
      const nextStatus = (event as CustomEvent<AppUpdateStatusInfo>).detail;
      setAppUpdateStatus(nextStatus);
    };

    window.addEventListener(DESKTOP_EVENT_APP_UPDATE_STATUS_CHANGED, handleStatusChanged);
    return () =>
      window.removeEventListener(DESKTOP_EVENT_APP_UPDATE_STATUS_CHANGED, handleStatusChanged);
  }, []);

  const withBusy = useCallback(async (task: () => Promise<void>) => {
    try {
      setLoading(true);
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChooseBackupPath = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      const path = await rpc.openBackupFolderDialog();
      if (!path) {
        return;
      }

      await rpc.setConfig({ key: "backupPath", value: path });
      await loadConfig();
      toast.success("Backup path updated");
    });
  }, [loadConfig, rpc, withBusy]);

  const handleSaveBackupPassphrase = useCallback(async () => {
    if (!rpc) {
      return;
    }
    if (!backupPassphrase.trim()) {
      toast.error("Enter a backup passphrase first");
      return;
    }
    if (!backupPassphraseConfirmation.trim()) {
      toast.error("Confirm the backup passphrase before saving.");
      return;
    }
    if (backupPassphrase !== backupPassphraseConfirmation) {
      toast.error("Backup passphrase entries must match.");
      return;
    }

    await withBusy(async () => {
      await rpc.setAutoBackupPassphrase({ passphrase: backupPassphrase });
      setBackupPassphrase("");
      setBackupPassphraseConfirmation("");
      await loadConfig();
      toast.success("Backup passphrase saved");
    });
  }, [backupPassphrase, backupPassphraseConfirmation, loadConfig, rpc, withBusy]);

  const handleToggleAutoBackup = useCallback(
    async (checked: boolean) => {
      if (!rpc) {
        return;
      }

      if (checked && !config.backupPath) {
        toast.error("Choose a backup folder before enabling auto-backup.");
        return;
      }

      if (checked && !config.autoBackupPassphraseConfigured) {
        toast.error("Save a backup passphrase before enabling auto-backup.");
        return;
      }

      await withBusy(async () => {
        await rpc.setConfig({ key: "autoBackup", value: checked ? "true" : "false" });
        await loadConfig();
        toast.success(checked ? "Auto-backup enabled" : "Auto-backup disabled");
      });
    },
    [config.autoBackupPassphraseConfigured, config.backupPath, loadConfig, rpc, withBusy],
  );

  const handleSetAuthMode = useCallback(
    async (mode: "keychain" | "passphrase") => {
      if (!rpc || mode === config.authMode) {
        return;
      }

      await withBusy(async () => {
        await rpc.setConfig({ key: "authMode", value: mode });
        await loadConfig();
        toast.success(`Authentication switched to ${mode}`);
      });
    },
    [config.authMode, loadConfig, rpc, withBusy],
  );

  const handleSetProviderSessionTtl = useCallback(
    async (minutes: number) => {
      if (!rpc || minutes === config.providerSessionTtlMinutes) {
        return;
      }

      await withBusy(async () => {
        await rpc.setConfig({ key: "providerSessionTtlMinutes", value: String(minutes) });
        await loadConfig();
        toast.success(
          minutes > 0
            ? `Provider session reuse set to ${minutes} minute${minutes === 1 ? "" : "s"}`
            : "Provider session reuse disabled",
        );
      });
    },
    [config.providerSessionTtlMinutes, loadConfig, rpc, withBusy],
  );

  const handleInstallCli = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      const result = await rpc.installCliCommand();
      await loadCliInstallStatus();
      toast.success(
        result.requiresRestart
          ? result.updated
            ? "CLI updated. Open a new terminal session to use cloakenv."
            : "CLI installed. Open a new terminal session to use cloakenv."
          : result.updated
            ? "CLI updated and ready."
            : "CLI installed and ready.",
      );
    });
  }, [loadCliInstallStatus, rpc, withBusy]);

  const handleCheckAppUpdates = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      const status = await rpc.checkForAppUpdates({ userInitiated: true });
      setAppUpdateStatus(status);

      if (status.error) {
        toast.error(status.error);
        return;
      }

      if (status.updateReady) {
        toast.success("An update is already downloaded and ready to install.");
        return;
      }

      if (status.updateAvailable) {
        toast.success(
          status.latestVersion
            ? `Version ${status.latestVersion} is available to download.`
            : "A newer version is available to download.",
        );
        return;
      }

      toast.success("CloakEnv is up to date.");
    });
  }, [rpc, withBusy]);

  const handleDownloadAppUpdate = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      setAppUpdateStatus((current) =>
        current
          ? {
              ...current,
              downloading: true,
              error: null,
              lastStatusMessage: "Downloading the latest release...",
            }
          : current,
      );
      const status = await rpc.downloadAppUpdate();
      setAppUpdateStatus(status);
      toast.success("Downloading the latest update in the background.");
    });
  }, [rpc, withBusy]);

  const handleApplyAppUpdate = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      setAppUpdateStatus((current) =>
        current
          ? {
              ...current,
              applying: true,
              error: null,
              lastStatusMessage: "Installing the downloaded update...",
            }
          : current,
      );
      await rpc.applyAppUpdate();
    });
  }, [rpc, withBusy]);

  const handleSetDesktopAppearance = useCallback(
    async (appearance: "dock_and_menu" | "dock_only" | "menu_only") => {
      if (!rpc || appearance === config.desktopAppearance) {
        return;
      }

      await withBusy(async () => {
        await rpc.setConfig({ key: "desktopAppearance", value: appearance });
        await loadConfig();
        toast.success(`${formatDesktopAppearance(appearance)} enabled`);
      });
    },
    [config.desktopAppearance, loadConfig, rpc, withBusy],
  );

  return (
    <div className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
      {/* ── Sidebar ── */}
      <nav className="flex w-[200px] shrink-0 select-none flex-col border-r border-border bg-sidebar">
        <div className="px-4 pt-4 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Settings
          </span>
        </div>
        <div className="space-y-0.5 px-2">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setView(item.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-[15px] shrink-0",
                    active ? "text-sidebar-primary" : "text-sidebar-foreground/40",
                  )}
                  strokeWidth={1.6}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Content pane ── */}
      <div className="flex-1 overflow-y-auto bg-background px-8 pt-7 pb-8">
        <h1 className="mb-5 text-[20px] font-semibold tracking-[-0.01em] text-foreground">
          {SIDEBAR_ITEMS.find((i) => i.value === view)?.label}
        </h1>

        <div className="max-w-2xl space-y-6">
          {view === "general" ? (
            <>
              <SettingsGroup title="Appearance">
                <SettingsRow label="Theme">
                  <Select
                    value={themePreference}
                    onValueChange={(value) => setThemePreference(value as ThemePreference)}
                  >
                    <SelectTrigger className="w-[10rem] rounded-lg text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </SettingsGroup>

              <SettingsGroup
                title="Desktop Presence"
                footer="Choose how the app stays reachable while the provider continues running."
              >
                <div className="px-4 py-3">
                  <RadioGroup
                    value={config.desktopAppearance}
                    onValueChange={(value) =>
                      void handleSetDesktopAppearance(
                        value as "dock_and_menu" | "dock_only" | "menu_only",
                      )
                    }
                    disabled={loading}
                    className="gap-0"
                  >
                    <SettingsRadioOption
                      value="dock_and_menu"
                      label="Dock + Menu Bar"
                      description="Keep both the Dock icon and status item available."
                    />
                    <SettingsRadioOption
                      value="dock_only"
                      label="Dock Only"
                      description="Standard Dock behavior without a menu bar item."
                    />
                    <SettingsRadioOption
                      value="menu_only"
                      label="Menu Bar Only"
                      description="Hide the Dock and reopen from the status item."
                      last
                    />
                  </RadioGroup>
                </div>
              </SettingsGroup>

              <SettingsGroup
                title="App Updates"
                footer="Packaged stable releases can check, download, and install updates in place."
              >
                <SettingsRowBlock
                  label="Updater"
                  description={formatAppUpdateDescription(appUpdateStatus)}
                >
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusDot active={Boolean(appUpdateStatus?.supported)}>
                        {appUpdateStatus?.supported ? "Updater ready" : "Updater unavailable"}
                      </StatusDot>
                      <StatusDot active={Boolean(appUpdateStatus?.configured)}>
                        {appUpdateStatus?.configured
                          ? "Release feed configured"
                          : "No release feed"}
                      </StatusDot>
                      <StatusDot active={Boolean(appUpdateStatus?.updateReady)}>
                        {appUpdateStatus?.updateReady
                          ? "Ready to install"
                          : appUpdateStatus?.updateAvailable
                            ? "Update available"
                            : "No pending update"}
                      </StatusDot>
                    </div>

                    <Input
                      value={formatAppUpdateBuild(appUpdateStatus)}
                      readOnly
                      className="h-9 rounded-lg bg-muted/50 font-mono text-[12px]"
                    />

                    {appUpdateStatus?.lastStatusMessage ? (
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        {appUpdateStatus.lastStatusMessage}
                      </p>
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        {formatAppUpdateFooter(appUpdateStatus)}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="rounded-lg text-[13px]"
                          onClick={() => void handleCheckAppUpdates()}
                          disabled={
                            loading ||
                            !appUpdateStatus?.supported ||
                            appUpdateStatus.checking ||
                            appUpdateStatus.downloading ||
                            appUpdateStatus.applying
                          }
                        >
                          <RefreshCw
                            className={cn(
                              "mr-1.5 size-3.5",
                              appUpdateStatus?.checking && "animate-spin",
                            )}
                          />
                          Check Now
                        </Button>

                        {appUpdateStatus?.updateReady ? (
                          <Button
                            size="sm"
                            className="rounded-lg text-[13px]"
                            onClick={() => void handleApplyAppUpdate()}
                            disabled={loading || appUpdateStatus.applying}
                          >
                            {appUpdateStatus.applying ? "Restarting..." : "Restart to Update"}
                          </Button>
                        ) : appUpdateStatus?.updateAvailable ? (
                          <Button
                            size="sm"
                            className="rounded-lg text-[13px]"
                            onClick={() => void handleDownloadAppUpdate()}
                            disabled={
                              loading || appUpdateStatus.downloading || appUpdateStatus.applying
                            }
                          >
                            <Download className="mr-1.5 size-3.5" />
                            {appUpdateStatus.downloading ? "Downloading..." : "Download Update"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </SettingsRowBlock>
              </SettingsGroup>
            </>
          ) : null}

          {view === "security" ? (
            <>
              <SettingsGroup
                title="Authentication"
                footer="Desktop-sensitive actions require keychain mode."
              >
                <div className="px-4 py-3">
                  <RadioGroup
                    value={config.authMode}
                    onValueChange={(value) =>
                      void handleSetAuthMode(value as "keychain" | "passphrase")
                    }
                    disabled={loading}
                    className="gap-0"
                  >
                    <SettingsRadioOption
                      value="keychain"
                      label="Keychain"
                      description="Native approvals, reveal flows, and brokered desktop access."
                    />
                    <SettingsRadioOption
                      value="passphrase"
                      label="Passphrase"
                      description="Terminal-local vault access. Disables desktop-sensitive actions."
                      last
                    />
                  </RadioGroup>
                </div>
              </SettingsGroup>

              <SettingsGroup
                title="Provider Session Reuse"
                footer="Short-lived leases reduce repeated prompts for the same workflow."
              >
                <SettingsRow
                  label="Reuse window"
                  description="Only exact requester and scope matches can reuse an approved session."
                >
                  <Select
                    value={String(config.providerSessionTtlMinutes)}
                    onValueChange={(value) =>
                      void handleSetProviderSessionTtl(Number.parseInt(value, 10))
                    }
                    disabled={loading}
                  >
                    <SelectTrigger className="w-[10rem] rounded-lg text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Disabled</SelectItem>
                      <SelectItem value="5">5 minutes</SelectItem>
                      <SelectItem value="10">10 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </SettingsGroup>
            </>
          ) : null}

          {view === "backups" ? (
            <SettingsGroup
              title="Automatic Backup"
              footer="Overwrites a single encrypted snapshot after each vault mutation."
            >
              <SettingsRow
                label="Backup folder"
                description={config.backupPath ?? "No folder selected yet."}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-lg text-[13px]"
                  onClick={() => void handleChooseBackupPath()}
                  disabled={loading}
                >
                  <FolderOpen className="mr-1.5 size-3.5" />
                  Choose
                </Button>
              </SettingsRow>

              <SettingsRow
                label="Auto-backup on write"
                description="Requires a backup folder and a stored passphrase."
              >
                <Switch
                  checked={config.autoBackup}
                  onCheckedChange={(checked) => void handleToggleAutoBackup(checked)}
                  disabled={loading}
                />
              </SettingsRow>

              <SettingsRowBlock
                label="Backup passphrase"
                description="Dedicated passphrase for automatic encrypted snapshots."
              >
                <div className="mt-3 max-w-[22rem] space-y-2">
                  <PasswordInput
                    placeholder={
                      config.autoBackupPassphraseConfigured
                        ? "Enter a new passphrase to rotate it"
                        : "Enter a strong passphrase"
                    }
                    value={backupPassphrase}
                    onChange={(event) => setBackupPassphrase(event.target.value)}
                    visible={showBackupPassphrase}
                    onToggleVisibility={() => setShowBackupPassphrase((current) => !current)}
                  />
                  <PasswordInput
                    placeholder="Confirm passphrase"
                    value={backupPassphraseConfirmation}
                    onChange={(event) => setBackupPassphraseConfirmation(event.target.value)}
                    visible={showBackupPassphrase}
                    onToggleVisibility={() => setShowBackupPassphrase((current) => !current)}
                  />
                  {backupPassphraseMismatch ? (
                    <p className="text-[11px] text-destructive">Passphrases don&rsquo;t match.</p>
                  ) : null}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <StatusDot active={config.autoBackupPassphraseConfigured}>
                      {config.autoBackupPassphraseConfigured ? "Stored" : "Not stored"}
                    </StatusDot>
                    <Button
                      size="sm"
                      className="rounded-lg text-[13px]"
                      onClick={() => void handleSaveBackupPassphrase()}
                      disabled={
                        loading ||
                        !backupPassphrase.trim() ||
                        !backupPassphraseConfirmation.trim() ||
                        backupPassphraseMismatch
                      }
                    >
                      <KeyRound className="mr-1.5 size-3.5" />
                      Save Passphrase
                    </Button>
                  </div>
                </div>
              </SettingsRowBlock>
            </SettingsGroup>
          ) : null}

          {view === "integrations" ? (
            <SettingsGroup
              title="CLI"
              footer="Install the bundled cloakenv command for terminal access to the vault. Managed installs refresh automatically when the app updates."
            >
              <SettingsRowBlock
                label="Install location"
                description={cliInstallStatus?.binDirectory ?? "Checking bundled CLI status..."}
              >
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusDot active={Boolean(cliInstallStatus?.bundled)}>
                      {cliInstallStatus?.bundled ? "Bundled binary found" : "Not bundled"}
                    </StatusDot>
                    <StatusDot active={Boolean(cliInstallStatus?.installed)}>
                      {cliInstallStatus?.installed ? "Installed" : "Not installed"}
                    </StatusDot>
                    <StatusDot active={Boolean(cliInstallStatus?.upToDate)}>
                      {cliInstallStatus?.managed
                        ? cliInstallStatus?.upToDate
                          ? "Up to date"
                          : "Update available"
                        : "Externally managed"}
                    </StatusDot>
                  </div>

                  <Input
                    value={cliInstallStatus?.installPath ?? cliInstallStatus?.binDirectory ?? ""}
                    readOnly
                    className="h-9 rounded-lg bg-muted/50 font-mono text-[12px]"
                  />

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      {cliInstallStatus?.shellIntegrationPath
                        ? `Shell integration in ${cliInstallStatus.shellIntegrationPath}.`
                        : "May need a new terminal session after install."}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0 rounded-lg text-[13px]"
                      onClick={() => void handleInstallCli()}
                      disabled={loading || !cliInstallStatus?.bundled}
                    >
                      <TerminalSquare className="mr-1.5 size-3.5" />
                      {cliInstallStatus?.updateAvailable
                        ? "Update CLI"
                        : cliInstallStatus?.installed
                          ? "Reinstall CLI"
                          : "Install CLI"}
                    </Button>
                  </div>
                </div>
              </SettingsRowBlock>
            </SettingsGroup>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Settings group with optional title and footer ── */

function SettingsGroup(props: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <section>
      {props.title ? (
        <h2 className="mb-2 px-0.5 text-[13px] font-medium text-muted-foreground">{props.title}</h2>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border/40">{props.children}</div>
      {props.footer ? (
        <p className="mt-1.5 px-0.5 text-[11px] leading-[15px] text-muted-foreground">
          {props.footer}
        </p>
      ) : null}
    </section>
  );
}

/* ── Row: label left, control right ── */

function SettingsRow(props: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/30 px-4 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <Label className="text-[13px] font-normal text-foreground">{props.label}</Label>
        {props.description ? (
          <p className="mt-0.5 text-[11px] leading-[15px] text-muted-foreground">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  );
}

/* ── Row with full-width content below label ── */

function SettingsRowBlock(props: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="border-t border-border/30 px-4 py-2.5 first:border-t-0">
      <Label className="text-[13px] font-normal text-foreground">{props.label}</Label>
      {props.description ? (
        <p className="mt-0.5 text-[11px] leading-[15px] text-muted-foreground">
          {props.description}
        </p>
      ) : null}
      {props.children}
    </div>
  );
}

/* ── Radio option row ── */

function SettingsRadioOption(props: {
  value: string;
  label: string;
  description?: string;
  last?: boolean;
}) {
  const id = `radio-${props.value}`;
  return (
    <div className={cn("flex items-start gap-3 py-2", !props.last && "border-b border-border/20")}>
      <RadioGroupItem value={props.value} id={id} className="mt-0.5" />
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal leading-none">
        <span className="text-[13px] text-foreground">{props.label}</span>
        {props.description ? (
          <span className="mt-1 block text-[11px] font-normal leading-[15px] text-muted-foreground">
            {props.description}
          </span>
        ) : null}
      </Label>
    </div>
  );
}

/* ── Inline status indicator with dot ── */

function StatusDot(props: { children: ReactNode; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px]",
        props.active ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          props.active ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      {props.children}
    </span>
  );
}

function formatAppUpdateDescription(status: AppUpdateStatusInfo | null): string {
  if (!status) {
    return "Checking updater availability...";
  }

  if (!status.supported) {
    return status.unavailableReason ?? "Updates are unavailable for this build.";
  }

  if (status.updateReady) {
    return "A downloaded update is ready to install.";
  }

  if (status.downloading) {
    return "Downloading the latest release now.";
  }

  if (status.updateAvailable) {
    return status.latestVersion
      ? `Version ${status.latestVersion} is available.`
      : "A newer release is available.";
  }

  return "Checks the packaged app for newer signed releases.";
}

function formatAppUpdateBuild(status: AppUpdateStatusInfo | null): string {
  if (!status) {
    return "Loading updater metadata...";
  }

  const parts = [
    status.currentVersion ? `version=${status.currentVersion}` : null,
    status.channel ? `channel=${status.channel}` : null,
    status.currentHash ? `hash=${status.currentHash}` : null,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join("  ");
  }

  return status.unavailableReason ?? "Packaged build metadata not available.";
}

function formatAppUpdateFooter(status: AppUpdateStatusInfo | null): string {
  if (!status) {
    return "Loading update status...";
  }

  if (status.error) {
    return status.error;
  }

  if (!status.supported) {
    return status.unavailableReason ?? "Updates are unavailable for this build.";
  }

  if (status.lastCheckedAt) {
    return `Last checked ${new Date(status.lastCheckedAt).toLocaleString()}.`;
  }

  return "Use Check Now to query the release feed for a newer version.";
}

function formatDesktopAppearance(value: "dock_and_menu" | "dock_only" | "menu_only"): string {
  if (value === "dock_only") {
    return "Dock only";
  }

  if (value === "menu_only") {
    return "Menu bar only";
  }

  return "Dock and menu bar";
}
