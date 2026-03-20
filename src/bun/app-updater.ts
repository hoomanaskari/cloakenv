import { Updater, type UpdateStatusEntry, type UpdateStatusType } from "electrobun/bun";
import type { AppUpdateStatusInfo } from "../shared/types";

interface NativeNotificationPayload {
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
}

interface AppUpdaterOptions {
  showNativeNotification?: (notification: NativeNotificationPayload) => void;
  onStatusChanged?: (status: AppUpdateStatusInfo) => void;
  onUpdateReady?: () => void;
}

const DOWNLOAD_ACTIVE_STATUSES = new Set<UpdateStatusType>([
  "download-starting",
  "checking-local-tar",
  "local-tar-found",
  "local-tar-missing",
  "fetching-patch",
  "patch-found",
  "patch-not-found",
  "downloading-patch",
  "applying-patch",
  "patch-applied",
  "patch-failed",
  "extracting-version",
  "patch-chain-complete",
  "downloading",
  "download-progress",
  "decompressing",
  "downloading-full-bundle",
]);

const APPLY_ACTIVE_STATUSES = new Set<UpdateStatusType>([
  "applying",
  "extracting",
  "replacing-app",
  "launching-new-version",
]);

function createInitialStatus(): AppUpdateStatusInfo {
  return {
    supported: false,
    configured: false,
    checking: false,
    downloading: false,
    applying: false,
    updateAvailable: false,
    updateReady: false,
    currentVersion: null,
    currentHash: null,
    latestVersion: null,
    latestHash: null,
    channel: null,
    baseUrl: null,
    unavailableReason: "Updates are only available in packaged builds.",
    lastCheckedAt: null,
    lastStatusType: null,
    lastStatusMessage: null,
    error: null,
  };
}

