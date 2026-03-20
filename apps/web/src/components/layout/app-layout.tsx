import { FolderOpen, Plus } from "lucide-react";
import { useCallback, useEffect } from "react";
import { AuditPanel } from "@/components/layout/audit-panel";
import { ProjectSidebar } from "@/components/projects/project-sidebar";
import { SecretTable } from "@/components/secrets/secret-table";
import { Button } from "@/components/ui/button";
import { useSheetResize } from "@/hooks/use-sheet-resize";
import { useRPC } from "@/hooks/use-rpc";
import { DESKTOP_EVENT_NEW_PROJECT } from "@/lib/desktop-events";
import { useAppStore } from "@/lib/store";
import { Header } from "./header";
import { ToolsPanel } from "./tools-panel";

const PROJECT_SIDEBAR_DEFAULT_WIDTH = 256;
const PROJECT_SIDEBAR_MIN_WIDTH = 224;
const PROJECT_SIDEBAR_MAX_WIDTH = 450;
const MAIN_CONTENT_MIN_WIDTH = 640;

export function AppLayout() {
  const rpc = useRPC();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const projects = useAppStore((s) => s.projects);
  const setEnvironments = useAppStore((s) => s.setEnvironments);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const setSecrets = useAppStore((s) => s.setSecrets);
  const setProviderDiagnostics = useAppStore((s) => s.setProviderDiagnostics);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const getProjectSidebarMaxWidth = useCallback(
    () => Math.max(PROJECT_SIDEBAR_MIN_WIDTH, Math.min(PROJECT_SIDEBAR_MAX_WIDTH, window.innerWidth - MAIN_CONTENT_MIN_WIDTH)),
    [],
  );
  const { width: projectSidebarWidth, onResizeKeyDown, onResizeStart } = useSheetResize(
    "project-sidebar",
    PROJECT_SIDEBAR_DEFAULT_WIDTH,
    {
      min: PROJECT_SIDEBAR_MIN_WIDTH,
      max: getProjectSidebarMaxWidth,
      side: "left",
    },
  );
  const projectSidebarResizeMax = getProjectSidebarMaxWidth();

  // Load environments when active project changes
  useEffect(() => {
    if (!rpc || !activeProjectId) {
      setEnvironments([]);
      setActiveEnvironment(null);
      setSecrets([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const environments = await rpc.listEnvironments({ projectId: activeProjectId });
        if (cancelled) return;

        setEnvironments(environments);

        const nextEnvironment = environments.some((env) => env.name === activeEnvironment)
          ? activeEnvironment
          : (environments[0]?.name ?? null);
        setActiveEnvironment(nextEnvironment);

        if (!nextEnvironment) {
          setSecrets([]);
        }
      } catch (error) {
        if (cancelled) return;

        console.error("[CloakEnv] Failed to load environments:", error);
        setEnvironments([]);
        setActiveEnvironment(null);
        setSecrets([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rpc, activeProjectId, activeEnvironment, setEnvironments, setActiveEnvironment, setSecrets]);

  useEffect(() => {
    if (!rpc || !activeProjectId || !activeEnvironment) {
      setSecrets([]);
      return;
    }

    rpc
      .getSecrets({ projectId: activeProjectId, environment: activeEnvironment })
      .then(setSecrets)
      .catch((error) => {
        console.error("[CloakEnv] Failed to load secrets:", error);
        setSecrets([]);
      });
  }, [rpc, activeProjectId, activeEnvironment, setSecrets]);

  useEffect(() => {
    if (!rpc) {
      setProviderDiagnostics(null);
      return;
    }

    let cancelled = false;
    const syncProviderDiagnostics = async () => {
      try {
        const diagnostics = await rpc.getProviderDiagnostics();
        if (!cancelled) {
          setProviderDiagnostics(diagnostics);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[CloakEnv] Failed to load provider diagnostics:", error);
          setProviderDiagnostics(null);
        }
      }
    };

    void syncProviderDiagnostics();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncProviderDiagnostics();
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [rpc, setProviderDiagnostics]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Full-width toolbar (GitHub Desktop pattern) */}
      <Header projectName={activeProject?.name} sidebarWidth={projectSidebarWidth} />
      <AuditPanel />
      <ToolsPanel />

      {/* Sidebar + Main content below toolbar */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ProjectSidebar
          width={projectSidebarWidth}
          minWidth={PROJECT_SIDEBAR_MIN_WIDTH}
          maxWidth={projectSidebarResizeMax}
          onResizeKeyDown={onResizeKeyDown}
          onResizeStart={onResizeStart}
        />

        <main className="min-w-0 flex-1 overflow-auto p-6">
          {activeProject ? <SecretTable /> : <EmptyState hasProjects={projects.length > 0} />}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ hasProjects }: { hasProjects: boolean }) {
  const handleAddProject = () => {
    window.dispatchEvent(new CustomEvent(DESKTOP_EVENT_NEW_PROJECT));
  };

  if (hasProjects) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <svg
              className="h-8 w-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              role="img"
              aria-label="Lock icon"
            >
              <title>Lock icon</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">No project selected</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a project from the sidebar or create a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Get started with CloakEnv</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Open a project folder to import its .env files into an encrypted vault. Your secrets stay
          local and never leave your machine.
        </p>
        <Button size="lg" className="mt-6" onClick={handleAddProject}>
          <Plus className="h-4 w-4" />
          Open a project folder
        </Button>
      </div>
    </div>
  );
}
