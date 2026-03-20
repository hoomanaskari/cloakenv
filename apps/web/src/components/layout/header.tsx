import {
  Activity,
  Command,
  Maximize2,
  Minus,
  PanelRightOpen,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRPC } from "@/hooks/use-rpc";
import { useAppStore } from "@/lib/store";

interface HeaderProps {
  projectName?: string;
  sidebarWidth: number;
}

/** Prevent mousedown from bubbling to Electrobun's document-level drag listener */
const noDrag = (e: MouseEvent) => e.stopPropagation();

export function Header({ projectName, sidebarWidth }: HeaderProps) {
  const rpc = useRPC();
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setAuditOpen = useAppStore((s) => s.setAuditOpen);
  const setPreferencesOpen = useAppStore((s) => s.setPreferencesOpen);
  const setToolPanelOpen = useAppStore((s) => s.setToolPanelOpen);
  const setToolPanelView = useAppStore((s) => s.setToolPanelView);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.key !== "/") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center bg-background/80 backdrop-blur-sm">
      <div
        className="flex h-full shrink-0 items-center border-r border-b border-border px-4"
        style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
      >
        <div className="flex items-center gap-2">
          <TrafficLightButton
            label="Close window"
            tone="close"
            onClick={() => void rpc?.closeMainWindow()}
          >
            <X className="size-2.5 stroke-[2.5]" />
          </TrafficLightButton>
          <TrafficLightButton
            label="Minimize window"
            tone="minimize"
            onClick={() => void rpc?.minimizeMainWindow()}
          >
            <Minus className="size-2.5 stroke-[2.5]" />
          </TrafficLightButton>
          <TrafficLightButton
            label="Zoom window"
            tone="zoom"
            onClick={() => void rpc?.toggleMainWindowMaximize()}
          >
            <Maximize2 className="size-2.5 stroke-[2.5]" />
          </TrafficLightButton>
        </div>
        <div className="electrobun-webkit-app-region-drag ml-4 h-full flex-1" aria-hidden="true" />
      </div>

      <div className="electrobun-webkit-app-region-drag relative flex h-full min-w-0 flex-1 items-center border-b border-border px-6 select-none">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            {projectName ?? "CloakEnv"}
          </h1>
          {projectName && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              vault
            </span>
          )}
        </div>

        <search className="absolute left-1/2 w-72 max-w-full -translate-x-1/2" onMouseDown={noDrag}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search secrets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full border-0 bg-muted/50 pl-9 text-sm focus:ring-1 focus-visible:ring-1"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            /
          </kbd>
        </search>

        <div className="ml-auto flex items-center gap-1" role="toolbar" onMouseDown={noDrag}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Command className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setAuditOpen(true)}
          >
            <Activity className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3"
            onClick={() => {
              setToolPanelView("transfer");
              setToolPanelOpen(true);
            }}
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            Tools
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 rounded-full px-3"
            onClick={() => setPreferencesOpen(true)}
            title="Preferences (Command+,)"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Preferences
          </Button>
        </div>
      </div>
    </header>
  );
}

function TrafficLightButton({
  children,
  label,
  onClick,
  tone,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tone: "close" | "minimize" | "zoom";
}) {
  const toneClassName =
    tone === "close"
      ? "bg-[#ff5f57] hover:bg-[#ff7b72]"
      : tone === "minimize"
        ? "bg-[#febc2e] hover:bg-[#ffd15a]"
        : "bg-[#28c840] hover:bg-[#48d85f]";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={noDrag}
      onClick={onClick}
      className={`group flex size-3.5 items-center justify-center rounded-full text-black/65 transition ${toneClassName}`}
    >
      <span className="opacity-0 transition-opacity group-hover:opacity-100">{children}</span>
    </button>
  );
}
