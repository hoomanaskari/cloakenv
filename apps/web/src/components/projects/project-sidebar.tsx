import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderOpen,
  PencilLine,
  Plus,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getRPCError, retryRPCInit, useRPC } from "@/hooks/use-rpc";
import { DESKTOP_EVENT_NEW_PROJECT } from "@/lib/desktop-events";
import { type Environment, useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EnvImportDialog, type EnvImportDialogState } from "./env-import-dialog";

interface ProjectSidebarProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResizeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onResizeStart: (event: MouseEvent<HTMLElement>) => void;
}

export function ProjectSidebar({
  width,
  minWidth,
  maxWidth,
  onResizeKeyDown,
  onResizeStart,
}: ProjectSidebarProps) {
  const rpc = useRPC();
  const projects = useAppStore((s) => s.projects);
  const auditEntries = useAppStore((s) => s.auditEntries);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setProjects = useAppStore((s) => s.setProjects);
  const environments = useAppStore((s) => s.environments);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const setAuditEntries = useAppStore((s) => s.setAuditEntries);
  const setEnvironments = useAppStore((s) => s.setEnvironments);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const setSecrets = useAppStore((s) => s.setSecrets);
  const providerDiagnostics = useAppStore((s) => s.providerDiagnostics);
  const setToolPanelOpen = useAppStore((s) => s.setToolPanelOpen);
  const setToolPanelView = useAppStore((s) => s.setToolPanelView);

  // Track which projects are expanded (independent of active selection)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectEnvironments, setProjectEnvironments] = useState<Map<string, Environment[]>>(
    new Map(),
  );

  const toggleProjectExpanded = useCallback(
    async (projectId: string) => {
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }
        return next;
      });

      // Load environments for this project if not cached
      if (!projectEnvironments.has(projectId) && rpc) {
        const envs = await rpc.listEnvironments({ projectId });
        setProjectEnvironments((prev) => new Map(prev).set(projectId, envs));
      }
    },
    [rpc, projectEnvironments],
  );

  // Keep projectEnvironments in sync with the store's environments for the active project
  useEffect(() => {
    if (activeProjectId && environments.length >= 0) {
      setProjectEnvironments((prev) => new Map(prev).set(activeProjectId, environments));
    }
  }, [activeProjectId, environments]);

  // Auto-expand the active project
  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects((prev) => {
        if (prev.has(activeProjectId)) return prev;
        return new Set(prev).add(activeProjectId);
      });
    }
  }, [activeProjectId]);

  // Import dialog state
  const [importDialog, setImportDialog] = useState<EnvImportDialogState>({
    open: false,
    projectId: null,
    projectName: "",
    folderPath: "",
    envFiles: [],
    importedFiles: new Set(),
    phase: "preview",
  });
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<{
    id: string;
    name: string;
    secretCount: number;
  } | null>(null);
  const [environmentPendingRemoval, setEnvironmentPendingRemoval] = useState<{
    id: string;
    name: string;
    secretCount: number;
  } | null>(null);

  const refreshProjects = useCallback(async () => {
    if (!rpc) {
      return [];
    }

    const updatedProjects = await rpc.listProjects();
    setProjects(updatedProjects);
    setProjectEnvironments((prev) => {
      const next = new Map<string, Environment[]>();
      for (const [projectId, envs] of prev.entries()) {
        if (updatedProjects.some((project) => project.id === projectId)) {
          next.set(projectId, envs);
        }
      }
      return next;
    });

    if (activeProjectId && !updatedProjects.some((project) => project.id === activeProjectId)) {
      setActiveProject(null);
      setEnvironments([]);
      setActiveEnvironment(null);
      setSecrets([]);
    }

    return updatedProjects;
  }, [
    rpc,
    activeProjectId,
    setActiveEnvironment,
    setActiveProject,
    setEnvironments,
    setProjects,
    setSecrets,
  ]);

  useEffect(() => {
    if (!rpc) {
      return;
    }

    let disposed = false;
    const syncProjects = async () => {
      try {
        await refreshProjects();
      } catch (error) {
        if (!disposed) {
          console.error("[CloakEnv] Failed to sync project list:", error);
        }
      }
    };

    void syncProjects();

    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        void syncProjects();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncProjects();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncProjects();
      }
    }, 3000);

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [rpc, refreshProjects]);

  const handleAddProject = useCallback(async () => {
    if (!rpc) {
      const error = getRPCError();
      if (error) {
        retryRPCInit();
        toast.error(`RPC failed: ${error}`);
      } else {
        toast.error("RPC not ready");
      }
      return;
    }

    try {
      // Step 1: Open native folder picker
      const folderPath = await rpc.openFolderDialog();
      if (!folderPath) return;

      // Derive project name from folder
      const parts = folderPath.split("/");
      const projectName = parts[parts.length - 1] || "unnamed";

      // Step 2: Create project
      const project = await rpc.createProject({ name: projectName, path: folderPath });

      // Step 3: Scan for .env files
      const envFiles = await rpc.scanEnvFiles({ folderPath });

      // Refresh project list
      const updatedProjects = await refreshProjects();
      setProjects(updatedProjects);
      setActiveProject(project.id);

      if (envFiles.length > 0) {
        // Show import dialog
        setImportDialog({
          open: true,
          projectId: project.id,
          projectName,
          folderPath,
          envFiles,
          importedFiles: new Set(),
          phase: "preview",
        });
      } else {
        setEnvironments([]);
        setActiveEnvironment(null);
        setSecrets([]);
        toast.success(`Project "${projectName}" added`);
      }
    } catch (err) {
      console.error("[CloakEnv] Failed to add project:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add project");
    }
  }, [
    rpc,
    refreshProjects,
    setProjects,
    setActiveProject,
    setActiveEnvironment,
    setEnvironments,
    setSecrets,
  ]);

  useEffect(() => {
    const handleNewProject = () => {
      void handleAddProject();
    };

    window.addEventListener(DESKTOP_EVENT_NEW_PROJECT, handleNewProject);
    return () => window.removeEventListener(DESKTOP_EVENT_NEW_PROJECT, handleNewProject);
  }, [handleAddProject]);

  const handleImportFile = useCallback(
    async (filePath: string) => {
      if (!rpc || !importDialog.projectId) return;

      try {
        const result = await rpc.importEnvFile({
          projectId: importDialog.projectId,
          filePath,
        });

        setImportDialog((prev) => ({
          ...prev,
          importedFiles: new Set([...prev.importedFiles, filePath]),
        }));

        const schemaSuffix =
          result.schemaMatched > 0 ? `, applied schema metadata to ${result.schemaMatched}` : "";
        toast.success(`Imported ${result.imported} secrets${schemaSuffix}`);

        for (const warning of result.warnings) {
          toast.warning(`${warning.key}: ${warning.message}`);
        }
      } catch (err) {
        console.error("[CloakEnv] Failed to import file:", err);
        toast.error("Failed to import file");
      }
    },
    [rpc, importDialog.projectId],
  );

  const handleImportAll = useCallback(async () => {
    if (!rpc || !importDialog.projectId) return;

    setImportDialog((prev) => ({ ...prev, phase: "importing" }));

    for (const file of importDialog.envFiles) {
      if (!importDialog.importedFiles.has(file.filePath)) {
        await handleImportFile(file.filePath);
      }
    }

    // Refresh secrets
    const environments = await rpc.listEnvironments({ projectId: importDialog.projectId });
    setEnvironments(environments);
    const nextEnvironment = environments[0]?.name ?? null;
    setActiveEnvironment(nextEnvironment);
    const secrets = nextEnvironment
      ? await rpc.getSecrets({ projectId: importDialog.projectId, environment: nextEnvironment })
      : [];
    setSecrets(secrets);

    // Refresh project list to update counts
    const updatedProjects = await refreshProjects();
    setProjects(updatedProjects);

    setImportDialog((prev) => ({ ...prev, phase: "delete-prompt" }));
  }, [
    rpc,
    importDialog,
    handleImportFile,
    refreshProjects,
    setSecrets,
    setProjects,
    setEnvironments,
    setActiveEnvironment,
  ]);

  const handleDeleteEnvFiles = useCallback(async () => {
    if (!rpc) return;

    for (const file of importDialog.envFiles) {
      await rpc.deleteFile({ filePath: file.filePath });
    }

    toast.success("Original .env files moved to trash");
    setImportDialog((prev) => ({ ...prev, phase: "done", open: false }));
  }, [rpc, importDialog.envFiles]);

  const promptProjectRemoval = useCallback(
    (project: { id: string; name: string; secretCount: number }) => {
      setProjectPendingRemoval({
        id: project.id,
        name: project.name,
        secretCount: project.secretCount,
      });
    },
    [],
  );

  const handleRemoveProject = useCallback(async () => {
    if (!rpc || !projectPendingRemoval) return;

    const removedProject = projectPendingRemoval;

    try {
      await rpc.removeProject({ projectId: removedProject.id });
    } catch (err) {
      console.error("[CloakEnv] Failed to remove project:", err);
      toast.error(err instanceof Error ? err.message : "Failed to remove project");
      return;
    }

    let updatedProjects = projects.filter((project) => project.id !== removedProject.id);
    try {
      updatedProjects = await refreshProjects();
    } catch (err) {
      console.error("[CloakEnv] Project removed, but refresh failed:", err);
      toast.warning("Project deleted, but the project list did not fully refresh");
    }

    try {
      setExpandedProjects((prev) => {
        if (!prev.has(removedProject.id)) return prev;
        const next = new Set(prev);
        next.delete(removedProject.id);
        return next;
      });
      setProjectEnvironments((prev) => {
        if (!prev.has(removedProject.id)) return prev;
        const next = new Map(prev);
        next.delete(removedProject.id);
        return next;
      });
      setAuditEntries(auditEntries.filter((entry) => entry.projectId !== removedProject.id));
      setProjects(updatedProjects);

      if (activeProjectId === removedProject.id) {
        const nextProject = updatedProjects[0] ?? null;
        setActiveProject(nextProject?.id ?? null);
        let nextEnvironments: Environment[] = [];
        if (nextProject) {
          try {
            nextEnvironments = await rpc.listEnvironments({ projectId: nextProject.id });
          } catch (err) {
            console.error("[CloakEnv] Failed to load next project environments:", err);
            toast.warning("Project deleted, but the next project environments could not be loaded");
          }
        }
        setEnvironments(nextEnvironments);
        const nextEnvironment = nextEnvironments[0]?.name ?? null;
        setActiveEnvironment(nextEnvironment);
        if (nextProject && nextEnvironment) {
          try {
            setSecrets(
              await rpc.getSecrets({ projectId: nextProject.id, environment: nextEnvironment }),
            );
          } catch (err) {
            console.error("[CloakEnv] Failed to load next project secrets:", err);
            setSecrets([]);
            toast.warning("Project deleted, but the next project secrets could not be loaded");
          }
        } else {
          setSecrets([]);
        }
      }

      toast.success(`Deleted "${removedProject.name}" and wiped its CloakEnv data`);
      setProjectPendingRemoval(null);
    } catch (err) {
      console.error("[CloakEnv] Failed to remove project:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to update the app after deleting the project",
      );
    }
  }, [
    rpc,
    auditEntries,
    projects,
    projectPendingRemoval,
    activeProjectId,
    refreshProjects,
    setActiveProject,
    setAuditEntries,
    setProjects,
    setSecrets,
    setEnvironments,
    setActiveEnvironment,
  ]);

  const handleRemoveEnvironment = useCallback(async () => {
    if (!rpc || !activeProjectId || !environmentPendingRemoval) return;

    try {
      await rpc.removeEnvironment({
        projectId: activeProjectId,
        environmentId: environmentPendingRemoval.id,
      });

      const updatedEnvironments = await rpc.listEnvironments({ projectId: activeProjectId });
      setEnvironments(updatedEnvironments);

      const nextEnvironment = updatedEnvironments.some(
        (environment) => environment.name === activeEnvironment,
      )
        ? activeEnvironment
        : (updatedEnvironments[0]?.name ?? null);
      setActiveEnvironment(nextEnvironment);

      setSecrets(
        nextEnvironment
          ? await rpc.getSecrets({ projectId: activeProjectId, environment: nextEnvironment })
          : [],
      );

      const updatedProjects = await refreshProjects();
      setProjects(updatedProjects);

      toast.success(`Removed environment "${environmentPendingRemoval.name}"`);
      setEnvironmentPendingRemoval(null);
    } catch (err) {
      console.error("[CloakEnv] Failed to remove environment:", err);
      toast.error("Failed to remove environment");
    }
  }, [
    rpc,
    activeProjectId,
    activeEnvironment,
    environmentPendingRemoval,
    refreshProjects,
    setActiveEnvironment,
    setEnvironments,
    setProjects,
    setSecrets,
  ]);

  const [createEnvironmentDialog, setCreateEnvironmentDialog] = useState(false);
  const [environmentName, setEnvironmentName] = useState("");
  const [savingEnvironment, setSavingEnvironment] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const [isResizeDragging, setIsResizeDragging] = useState(false);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      setIsResizeDragging(false);
      const handle = resizeHandleRef.current;
      if (handle) {
        handle.blur();
      }
      document.body.style.cursor = handle?.matches(":hover") ? "ew-resize" : "";
    };

    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, []);

  const handleCreateEnvironment = useCallback(async () => {
    if (!rpc || !activeProjectId || !environmentName.trim()) return;

    setSavingEnvironment(true);
    try {
      const created = await rpc.createEnvironment({
        projectId: activeProjectId,
        name: environmentName.trim(),
      });
      toast.success(`Created environment "${created.name}"`);
      setCreateEnvironmentDialog(false);
      setEnvironmentName("");

      const updatedEnvironments = await rpc.listEnvironments({ projectId: activeProjectId });
      setEnvironments(updatedEnvironments);
      setActiveEnvironment(created.name);

      const updatedProjects = await refreshProjects();
      setProjects(updatedProjects);

      const secrets = await rpc.getSecrets({
        projectId: activeProjectId,
        environment: created.name,
      });
      setSecrets(secrets);
    } catch (err) {
      console.error("[CloakEnv] Failed to create environment:", err);
      toast.error("Failed to create environment");
    } finally {
      setSavingEnvironment(false);
    }
  }, [
    rpc,
    activeProjectId,
    environmentName,
    refreshProjects,
    setEnvironments,
    setActiveEnvironment,
    setProjects,
    setSecrets,
  ]);

  const handleResizeMouseDown = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      setIsResizeDragging(true);
      onResizeStart(event);
    },
    [onResizeStart],
  );

  const handleResizeMouseEnter = useCallback(() => {
    document.body.style.cursor = "ew-resize";
  }, []);

  const handleResizeMouseLeave = useCallback(() => {
    if (!isResizeDragging) {
      document.body.style.cursor = "";
    }
  }, [isResizeDragging]);

  return (
    <div
      className="relative flex min-h-0 shrink-0 select-none flex-col border-r border-border bg-background"
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {/* Project list */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
          onClick={handleAddProject}
          title="Add project (open folder)"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-0.5">
          {projects.map((project) => {
            const isActive = activeProjectId === project.id;
            const isExpanded = expandedProjects.has(project.id);
            const envs = projectEnvironments.get(project.id) ?? [];
            return (
              <Collapsible
                key={project.id}
                open={isExpanded}
                onOpenChange={() => toggleProjectExpanded(project.id)}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="group/project flex items-center gap-1">
                      <div
                        className={cn(
                          "group flex min-w-0 flex-1 items-center rounded-md transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                        )}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex shrink-0 items-center py-1.5 pl-2 pr-0.5"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3 text-sidebar-foreground/40" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-sidebar-foreground/40" />
                            )}
                          </button>
                        </CollapsibleTrigger>
                        <button
                          type="button"
                          onClick={() => setActiveProject(project.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
                        >
                          <FolderOpen
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              isActive ? "text-sidebar-primary" : "text-sidebar-foreground/40",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{project.name}</div>
                          </div>
                          <span className="shrink-0 text-[10px] tabular-nums text-sidebar-foreground/30">
                            {project.secretCount}
                          </span>
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        title={`Delete ${project.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          promptProjectRemoval(project);
                        }}
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-sidebar-foreground/35 transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "opacity-100"
                            : "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100",
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuLabel>Project</ContextMenuLabel>
                    <ContextMenuItem onSelect={() => setActiveProject(project.id)}>
                      <FolderOpen className="h-4 w-4" />
                      Open project
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => promptProjectRemoval(project)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete project data
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                {/* Environment sub-tree */}
                <CollapsibleContent>
                  <div className="ml-3 mt-0.5 border-l border-sidebar-border pl-2">
                    {envs.length > 0 ? (
                      <div className="space-y-px py-0.5">
                        {envs.map((env) => {
                          const isEnvActive = isActive && env.name === activeEnvironment;
                          return (
                            <ContextMenu key={env.id}>
                              <ContextMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveProject(project.id);
                                    setActiveEnvironment(env.name);
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                                    isEnvActive
                                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                                  )}
                                >
                                  {env.sourceKind === "imported" ? (
                                    <FileCode2 className="h-3 w-3 shrink-0 text-sidebar-foreground/40" />
                                  ) : (
                                    <PencilLine className="h-3 w-3 shrink-0 text-sidebar-foreground/40" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate text-xs">
                                    {env.name}
                                  </span>
                                  <span className="shrink-0 text-[10px] tabular-nums text-sidebar-foreground/30">
                                    {env.secretCount}
                                  </span>
                                </button>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-56">
                                <ContextMenuLabel>Environment</ContextMenuLabel>
                                <ContextMenuItem
                                  onSelect={() => {
                                    setActiveProject(project.id);
                                    setActiveEnvironment(env.name);
                                  }}
                                >
                                  {env.sourceKind === "imported" ? (
                                    <FileCode2 className="h-4 w-4" />
                                  ) : (
                                    <PencilLine className="h-4 w-4" />
                                  )}
                                  Open environment
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    setEnvironmentPendingRemoval({
                                      id: env.id,
                                      name: env.name,
                                      secretCount: env.secretCount,
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remove environment
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-2 py-1.5 text-[11px] text-sidebar-foreground/35">
                        No environments
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProject(project.id);
                        setCreateEnvironmentDialog(true);
                      }}
                      className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sidebar-foreground/35 transition-colors hover:text-sidebar-foreground/60"
                    >
                      <Plus className="h-3 w-3" />
                      <span className="text-[11px]">New environment</span>
                    </button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {projects.length === 0 && (
            <button
              type="button"
              onClick={handleAddProject}
              className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-sidebar-border px-2.5 py-3 text-left text-sidebar-foreground/40 transition-colors hover:border-sidebar-foreground/30 hover:text-sidebar-foreground/60"
            >
              <Plus className="h-4 w-4" />
              <span className="text-xs">Open a project folder</span>
            </button>
          )}
        </div>
      </ScrollArea>

      <Separator className="bg-sidebar-border" />

      {/* Bottom status */}
      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            setToolPanelView("runtime");
            setToolPanelOpen(true);
          }}
          className={cn(
            "w-full rounded-[1.1rem] border px-3 py-3 text-left transition hover:border-sidebar-foreground/20 hover:bg-sidebar-accent/55",
            providerDiagnostics
              ? providerDiagnostics.desktopSensitiveAvailable
                ? "border-emerald-500/20 bg-emerald-500/10"
                : "border-amber-500/25 bg-amber-500/12"
              : "border-sidebar-border bg-sidebar-accent/30",
          )}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                providerDiagnostics
                  ? providerDiagnostics.desktopSensitiveAvailable
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                  : "bg-sidebar-foreground/35",
              )}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/55">
              Provider
            </span>
          </div>
          <p className="mt-2 text-xs font-medium text-sidebar-foreground/90">
            {providerDiagnostics
              ? providerDiagnostics.approvalMode === "terminal"
                ? "Foreground approvals live"
                : providerDiagnostics.desktopSensitiveAvailable
                  ? "Native approvals live"
                  : "Desktop approvals blocked by passphrase mode"
              : "Provider status unavailable"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-sidebar-foreground/60">
            {providerDiagnostics
              ? providerDiagnostics.providerSessionTtlMinutes > 0
                ? `${providerDiagnostics.activeSessionCount} active session${providerDiagnostics.activeSessionCount === 1 ? "" : "s"} • ${providerDiagnostics.providerSessionTtlMinutes}m reuse window`
                : `${providerDiagnostics.mode} mode • per-request approval`
              : "Open diagnostics"}
          </p>
        </button>
      </div>

      <div
        ref={resizeHandleRef}
        role="separator"
        tabIndex={0}
        data-dragging={isResizeDragging ? "true" : "false"}
        aria-label="Resize project sidebar"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={Math.round(width)}
        onMouseDown={handleResizeMouseDown}
        onMouseEnter={handleResizeMouseEnter}
        onMouseLeave={handleResizeMouseLeave}
        onKeyDown={onResizeKeyDown}
        className="group absolute top-0 -right-2 z-20 flex h-full w-4 items-center justify-center outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40"
        style={{ cursor: "ew-resize" }}
      >
        <span
          className="h-full w-px bg-border transition-colors group-hover:bg-sidebar-foreground/30 group-data-[dragging=true]:bg-ring"
          style={{ cursor: "ew-resize" }}
        />
        <span className="sr-only">
          Use the left and right arrow keys to resize the project sidebar.
        </span>
      </div>

      {/* ── Create Environment Dialog ─────────────────── */}
      <Dialog open={createEnvironmentDialog} onOpenChange={setCreateEnvironmentDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Environment</DialogTitle>
            <DialogDescription>Create a manual environment for this project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="env-name-sidebar">Name</Label>
            <Input
              id="env-name-sidebar"
              placeholder="staging"
              value={environmentName}
              onChange={(e) => setEnvironmentName(e.target.value)}
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateEnvironment();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateEnvironmentDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateEnvironment}
              disabled={!environmentName.trim() || savingEnvironment}
            >
              {savingEnvironment ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnvImportDialog
        state={importDialog}
        onOpenChange={(open) => setImportDialog((prev) => ({ ...prev, open }))}
        onImportFile={handleImportFile}
        onImportAll={handleImportAll}
        onDeleteEnvFiles={handleDeleteEnvFiles}
      />

      <AlertDialog
        open={projectPendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setProjectPendingRemoval(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <ShieldAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Permanently delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {projectPendingRemoval
                ? `This wipes "${projectPendingRemoval.name}" from CloakEnv, including its ${projectPendingRemoval.secretCount} secret${projectPendingRemoval.secretCount === 1 ? "" : "s"}, environments, schema metadata, history, and audit records. Files in the repository on disk are not changed.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRemoveProject}>
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={environmentPendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setEnvironmentPendingRemoval(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <ShieldAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove environment from vault?</AlertDialogTitle>
            <AlertDialogDescription>
              {environmentPendingRemoval
                ? `"${environmentPendingRemoval.name}" and its ${environmentPendingRemoval.secretCount} secret${environmentPendingRemoval.secretCount === 1 ? "" : "s"} will be deleted from this project in the SQLite vault. Local .env files are not changed.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRemoveEnvironment}>
              Remove environment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