function cloneStatus(status: AppUpdateStatusInfo): AppUpdateStatusInfo {
  return { ...status };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getUnavailableReason(input: {
  supported: boolean;
  configured: boolean;
  channel: string | null;
  initError?: string | null;
}): string | null {
  if (input.supported) {
    return null;
  }

  if (input.initError) {
    return "Updates are only available in packaged builds.";
  }

  if (input.channel === "dev") {
    return "Updates are disabled for dev builds.";
  }

  if (!input.configured) {
    return "This build does not have a release feed configured yet.";
  }

  return "Updates are currently unavailable.";
}

export function createAppUpdater(options: AppUpdaterOptions = {}) {
  const status = createInitialStatus();
  let initPromise: Promise<void> | null = null;
  let checkPromise: Promise<AppUpdateStatusInfo> | null = null;
  let downloadPromise: Promise<void> | null = null;
  let applyPromise: Promise<void> | null = null;
  let backgroundCheckScheduled = false;
  let readyNotificationSent = false;

  function setStatus(patch: Partial<AppUpdateStatusInfo>): void {
    Object.assign(status, patch);
    options.onStatusChanged?.(snapshot());
  }

  function showNotification(payload: NativeNotificationPayload): void {
    options.showNativeNotification?.(payload);
  }

  function handleUpdaterStatus(entry: UpdateStatusEntry): void {
    setStatus({
      lastStatusType: entry.status,
      lastStatusMessage: entry.message,
    });

    if (entry.status === "checking") {
      setStatus({ checking: true, error: null });
      return;
    }

    if (entry.status === "update-available") {
      setStatus({
        checking: false,
        updateAvailable: true,
        latestHash: entry.details?.latestHash ?? status.latestHash,
      });
      return;
    }

    if (entry.status === "no-update" || entry.status === "check-complete") {
      setStatus({ checking: false });
      return;
    }

    if (DOWNLOAD_ACTIVE_STATUSES.has(entry.status)) {
      setStatus({ downloading: true, error: null });
      return;
    }

    if (entry.status === "download-complete") {
      setStatus({
        downloading: false,
        updateAvailable: true,
        updateReady: true,
      });

      if (!readyNotificationSent) {
        readyNotificationSent = true;
        options.onUpdateReady?.();
        showNotification({
          title: "CloakEnv update ready",
          body: "Restart the app from Preferences to install the downloaded update.",
          silent: true,
        });
      }
      return;
    }

    if (APPLY_ACTIVE_STATUSES.has(entry.status)) {
      setStatus({ applying: true, downloading: false, error: null });
      return;
    }

    if (entry.status === "complete") {
      setStatus({
        applying: false,
        downloading: false,
      });
      return;
    }

    if (entry.status === "error") {
      setStatus({
        checking: false,
        downloading: false,
        applying: false,
        error: entry.details?.errorMessage ?? entry.message,
      });
    }
  }

  async function loadLocalInfo(): Promise<void> {
    let initError: string | null = null;

    try {
      const [currentVersion, currentHash, channel, baseUrl] = await Promise.all([
        Updater.localInfo.version(),
        Updater.localInfo.hash(),
        Updater.localInfo.channel(),
        Updater.localInfo.baseUrl(),
      ]);

      const configured = Boolean(baseUrl?.trim());
      const supported = configured && channel !== "dev";

      setStatus({
        supported,
        configured,
        currentVersion,
        currentHash,
        channel,
        baseUrl: baseUrl?.trim() || null,
        unavailableReason: getUnavailableReason({
          supported,
          configured,
          channel,
        }),
        error: null,
      });
    } catch (error) {
      initError = toErrorMessage(error);
      setStatus({
        supported: false,
        configured: false,
        currentVersion: null,
        currentHash: null,
        channel: null,
        baseUrl: null,
        unavailableReason: getUnavailableReason({
          supported: false,
          configured: false,
          channel: null,
          initError,
        }),
      });
    }
  }

  async function ensureInitialized(): Promise<void> {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      Updater.onStatusChange(handleUpdaterStatus);
      await loadLocalInfo();
    })().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  function snapshot(): AppUpdateStatusInfo {
    return cloneStatus(status);
  }

  async function startDownload(userInitiated: boolean): Promise<void> {
    await ensureInitialized();

    if (!status.supported) {
      return;
    }

    if (downloadPromise) {
      return;
    }

    readyNotificationSent = false;
    downloadPromise = (async () => {
      if (userInitiated) {
        showNotification({
          title: "Downloading CloakEnv update",
          body: "The latest release is being fetched in the background.",
          silent: true,
        });
      }

      setStatus({
        downloading: true,
        error: null,
      });

      try {
        await Updater.downloadUpdate();
        const updateInfo = Updater.updateInfo();
        setStatus({
          latestVersion: updateInfo?.version || status.latestVersion,
          latestHash: updateInfo?.hash || status.latestHash,
          updateAvailable: Boolean(updateInfo?.updateAvailable) || status.updateAvailable,
          updateReady: Boolean(updateInfo?.updateReady),
          error: updateInfo?.error || null,
        });
      } catch (error) {
        setStatus({
          downloading: false,
          error: toErrorMessage(error),
        });
      }
    })().finally(() => {
      downloadPromise = null;
    });
  }

  async function getStatus(): Promise<AppUpdateStatusInfo> {
    await ensureInitialized();
    return snapshot();
  }

  async function checkForUpdates(
    options: { downloadIfAvailable?: boolean; userInitiated?: boolean } = {},
  ): Promise<AppUpdateStatusInfo> {
    await ensureInitialized();

    if (!status.supported) {
      if (options.userInitiated) {
        showNotification({
          title: "Updates unavailable",
          body: status.unavailableReason ?? "This build cannot check for updates.",
          silent: true,
        });
      }
      return snapshot();
    }

    if (checkPromise) {
      return checkPromise;
    }

    checkPromise = (async () => {
      setStatus({ checking: true, error: null });

      try {
        const updateInfo = await Updater.checkForUpdate();
        setStatus({
          checking: false,
          updateAvailable: Boolean(updateInfo.updateAvailable),
          updateReady: Boolean(updateInfo.updateReady),
          latestVersion: updateInfo.version || status.latestVersion,
          latestHash: updateInfo.hash || status.latestHash,
          error: updateInfo.error || null,
          lastCheckedAt: Date.now(),
        });

        if (updateInfo.error) {
          if (options.userInitiated) {
            showNotification({
              title: "Update check failed",
              body: updateInfo.error,
              silent: true,
            });
          }
          return snapshot();
        }

        if (!updateInfo.updateAvailable) {
          if (options.userInitiated) {
            showNotification({
              title: "CloakEnv is up to date",
              body: status.currentVersion
                ? `Version ${status.currentVersion} is current.`
                : undefined,
              silent: true,
            });
          }
          return snapshot();
        }

        if (options.downloadIfAvailable) {
          void startDownload(Boolean(options.userInitiated));
        } else if (options.userInitiated) {
          showNotification({
            title: "CloakEnv update available",
            body: updateInfo.version
              ? `Version ${updateInfo.version} is ready to download from Preferences.`
              : "A newer version is available to download from Preferences.",
            silent: true,
          });
        }

        return snapshot();
      } catch (error) {
        setStatus({
          checking: false,
          error: toErrorMessage(error),
          lastCheckedAt: Date.now(),
        });

        if (options.userInitiated) {
          showNotification({
            title: "Update check failed",
            body: status.error ?? "Could not contact the update server.",
            silent: true,
          });
        }

        return snapshot();
      }
    })().finally(() => {
      checkPromise = null;
    });

    return checkPromise;
  }

  async function downloadUpdate(): Promise<AppUpdateStatusInfo> {
    await ensureInitialized();

    if (!status.supported) {
      return snapshot();
    }

    if (!status.updateAvailable && !status.updateReady) {
      await checkForUpdates({ downloadIfAvailable: false, userInitiated: false });
    }

    if (!status.updateReady) {
      setStatus({
        downloading: true,
        error: null,
      });
    }

    void startDownload(true);
    return snapshot();
  }

  async function applyUpdate(): Promise<void> {
    await ensureInitialized();

    if (!status.supported) {
      throw new Error(status.unavailableReason ?? "This build cannot install updates.");
    }

    if (!status.updateReady) {
      throw new Error("No downloaded update is ready to install.");
    }

    if (applyPromise) {
      return applyPromise;
    }

    applyPromise = (async () => {
      showNotification({
        title: "Installing CloakEnv update",
        body: "The app will restart after the new version is applied.",
        silent: true,
      });

      setStatus({
        applying: true,
        error: null,
      });

      await Updater.applyUpdate();
    })().finally(() => {
      applyPromise = null;
    });

    return applyPromise;
  }

  function scheduleBackgroundCheck(): void {
    if (backgroundCheckScheduled) {
      return;
    }

    backgroundCheckScheduled = true;
    setTimeout(() => {
      void checkForUpdates({ downloadIfAvailable: true, userInitiated: false });
    }, 15_000);
  }

  return {
    getStatus,
    checkForUpdates,
    downloadUpdate,
    applyUpdate,
    scheduleBackgroundCheck,
  };
}
