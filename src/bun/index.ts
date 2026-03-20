import type { Server } from "node:net";
import { ApplicationMenu, BrowserView, BrowserWindow, Tray, Utils } from "electrobun/bun";
import type { CloakEnvRPCSchema } from "../shared/rpc-schema";
import { createAppUpdater } from "./app-updater";
import { startProviderServer, stopProviderServer } from "./approval-broker";
import { getCliInstallStatus, installCliCommand, syncInstalledCliCommand } from "./cli-command";
import { createVaultHandlers } from "./handlers";
import {
  activateMacApplication,
  applyMacDesktopAppearance,
  type DesktopAppearanceMode,
  isMacApplicationFrontmost,
  orderOutMacWindow,
  unhideMacApplication,
} from "./macos-presentation";
import { loadMainWindowFrame, saveMainWindowFrame, type WindowFrameState } from "./window-state";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentDesktopAppearance: DesktopAppearanceMode = "dock_and_menu";
let shouldRestoreMainWindowOnActivate = false;
let suppressMainWindowRestoreUntilBlur = false;
let lastKnownMacFrontmostState = false;
let providerServer: Server | null = null;
let quitApplicationPromise: Promise<void> | null = null;
let openUpdatePreferencesOnNextShow = false;

type MainWindowMenuMessage = "openPreferences" | "openTools" | "openTraces" | "newProject";

function dispatchMainWindowMenuMessage(
  window: BrowserWindow,
  message: MainWindowMenuMessage,
): void {
  const bridge = window.webview.rpc as
    | {
        send?: {
          appUpdateStatusChanged?: (payload: import("../shared/types").AppUpdateStatusInfo) => void;
          openPreferences?: (payload?: undefined) => void;
          openTools?: (payload?: undefined) => void;
          openTraces?: (payload?: undefined) => void;
          newProject?: (payload?: undefined) => void;
        };
      }
    | undefined;

  if (!bridge?.send) {
    return;
  }

  if (message === "openPreferences") {
    bridge.send.openPreferences?.();
    return;
  }

  if (message === "openTools") {
    bridge.send.openTools?.();
    return;
  }

  if (message === "openTraces") {
    bridge.send.openTraces?.();
    return;
  }

  bridge.send.newProject?.();
}

function sendMainWindowMenuMessage(message: MainWindowMenuMessage): void {
  dispatchMainWindowMenuMessage(showMainWindow(), message);
}

function sendAppUpdateStatusToMainWindow(
  nextStatus: import("../shared/types").AppUpdateStatusInfo,
): void {
  if (!mainWindow) {
    return;
  }

  const bridge = mainWindow.webview.rpc as
    | {
        send?: {
          appUpdateStatusChanged?: (payload: import("../shared/types").AppUpdateStatusInfo) => void;
        };
      }
    | undefined;

  bridge?.send?.appUpdateStatusChanged?.(nextStatus);
}

function buildTrayMenu() {
  return [
    { type: "normal", label: "Open CloakEnv", action: "open" },
    { type: "normal", label: "Check for Updates...", action: "check-for-updates" },
    { type: "normal", label: "New Project...", action: "new-project" },
    { type: "normal", label: "Tools", action: "tools" },
    { type: "normal", label: "Request Trace", action: "traces" },
    { type: "normal", label: "Preferences...", action: "preferences" },
    { type: "separator" },
    { type: "normal", label: "Quit", action: "quit" },
  ] as const;
}

class DesktopBrokerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DesktopBrokerError";
  }
}

