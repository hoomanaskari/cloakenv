import { useEffect } from "react";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/app-layout";
import { CommandPalette } from "@/components/layout/command-palette";
import { FirstLaunchOnboarding } from "@/components/onboarding/first-launch-onboarding";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useRPC } from "@/hooks/use-rpc";
import {
  DESKTOP_EVENT_OPEN_PREFERENCES,
  DESKTOP_EVENT_OPEN_TOOLS,
  DESKTOP_EVENT_OPEN_TRACES,
} from "@/lib/desktop-events";
import { useAppStore } from "@/lib/store";

export function App() {
  const rpc = useRPC();
  const theme = useAppStore((s) => s.theme);
  const syncSystemTheme = useAppStore((s) => s.syncSystemTheme);
  const setAuditOpen = useAppStore((s) => s.setAuditOpen);
  const preferencesOpen = useAppStore((s) => s.preferencesOpen);
  const setPreferencesOpen = useAppStore((s) => s.setPreferencesOpen);
  const setToolPanelOpen = useAppStore((s) => s.setToolPanelOpen);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", disableContextMenu);
    return () => document.removeEventListener("contextmenu", disableContextMenu);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    syncSystemTheme();
    const handleChange = () => syncSystemTheme();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [syncSystemTheme]);

  useEffect(() => {
    const handleCloseWindowShortcut = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }

      if (!event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "w") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (preferencesOpen) {
        setPreferencesOpen(false);
        return;
      }

      void rpc?.closeMainWindow();
    };

    window.addEventListener("keydown", handleCloseWindowShortcut, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleCloseWindowShortcut, { capture: true });
  }, [preferencesOpen, rpc, setPreferencesOpen]);

  useEffect(() => {
    const handlePreferencesShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (!event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key !== ",") {
        return;
      }

      event.preventDefault();
      setPreferencesOpen(true);
    };

    window.addEventListener("keydown", handlePreferencesShortcut);
    return () => window.removeEventListener("keydown", handlePreferencesShortcut);
  }, [setPreferencesOpen]);

  useEffect(() => {
    const handleOpenPreferences = () => {
      setPreferencesOpen(true);
    };
    const handleOpenTools = () => {
      setToolPanelOpen(true);
    };
    const handleOpenTraces = () => {
      setAuditOpen(true);
    };

    window.addEventListener(DESKTOP_EVENT_OPEN_PREFERENCES, handleOpenPreferences);
    window.addEventListener(DESKTOP_EVENT_OPEN_TOOLS, handleOpenTools);
    window.addEventListener(DESKTOP_EVENT_OPEN_TRACES, handleOpenTraces);
    return () => {
      window.removeEventListener(DESKTOP_EVENT_OPEN_PREFERENCES, handleOpenPreferences);
      window.removeEventListener(DESKTOP_EVENT_OPEN_TOOLS, handleOpenTools);
      window.removeEventListener(DESKTOP_EVENT_OPEN_TRACES, handleOpenTraces);
    };
  }, [setAuditOpen, setPreferencesOpen, setToolPanelOpen]);

  useEffect(() => {
    const handleDevToolsShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (!event.metaKey || !event.altKey || event.ctrlKey) {
        return;
      }

      if (event.key.toLowerCase() !== "i") {
        return;
      }

      event.preventDefault();
      void rpc?.toggleDevTools();
    };

    window.addEventListener("keydown", handleDevToolsShortcut);
    return () => window.removeEventListener("keydown", handleDevToolsShortcut);
  }, [rpc]);

  return (
    <TooltipProvider>
      <AppLayout />
      <PreferencesDialog />
      <FirstLaunchOnboarding />
      <CommandPalette />
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          className: "font-sans",
        }}
      />
    </TooltipProvider>
  );
}