async function requestNativeApproval(params: {
  title: string;
  message: string;
  detail: string;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    try {
      showMainWindow();
    } catch {
      throw new DesktopBrokerError(
        "desktop_not_ready",
        "CloakEnv desktop is running but cannot present its approval window.",
      );
    }
  }

  const previousShouldRestoreMainWindowOnActivate = shouldRestoreMainWindowOnActivate;
  shouldRestoreMainWindowOnActivate = false;

  if (process.platform === "darwin") {
    suppressMainWindowRestoreUntilBlur = true;

    if (previousShouldRestoreMainWindowOnActivate && mainWindow) {
      orderOutMacWindow(mainWindow.ptr);
    }

    // Do not unhide the app here. The approval dialog should surface without
    // restoring hidden windows back onto the screen.
    activateMacApplication();
  }

  let response: number;
  try {
    ({ response } = await Utils.showMessageBox({
      type: "question",
      title: params.title,
      message: params.message,
      detail: params.detail,
      buttons: ["Approve", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    }));
  } catch {
    try {
      showMainWindow();
      ({ response } = await Utils.showMessageBox({
        type: "question",
        title: params.title,
        message: params.message,
        detail: params.detail,
        buttons: ["Approve", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      }));
    } catch {
      throw new DesktopBrokerError(
        "dialog_unavailable",
        "CloakEnv desktop could not present the approval dialog.",
      );
    }
  } finally {
    shouldRestoreMainWindowOnActivate = previousShouldRestoreMainWindowOnActivate;
  }

  return response === 0;
}

// ── Initialize vault handlers ─────────────────────────────────────────
const handlers = createVaultHandlers({
  requestNativeApproval,
  showNativeNotification: Utils.showNotification,
});
const appUpdater = createAppUpdater({
  onStatusChanged: sendAppUpdateStatusToMainWindow,
  onUpdateReady: () => {
    openUpdatePreferencesOnNextShow = true;
  },
  showNativeNotification: Utils.showNotification,
});

async function pickSinglePath(options: {
  allowedFileTypes?: string;
  canChooseFiles: boolean;
  canChooseDirectory: boolean;
}): Promise<string | null> {
  showMainWindow();

  const paths = await Utils.openFileDialog({
    startingFolder: Utils.paths.home,
    allowsMultipleSelection: false,
    ...options,
  });

  return paths.length > 0 && paths[0] !== "" ? paths[0] : null;
}

// ── Define RPC (typed bridge to WebView) ──────────────────────────────
const rpc = BrowserView.defineRPC<CloakEnvRPCSchema>({
  handlers: {
    requests: {
      // ── Projects ────────────────────────────────────────
      async listProjects() {
        return handlers.listProjects();
      },
      async createProject(params: { name: string; path?: string }) {
        return handlers.createProject(params.name, params.path);
      },
      async removeProject(params: { projectId: string }) {
        await handlers.removeProject(params.projectId);
        return undefined;
      },
      async renameProject(params: { projectId: string; newName: string }) {
        await handlers.renameProject(params.projectId, params.newName);
        return undefined;
      },

      // ── Secrets ─────────────────────────────────────────
      async getSecrets(params: { projectId: string; environment?: string }) {
        return handlers.getSecrets(params.projectId, params.environment);
      },
      async listEnvironments(params: { projectId: string }) {
        return handlers.listEnvironments(params.projectId);
      },
      async createEnvironment(params: { projectId: string; name: string }) {
        return handlers.createEnvironment(params.projectId, params.name);
      },
      async removeEnvironment(params: { projectId: string; environmentId: string }) {
        await handlers.removeEnvironment(params.projectId, params.environmentId);
        return undefined;
      },
      async setSecret(params: { projectId: string; key: string; value: string; scope?: string }) {
        return handlers.setSecret(params.projectId, params.key, params.value, params.scope);
      },
      async removeSecret(params: { projectId: string; secretId: string }) {
        await handlers.removeSecret(params.projectId, params.secretId);
        return undefined;
      },
      async revealSecret(params: { projectId: string; secretId: string }) {
        return handlers.revealSecret(params.projectId, params.secretId, {
          trustedDesktopUI: true,
        });
      },
      async getSecretHistory(params: { projectId: string; secretId: string }) {
        return handlers.getSecretHistory(params.projectId, params.secretId);
      },
      async getProjectSchema(params: { projectId: string }) {
        return handlers.getProjectSchema(params.projectId);
      },
      async getProjectPolicy(params: { projectId: string }) {
        return handlers.getProjectPolicy(params.projectId);
      },
      async createProjectSchemaEntry(params: {
        projectId: string;
        key: string;
        scope: string;
        typeName: string | null;
        typeParams: Record<string, string> | null;
        sensitive: boolean;
        required: boolean;
        description: string | null;
        example: string | null;
        defaultValue: string | null;
        docsUrls: string[];
      }) {
        return handlers.createProjectSchemaEntry(params.projectId, params);
      },
      async updateProjectSchemaEntry(params: {
        projectId: string;
        id: string;
        key: string;
        scope: string;
        typeName: string | null;
        typeParams: Record<string, string> | null;
        sensitive: boolean;
        required: boolean;
        description: string | null;
        example: string | null;
        defaultValue: string | null;
        docsUrls: string[];
      }) {
        return handlers.updateProjectSchemaEntry(params.projectId, params);
      },
      async removeProjectSchemaEntry(params: { projectId: string; schemaEntryId: string }) {
        await handlers.removeProjectSchemaEntry(params.projectId, params.schemaEntryId);
        return undefined;
      },
      async updateProjectPolicyDefaults(params: {
        projectId: string;
        defaultScope: string;
        defaultCliVisibility: "allow" | "deny";
        defaultAdapterVisibility: "allow" | "deny";
      }) {
        return handlers.updateProjectPolicyDefaults(params.projectId, params);
      },
      async updateScopePolicy(params: {
        projectId: string;
        scope: string;
        cliVisibilityOverride: "inherit" | "allow" | "deny";
        adapterVisibilityOverride: "inherit" | "allow" | "deny";
      }) {
        return handlers.updateScopePolicy(params.projectId, params);
      },
      async exportProjectSchema(params: { projectId: string }) {
        return handlers.exportProjectSchema(params.projectId);
      },
      async importProjectSchema(params: { projectId: string; filePath?: string }) {
        return handlers.importProjectSchema(params.projectId, params.filePath);
      },

      // ── File System ─────────────────────────────────────
      async openFolderDialog() {
        return pickSinglePath({
          canChooseFiles: false,
          canChooseDirectory: true,
        });
      },
      async openSchemaFileDialog() {
        return pickSinglePath({
          allowedFileTypes: "schema",
          canChooseFiles: true,
          canChooseDirectory: false,
        });
      },
      async scanEnvFiles(params: { folderPath: string }) {
        return handlers.scanEnvFiles(params.folderPath);
      },
      async importEnvFile(params: { projectId: string; filePath: string }) {
        return handlers.importEnvFile(params.projectId, params.filePath);
      },
      async deleteFile(params: { filePath: string }) {
        Utils.moveToTrash(params.filePath);
        return undefined;
      },
      async openBackupFolderDialog() {
        return pickSinglePath({
          canChooseFiles: false,
          canChooseDirectory: true,
        });
      },
      async openCloakedFileDialog() {
        return pickSinglePath({
          allowedFileTypes: "cloaked",
          canChooseFiles: true,
          canChooseDirectory: false,
        });
      },

      // ── Confirm Dialog ──────────────────────────────────
      async showConfirmDialog(params: { title: string; message: string; detail?: string }) {
        return requestNativeApproval({
          title: params.title,
          message: params.message,
          detail: params.detail ?? "",
        });
      },

      // ── Backup ──────────────────────────────────────────
      async exportVault(params: { projectId?: string; passphrase: string }) {
        return handlers.exportVault(params.projectId, params.passphrase);
      },
      async restorePlainEnv(params: { projectId: string; destinationFolder?: string }) {
        return handlers.restorePlainEnv(params.projectId, params.destinationFolder);
      },
      async importCloaked(params: { filePath: string; passphrase: string }) {
        return handlers.importCloaked(params.filePath, params.passphrase);
      },

      // ── Audit ───────────────────────────────────────────
      async getAuditLog(params: { projectId?: string; limit?: number }) {
        return handlers.getAuditLog(params.projectId, params.limit);
      },

      // ── Config ──────────────────────────────────────────
      async getConfig() {
        return handlers.getConfig();
      },
      async getProviderDiagnostics() {
        return handlers.getProviderDiagnostics();
      },
      async getCliInstallStatus() {
        return getCliInstallStatus();
      },
      async getAppUpdateStatus() {
        return appUpdater.getStatus();
      },
      async installCliCommand() {
        return installCliCommand();
      },
      async checkForAppUpdates(params?: {
        downloadIfAvailable?: boolean;
        userInitiated?: boolean;
      }) {
        return appUpdater.checkForUpdates({
          downloadIfAvailable: params?.downloadIfAvailable,
          userInitiated: params?.userInitiated,
        });
      },
      async downloadAppUpdate() {
        return appUpdater.downloadUpdate();
      },
      async applyAppUpdate() {
        await appUpdater.applyUpdate();
        return undefined;
      },
      async expireProviderSession(params: { sessionId?: string; all?: boolean }) {
        return handlers.expireProviderSession(params);
      },
      async setConfig(params: { key: string; value: string }) {
        handlers.setConfig(params.key, params.value);
        if (params.key === "desktopAppearance") {
          applyDesktopPresentation(
            params.value === "dock_only" || params.value === "menu_only"
              ? params.value
              : "dock_and_menu",
          );
        }
        return undefined;
      },
      async setAutoBackupPassphrase(params: { passphrase: string }) {
        await handlers.setAutoBackupPassphrase(params.passphrase);
        return undefined;
      },
      async openPreferencesWindow() {
        sendMainWindowMenuMessage("openPreferences");
        return undefined;
      },
      async closeFocusedWindow() {
        closeFocusedDesktopWindow();
        return undefined;
      },
      async closeMainWindow() {
        closeDesktopWindow();
        return undefined;
      },
      async minimizeMainWindow() {
        minimizeDesktopWindow();
        return undefined;
      },
      async toggleMainWindowMaximize() {
        toggleDesktopWindowMaximize();
        return undefined;
      },
      async reloadFocusedWindow() {
        reloadFocusedDesktopWindow();
        return undefined;
      },
      async toggleDevTools() {
        getFocusedWindow()?.webview.toggleDevTools();
        return undefined;
      },
    },
    messages: {},
  },
});

// The desktop layout uses a bounded sidebar and centered search; below this
// size the main content clips instead of degrading gracefully.
const MAIN_WINDOW_MIN_WIDTH = 980;
const MAIN_WINDOW_MIN_HEIGHT = 640;
const DEFAULT_MAIN_WINDOW_FRAME: WindowFrameState = {
  x: 0,
  y: 0,
  width: 1100,
  height: 750,
};

function normalizeMainWindowFrame(frame: WindowFrameState): WindowFrameState {
  return {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(Math.round(frame.width), MAIN_WINDOW_MIN_WIDTH),
    height: Math.max(Math.round(frame.height), MAIN_WINDOW_MIN_HEIGHT),
  };
}

const initialMainWindowFrame = normalizeMainWindowFrame(
  loadMainWindowFrame() ?? DEFAULT_MAIN_WINDOW_FRAME,
);
let lastKnownMainWindowFrame = initialMainWindowFrame;
let persistMainWindowFrameTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMainWindowFrameSave(frame: WindowFrameState): void {
  lastKnownMainWindowFrame = normalizeMainWindowFrame(frame);

  if (persistMainWindowFrameTimer) {
    clearTimeout(persistMainWindowFrameTimer);
  }

  persistMainWindowFrameTimer = setTimeout(() => {
    saveMainWindowFrame(lastKnownMainWindowFrame);
    persistMainWindowFrameTimer = null;
  }, 150);
}

function flushMainWindowFrameSave(): void {
  if (persistMainWindowFrameTimer) {
    clearTimeout(persistMainWindowFrameTimer);
    persistMainWindowFrameTimer = null;
  }

  saveMainWindowFrame(lastKnownMainWindowFrame);
}

const MAC_COMMAND_MODIFIER = 1 << 20;
const MAC_KEY_Q = 12;
const MAC_KEY_R = 15;
const MAC_KEY_W = 13;

function isMacCommandShortcut(
  modifiers: number,
  keyCode: number,
  expectedKeyCode: number,
): boolean {
  return (
    process.platform === "darwin" &&
    (modifiers & MAC_COMMAND_MODIFIER) === MAC_COMMAND_MODIFIER &&
    keyCode === expectedKeyCode
  );
}

async function quitDesktopApplication(): Promise<void> {
  if (quitApplicationPromise) {
    return quitApplicationPromise;
  }

  quitApplicationPromise = (async () => {
    flushMainWindowFrameSave();

    if (providerServer) {
      try {
        await stopProviderServer(providerServer);
      } catch (error) {
        console.warn("[CloakEnv] Failed to stop provider server cleanly:", error);
      } finally {
        providerServer = null;
      }
    }

    Utils.quit();
  })();

  return quitApplicationPromise;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "CloakEnv",
    url: "views://main/index.html",
    rpc,
    sandbox: false,
    renderer: "native",
    frame: lastKnownMainWindowFrame,
    titleBarStyle: process.platform === "darwin" ? "hidden" : "hiddenInset",
    transparent: process.platform === "darwin",
  });

  let isClampingMainWindowSize = false;

  window.on("resize", (event) => {
    if (isClampingMainWindowSize) {
      return;
    }

    const { x, y, width, height } = (
      event as {
        data: { x: number; y: number; width: number; height: number };
      }
    ).data;

    const clampedWidth = Math.max(width, MAIN_WINDOW_MIN_WIDTH);
    const clampedHeight = Math.max(height, MAIN_WINDOW_MIN_HEIGHT);
    const nextFrame = { x, y, width: clampedWidth, height: clampedHeight };

    scheduleMainWindowFrameSave(nextFrame);

    if (clampedWidth === width && clampedHeight === height) {
      return;
    }

    isClampingMainWindowSize = true;

    try {
      window.setFrame(x, y, clampedWidth, clampedHeight);
    } finally {
      isClampingMainWindowSize = false;
    }
  });

  window.on("move", (event) => {
    const { x, y } = (event as { data: { x: number; y: number } }).data;
    scheduleMainWindowFrameSave({
      ...lastKnownMainWindowFrame,
      x,
      y,
    });
  });

  window.on("keyDown", (event) => {
    const { keyCode, modifiers, isRepeat } = (
      event as {
        data: { keyCode: number; modifiers: number; isRepeat: boolean };
      }
    ).data;

    if (isRepeat) {
      return;
    }

    if (isMacCommandShortcut(modifiers, keyCode, MAC_KEY_W)) {
      closeFocusedDesktopWindow();
      return;
    }

    if (isMacCommandShortcut(modifiers, keyCode, MAC_KEY_R)) {
      reloadFocusedDesktopWindow();
      return;
    }

    if (isMacCommandShortcut(modifiers, keyCode, MAC_KEY_Q)) {
      void quitDesktopApplication();
    }
  });

  window.on("close", () => {
    flushMainWindowFrameSave();
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }

  return mainWindow;
}

function getFocusedWindow(): BrowserWindow | null {
  return mainWindow;
}

function showMainWindow(): BrowserWindow {
  const window = ensureMainWindow();
  shouldRestoreMainWindowOnActivate = false;
  suppressMainWindowRestoreUntilBlur = false;
  unhideMacApplication();
  if (window.isMinimized()) {
    window.unminimize();
  }

  window.show();
  window.focus();

  if (openUpdatePreferencesOnNextShow) {
    openUpdatePreferencesOnNextShow = false;
    dispatchMainWindowMenuMessage(window, "openPreferences");
  }

  return window;
}

function closeDesktopWindow(): void {
  if (!mainWindow) {
    return;
  }

  shouldRestoreMainWindowOnActivate = true;

  try {
    mainWindow.close();
  } catch (error) {
    console.warn("[CloakEnv] Failed to close the main window:", error);
  }
}

function closeFocusedDesktopWindow(): void {
  closeDesktopWindow();
}

function minimizeDesktopWindow(): void {
  const window = ensureMainWindow();
  if (!window.isMinimized()) {
    window.minimize();
  }
}

function toggleDesktopWindowMaximize(): void {
  const window = showMainWindow();
  if (window.isMaximized()) {
    window.unmaximize();
    return;
  }

  window.maximize();
}

function reloadFocusedDesktopWindow(): void {
  const existingWindow = ensureMainWindow();
  const nextFrame = normalizeMainWindowFrame(existingWindow.getFrame());

  lastKnownMainWindowFrame = nextFrame;
  flushMainWindowFrameSave();
  shouldRestoreMainWindowOnActivate = false;

  try {
    existingWindow.webview.closeDevTools();
  } catch (error) {
    console.warn("[CloakEnv] Failed to close developer tools before reload:", error);
  }

  mainWindow = null;

  try {
    existingWindow.close();
  } catch (error) {
    console.warn("[CloakEnv] Failed to close the existing window during reload:", error);
  }

  mainWindow = createMainWindow();
  showMainWindow();
}

function createTray(): Tray {
  const nextTray = new Tray({
    image: "views://assets/tray-icon-template@2x.png",
    template: true,
    width: 18,
    height: 18,
  });

  nextTray.setMenu([...buildTrayMenu()]);

  nextTray.on("tray-clicked", (event: unknown) => {
    const { action } = (event as { data: { id: number; action: string } }).data;

    if (action === "" || !action) {
      return;
    }

    if (action === "open") {
      showMainWindow();
      return;
    }

    if (action === "check-for-updates") {
      void appUpdater.checkForUpdates({
        downloadIfAvailable: false,
        userInitiated: true,
      });
      return;
    }

    if (action === "preferences") {
      sendMainWindowMenuMessage("openPreferences");
      return;
    }

    if (action === "tools") {
      sendMainWindowMenuMessage("openTools");
      return;
    }

    if (action === "traces") {
      sendMainWindowMenuMessage("openTraces");
      return;
    }

    if (action === "new-project") {
      sendMainWindowMenuMessage("newProject");
      return;
    }

    if (action === "quit") {
      void quitDesktopApplication();
    }
  });

  return nextTray;
}

function setTrayVisibility(visible: boolean): void {
  if (visible) {
    if (!tray) {
      tray = createTray();
    }
    return;
  }

  tray?.remove();
  tray = null;
}

function applyDesktopPresentation(mode: DesktopAppearanceMode): void {
  currentDesktopAppearance = mode;

  const showTray = mode !== "dock_only";
  if (showTray) {
    setTrayVisibility(true);
  }

  applyMacDesktopAppearance(mode);

  if (!showTray) {
    setTrayVisibility(false);
  }

  if (mainWindow && !mainWindow.isMinimized()) {
    try {
      mainWindow.show();
      mainWindow.focus();
    } catch (error) {
      console.warn("[CloakEnv] Failed to refocus main window after presentation update:", error);
    }
  }
}

function startMacWindowRestoreMonitor(): void {
  if (process.platform !== "darwin") {
    return;
  }

  lastKnownMacFrontmostState = isMacApplicationFrontmost() ?? false;
  setInterval(() => {
    const isFrontmost = isMacApplicationFrontmost();
    if (isFrontmost === null) {
      return;
    }

    if (!isFrontmost && suppressMainWindowRestoreUntilBlur) {
      suppressMainWindowRestoreUntilBlur = false;
    }

    const becameFrontmost = isFrontmost && !lastKnownMacFrontmostState;
    lastKnownMacFrontmostState = isFrontmost;

    if (
      !becameFrontmost ||
      !shouldRestoreMainWindowOnActivate ||
      suppressMainWindowRestoreUntilBlur
    ) {
      return;
    }

    try {
      const window = showMainWindow();
      if (openUpdatePreferencesOnNextShow) {
        openUpdatePreferencesOnNextShow = false;
        dispatchMainWindowMenuMessage(window, "openPreferences");
      }
    } catch (error) {
      console.warn("[CloakEnv] Failed to restore main window after app activation:", error);
    }
  }, 250);
}

const initialConfig = await handlers.getConfig();
currentDesktopAppearance = initialConfig.desktopAppearance;

try {
  const cliSync = syncInstalledCliCommand();
  if (cliSync.updated) {
    console.log(
      `[CloakEnv] Updated managed CLI${cliSync.bundledVersion ? ` to ${cliSync.bundledVersion}` : ""}.`,
    );
  } else if (cliSync.adoptedLegacyInstall) {
    console.log("[CloakEnv] Adopted an existing CLI install for automatic updates.");
  }
} catch (error) {
  console.warn("[CloakEnv] Failed to sync managed CLI:", error);
}

mainWindow = createMainWindow();
applyDesktopPresentation(currentDesktopAppearance);
startMacWindowRestoreMonitor();
appUpdater.scheduleBackgroundCheck();

providerServer = startProviderServer(handlers);

// ── Application menu (enables Cmd+Q, Cmd+C, etc.) ───────────────────
ApplicationMenu.setApplicationMenu([
  {
    label: "CloakEnv",
    submenu: [
      { label: "About CloakEnv", enabled: false },
      { type: "separator" },
      { label: "Check for Updates...", action: "check-for-updates" },
      { type: "separator" },
      { label: "Preferences...", accelerator: "Command+,", action: "open-preferences" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { label: "Quit CloakEnv", accelerator: "Command+Q", action: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "Developer",
    submenu: [
      {
        label: "Open Developer Console",
        accelerator: "Command+Option+I",
        action: "toggle-devtools",
      },
      {
        label: "Reload Window",
        accelerator: "Command+R",
        action: "reload-main-window",
      },
    ],
  },
  {
    label: "Window",
    submenu: [
      { label: "Reload Window", accelerator: "Command+R", action: "reload-main-window" },
      { type: "separator" },
      { label: "Close Window", accelerator: "Command+W", action: "close-main-window" },
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "bringAllToFront" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
  const { action } = (event as { data: { action?: string } }).data;

  if (action === "toggle-devtools") {
    getFocusedWindow()?.webview.toggleDevTools();
  } else if (action === "reload-main-window") {
    reloadFocusedDesktopWindow();
  } else if (action === "check-for-updates") {
    void appUpdater.checkForUpdates({
      downloadIfAvailable: false,
      userInitiated: true,
    });
  } else if (action === "open-preferences") {
    sendMainWindowMenuMessage("openPreferences");
  } else if (action === "close-main-window") {
    closeFocusedDesktopWindow();
  } else if (action === "quit") {
    void quitDesktopApplication();
  }
});

console.log("[CloakEnv] Desktop app started");
