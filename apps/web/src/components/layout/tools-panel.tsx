import type {
  ConfigInfo,
  ProjectPolicyInfo,
  SchemaFieldInfo,
  SchemaImportResultInfo,
} from "@shared/types";
import {
  AlertTriangle,
  Download,
  FileText,
  FolderOpen,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalTrafficLights } from "@/components/ui/modal-traffic-lights";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRPC } from "@/hooks/use-rpc";
import { useAppStore } from "@/lib/store";
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

const EMPTY_SCHEMA_FORM = {
  key: "",
  scope: "default",
  typeName: "",
  typeParams: "",
  sensitive: true,
  required: true,
  description: "",
  example: "",
  defaultValue: "",
  docsUrls: "",
};

function getScopeLabel(
  scope: Pick<ProjectPolicyInfo["scopes"][number], "scope" | "sourceFile">,
): string {
  return scope.scope === "default" && scope.sourceFile === ".env" ? ".env" : scope.scope;
}

export function ToolsPanel() {
  const rpc = useRPC();
  const open = useAppStore((s) => s.toolPanelOpen);
  const setOpen = useAppStore((s) => s.setToolPanelOpen);
  const view = useAppStore((s) => s.toolPanelView);
  const setView = useAppStore((s) => s.setToolPanelView);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const projects = useAppStore((s) => s.projects);
  const setProjects = useAppStore((s) => s.setProjects);
  const setEnvironments = useAppStore((s) => s.setEnvironments);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const setSecrets = useAppStore((s) => s.setSecrets);
  const providerDiagnostics = useAppStore((s) => s.providerDiagnostics);
  const setProviderDiagnostics = useAppStore((s) => s.setProviderDiagnostics);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  const [config, setConfig] = useState<ConfigInfo>(INITIAL_CONFIG);
  const [loading, setLoading] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [projectPolicy, setProjectPolicy] = useState<ProjectPolicyInfo | null>(null);
  const [schemaEntries, setSchemaEntries] = useState<SchemaFieldInfo[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [isCreatingSchemaEntry, setIsCreatingSchemaEntry] = useState(false);
  const [schemaForm, setSchemaForm] = useState(EMPTY_SCHEMA_FORM);
  const schemaItemRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectedSchemaEntry = schemaEntries.find((entry) => entry.id === selectedSchemaId) ?? null;
  const desktopSensitiveUnavailable = config.authMode === "passphrase";
  const restoreScopeEntries = useMemo(
    () => (projectPolicy?.scopes ?? []).filter((scope) => scope.secretCount > 0),
    [projectPolicy],
  );

  /* ------------------------------------------------------------------ */
  /*  Data loading                                                       */
  /* ------------------------------------------------------------------ */

  const loadConfig = useCallback(async () => {
    if (!rpc) {
      return;
    }

    const next = await rpc.getConfig();
    setConfig(next);
  }, [rpc]);

  const loadProjectPolicy = useCallback(async () => {
    if (!rpc || !activeProjectId) {
      setProjectPolicy(null);
      return;
    }

    setProjectPolicy(await rpc.getProjectPolicy({ projectId: activeProjectId }));
  }, [rpc, activeProjectId]);

  const loadProviderDiagnostics = useCallback(async () => {
    if (!rpc) {
      setProviderDiagnostics(null);
      return;
    }

    setProviderDiagnostics(await rpc.getProviderDiagnostics());
  }, [rpc, setProviderDiagnostics]);

  const refreshVisibleSecrets = useCallback(async () => {
    if (!rpc || !activeProjectId || !activeEnvironment) {
      return;
    }

    setSecrets(
      await rpc.getSecrets({
        projectId: activeProjectId,
        environment: activeEnvironment,
      }),
    );
  }, [rpc, activeEnvironment, activeProjectId, setSecrets]);

  const refreshProjectData = useCallback(
    async (fallbackEnvironment?: string | null) => {
      if (!rpc || !activeProjectId) {
        return;
      }

      const [updatedEnvironments, updatedProjects, updatedPolicy] = await Promise.all([
        rpc.listEnvironments({ projectId: activeProjectId }),
        rpc.listProjects(),
        rpc.getProjectPolicy({ projectId: activeProjectId }),
      ]);

      setEnvironments(updatedEnvironments);
      setProjects(updatedProjects);
      setProjectPolicy(updatedPolicy);

      const nextEnvironment = updatedEnvironments.some((env) => env.name === activeEnvironment)
        ? activeEnvironment
        : fallbackEnvironment && updatedEnvironments.some((env) => env.name === fallbackEnvironment)
          ? fallbackEnvironment
          : (updatedEnvironments[0]?.name ?? null);

      setActiveEnvironment(nextEnvironment);

      if (!nextEnvironment) {
        setSecrets([]);
        return;
      }

      setSecrets(
        await rpc.getSecrets({
          projectId: activeProjectId,
          environment: nextEnvironment,
        }),
      );
    },
    [
      rpc,
      activeEnvironment,
      activeProjectId,
      setActiveEnvironment,
      setEnvironments,
      setProjects,
      setSecrets,
    ],
  );

  const loadSchema = useCallback(
    async (preferredId?: string | null) => {
      if (!rpc || !activeProjectId) {
        setSchemaEntries([]);
        setSelectedSchemaId(null);
        setIsCreatingSchemaEntry(false);
        return;
      }

      const entries = await rpc.getProjectSchema({ projectId: activeProjectId });
      setSchemaEntries(entries);
      setIsCreatingSchemaEntry(false);
      setSelectedSchemaId((current) => {
        const candidate = preferredId ?? current;
        return candidate && entries.some((entry) => entry.id === candidate)
          ? candidate
          : (entries[0]?.id ?? null);
      });
    },
    [rpc, activeProjectId],
  );

  useEffect(() => {
    if (!open || !rpc) {
      return;
    }

    void loadConfig();
    void loadProjectPolicy();
    void loadProviderDiagnostics();
  }, [open, rpc, loadConfig, loadProjectPolicy, loadProviderDiagnostics]);

  useEffect(() => {
    if (!open || view !== "schema") {
      return;
    }

    void loadSchema();
  }, [open, view, loadSchema]);

  useEffect(() => {
    if (isCreatingSchemaEntry) {
      return;
    }

    if (!selectedSchemaEntry) {
      setSchemaForm(EMPTY_SCHEMA_FORM);
      return;
    }

    setSchemaForm({
      key: selectedSchemaEntry.key,
      scope: selectedSchemaEntry.scope,
      typeName: selectedSchemaEntry.typeName ?? "",
      typeParams: formatTypeParams(selectedSchemaEntry.typeParams),
      sensitive: selectedSchemaEntry.sensitive,
      required: selectedSchemaEntry.required,
      description: selectedSchemaEntry.description ?? "",
      example: selectedSchemaEntry.example ?? "",
      defaultValue: selectedSchemaEntry.defaultValue ?? "",
      docsUrls: selectedSchemaEntry.docsUrls.join("\n"),
    });
  }, [isCreatingSchemaEntry, selectedSchemaEntry]);

  useEffect(() => {
    if (!selectedSchemaId || isCreatingSchemaEntry) {
      return;
    }

    const item = schemaItemRefs.current.get(selectedSchemaId);
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isCreatingSchemaEntry, selectedSchemaId]);

  /* ------------------------------------------------------------------ */
  /*  Handlers                                                           */
  /* ------------------------------------------------------------------ */

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

  const handleExpireProviderSession = useCallback(
    async (sessionId: string) => {
      if (!rpc) {
        return;
      }

      await withBusy(async () => {
        const confirmed = await rpc.showConfirmDialog({
          title: "Expire provider session?",
          message: "This lease will stop being reusable immediately.",
          detail: `Session id: ${sessionId}`,
        });
        if (!confirmed) {
          return;
        }

        const result = await rpc.expireProviderSession({ sessionId });
        await loadProviderDiagnostics();
        toast.success(
          result.expired > 0 ? "Provider session expired" : "Provider session was already gone",
        );
      });
    },
    [rpc, withBusy, loadProviderDiagnostics],
  );

  const handleExpireAllProviderSessions = useCallback(async () => {
    if (!rpc) {
      return;
    }

    await withBusy(async () => {
      const confirmed = await rpc.showConfirmDialog({
        title: "Expire all provider sessions?",
        message: "Every reusable approval lease will be invalidated immediately.",
        detail: "Future matching runs will require fresh approval again.",
      });
      if (!confirmed) {
        return;
      }

      const result = await rpc.expireProviderSession({ all: true });
      await loadProviderDiagnostics();
      toast.success(`Expired ${result.expired} provider session${result.expired === 1 ? "" : "s"}`);
    });
  }, [rpc, withBusy, loadProviderDiagnostics]);

  const handleEncryptedExport = useCallback(async () => {
    if (!rpc) return;
    if (!exportPassphrase.trim()) {
      toast.error("Enter an export passphrase first");
      return;
    }

    await withBusy(async () => {
      const result = await rpc.exportVault({ passphrase: exportPassphrase });
      setExportPassphrase("");
      toast.success(`Encrypted backup written to ${result.path}`);
    });
  }, [rpc, exportPassphrase, withBusy]);

  const handlePickImportFile = useCallback(async () => {
    if (!rpc) return;

    const filePath = await rpc.openCloakedFileDialog();
    if (!filePath) return;

    setImportFilePath(filePath);
    setImportPassphrase("");
    setImportError(null);
    setOpen(false);
    setImportDialogOpen(true);
  }, [rpc, setOpen]);

  const handleImportCloaked = useCallback(async () => {
    if (!rpc || !importFilePath || !importPassphrase.trim()) return;

    try {
      setImportLoading(true);
      setImportError(null);
      const result = await rpc.importCloaked({
        filePath: importFilePath,
        passphrase: importPassphrase,
      });
      setImportDialogOpen(false);
      setImportPassphrase("");
      setImportFilePath(null);
      await loadConfig();
      setProjects(await rpc.listProjects());
      await loadProjectPolicy();
      toast.success(
        `Imported ${result.secretsImported} secret${result.secretsImported === 1 ? "" : "s"}`,
      );
    } catch {
      setImportError("Passphrase is incorrect. Try again or cancel.");
    } finally {
      setImportLoading(false);
    }
  }, [rpc, importFilePath, importPassphrase, loadConfig, loadProjectPolicy, setProjects]);

  const handleRestorePlainEnv = useCallback(
    async (mode: "project" | "choose") => {
      if (!rpc || !activeProjectId || !activeProject) return;

      await withBusy(async () => {
        const destinationFolder =
          mode === "project" ? (activeProject.path ?? undefined) : await rpc.openFolderDialog();
        if (!destinationFolder) {
          if (mode === "project") {
            toast.error("This project is not linked to a folder path.");
          }
          return;
        }

        const preview = restoreScopeEntries
          .slice(0, 4)
          .map((scope) => `${scope.restoreFileName} <= ${getScopeLabel(scope)}`)
          .join("\n");
        const hiddenCount = Math.max(restoreScopeEntries.length - 4, 0);
        const confirmed = await rpc.showConfirmDialog({
          title: "Restore plaintext .env files?",
          message:
            "This writes readable environment files back to disk for offboarding, recovery, or migration.",
          detail: [
            `Destination: ${destinationFolder}`,
            `Files: ${restoreScopeEntries.length}`,
            preview || "No restore plan available.",
            hiddenCount > 0 ? `...plus ${hiddenCount} more scope file(s)` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });

        if (!confirmed) {
          return;
        }

        const result = await rpc.restorePlainEnv({
          projectId: activeProjectId,
          destinationFolder,
        });
        toast.success(
          `Restored ${result.files.length} plaintext env file${
            result.files.length === 1 ? "" : "s"
          } to ${result.destinationFolder}`,
        );
      });
    },
    [rpc, activeProjectId, activeProject, restoreScopeEntries, withBusy],
  );

  const handleSaveProjectDefaults = useCallback(
    async (
      field: "defaultScope" | "defaultCliVisibility" | "defaultAdapterVisibility",
      value: string,
    ) => {
      if (!rpc || !activeProjectId || !projectPolicy) {
        return;
      }

      await withBusy(async () => {
        const updated = await rpc.updateProjectPolicyDefaults({
          projectId: activeProjectId,
          defaultScope: field === "defaultScope" ? value : projectPolicy.defaultScope,
          defaultCliVisibility:
            field === "defaultCliVisibility"
              ? (value as "allow" | "deny")
              : projectPolicy.defaultCliVisibility,
          defaultAdapterVisibility:
            field === "defaultAdapterVisibility"
              ? (value as "allow" | "deny")
              : projectPolicy.defaultAdapterVisibility,
        });
        setProjectPolicy(updated);
        toast.success("Project policy defaults updated");
      });
    },
    [rpc, activeProjectId, projectPolicy, withBusy],
  );

  const handleScopePolicyChange = useCallback(
    async (
      scope: string,
      field: "cliVisibilityOverride" | "adapterVisibilityOverride",
      value: "inherit" | "allow" | "deny",
    ) => {
      if (!rpc || !activeProjectId || !projectPolicy) {
        return;
      }

      const current = projectPolicy.scopes.find((entry) => entry.scope === scope);
      if (!current) {
        return;
      }

      await withBusy(async () => {
        const updated = await rpc.updateScopePolicy({
          projectId: activeProjectId,
          scope,
          cliVisibilityOverride:
            field === "cliVisibilityOverride" ? value : current.cliVisibilityOverride,
          adapterVisibilityOverride:
            field === "adapterVisibilityOverride" ? value : current.adapterVisibilityOverride,
        });
        setProjectPolicy(updated);
        toast.success(`Updated policy for ${scope}`);
      });
    },
    [rpc, activeProjectId, projectPolicy, withBusy],
  );

  const handleExportSchema = useCallback(async () => {
    if (!rpc || !activeProjectId) {
      return;
    }

    await withBusy(async () => {
      const result = await rpc.exportProjectSchema({ projectId: activeProjectId });
      toast.success(
        `Wrote ${result.entries} schema entr${result.entries === 1 ? "y" : "ies"} to ${result.path}`,
      );
    });
  }, [rpc, activeProjectId, withBusy]);

  const handleImportSchema = useCallback(async () => {
    if (!rpc || !activeProjectId) {
      return;
    }

    await withBusy(async () => {
      let result: SchemaImportResultInfo | null = null;

      if (activeProject?.path) {
        try {
          result = await rpc.importProjectSchema({
            projectId: activeProjectId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.startsWith("No .env.schema file found at")) {
            throw error;
          }
        }
      }

      if (!result) {
        const folder = await rpc.openFolderDialog();
        if (!folder) {
          return;
        }

        result = await rpc.importProjectSchema({
          projectId: activeProjectId,
          filePath: folder,
        });
      }

      await Promise.all([loadSchema(), refreshProjectData(result.scope)]);

      const createdSuffix =
        result.created > 0
          ? `, seeded ${result.created} default value${result.created === 1 ? "" : "s"}`
          : "";
      const skippedSuffix =
        result.skipped > 0
          ? `, left ${result.skipped} field${result.skipped === 1 ? "" : "s"} without stored values`
          : "";
      toast.success(
        `Imported ${result.metadataApplied} schema entr${
          result.metadataApplied === 1 ? "y" : "ies"
        } into ${result.scope}${createdSuffix}${skippedSuffix}`,
      );

      for (const warning of result.warnings) {
        toast.warning(`${warning.key}: ${warning.message}`);
      }
    });
  }, [rpc, activeProject, activeProjectId, loadSchema, refreshProjectData, withBusy]);

  const handleStartSchemaEntry = useCallback(() => {
    setIsCreatingSchemaEntry(true);
    setSelectedSchemaId(null);
    setSchemaForm({
      ...EMPTY_SCHEMA_FORM,
      scope: activeEnvironment ?? "default",
    });
  }, [activeEnvironment]);

  const handleSaveSchema = useCallback(async () => {
    if (!rpc || !activeProjectId) {
      return;
    }

    const normalizedKey = schemaForm.key.trim();
    const normalizedScope = (schemaForm.scope.trim() || activeEnvironment || "default").trim();
    if (!normalizedKey) {
      toast.error("Schema key is required");
      return;
    }

    await withBusy(async () => {
      const payload = {
        projectId: activeProjectId,
        key: normalizedKey,
        scope: normalizedScope,
        typeName: schemaForm.typeName.trim() || null,
        typeParams: parseTypeParams(schemaForm.typeParams),
        sensitive: schemaForm.sensitive,
        required: schemaForm.required,
        description: normalizeNullable(schemaForm.description),
        example: normalizeNullable(schemaForm.example),
        defaultValue: normalizeNullable(schemaForm.defaultValue),
        docsUrls: parseDocs(schemaForm.docsUrls),
      };

      const updated =
        isCreatingSchemaEntry ||
        !selectedSchemaEntry?.hasStoredSchema ||
        !selectedSchemaEntry.schemaEntryId
          ? await rpc.createProjectSchemaEntry(payload)
          : await rpc.updateProjectSchemaEntry({
              ...payload,
              id: selectedSchemaEntry.schemaEntryId,
            });

      await loadSchema(updated.id);
      await refreshVisibleSecrets();
      await loadProjectPolicy();
      toast.success(
        isCreatingSchemaEntry
          ? `Created schema field ${updated.key}`
          : !selectedSchemaEntry?.hasStoredSchema
            ? `Created stored schema for ${updated.key}`
            : `Saved schema metadata for ${updated.key}`,
      );
    });
  }, [
    rpc,
    activeEnvironment,
    activeProjectId,
    isCreatingSchemaEntry,
    loadProjectPolicy,
    loadSchema,
    refreshVisibleSecrets,
    schemaForm,
    selectedSchemaEntry,
    withBusy,
  ]);

  const handleDeleteSchema = useCallback(async () => {
    if (
      !rpc ||
      !activeProjectId ||
      !selectedSchemaEntry?.hasStoredSchema ||
      !selectedSchemaEntry.schemaEntryId
    ) {
      return;
    }

    const schemaEntryId = selectedSchemaEntry.schemaEntryId;
    const preferredSelectionId = selectedSchemaEntry.secretId ?? undefined;

    await withBusy(async () => {
      await rpc.removeProjectSchemaEntry({
        projectId: activeProjectId,
        schemaEntryId,
      });
      await loadSchema(preferredSelectionId);
      await refreshVisibleSecrets();
      await loadProjectPolicy();
      toast.success(
        selectedSchemaEntry.hasStoredValue
          ? `Removed stored schema for ${selectedSchemaEntry.key}`
          : `Deleted schema-only field ${selectedSchemaEntry.key}`,
      );
    });
  }, [
    rpc,
    activeProjectId,
    loadProjectPolicy,
    loadSchema,
    refreshVisibleSecrets,
    selectedSchemaEntry,
    withBusy,
  ]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-[64rem] gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-[0_12px_40px_-4px_rgba(0,0,0,0.2),0_4px_16px_-2px_rgba(0,0,0,0.08)] sm:max-w-[64rem]"
        >
          <div className="flex h-[46rem] max-h-[85vh] min-h-[28rem] flex-col">
            {/* Title bar */}
            <div className="relative shrink-0 border-b border-border/30 bg-muted/20 py-2.5">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <ModalTrafficLights onClose={() => setOpen(false)} />
              </div>
              <div className="text-center">
                <DialogTitle className="text-[13px] font-medium tracking-tight">
                  Project Tools
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-muted-foreground">
                  {activeProject ? activeProject.name : "No project selected"}
                </DialogDescription>
              </div>
            </div>

            {/* Tabs */}
            <div className="shrink-0 border-b border-border/40 px-6 py-2">
              <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
                <TabsList>
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                  <TabsTrigger value="schema">Schema</TabsTrigger>
                  <TabsTrigger value="policy">Policy</TabsTrigger>
                  <TabsTrigger value="runtime">Runtime</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Tab content */}
            <Tabs
              value={view}
              onValueChange={(value) => setView(value as typeof view)}
              className="flex-1 overflow-hidden"
            >
              {/* ── Transfer ── */}
              <TabsContent value="transfer" className="h-full overflow-y-auto px-6 py-6">
                <div className="space-y-8">
                  <ToolSection
                    title="Encrypted Transfer"
                    description="Export and import using the .cloaked backup format."
                  >
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="export-passphrase" className="text-xs">
                          Export passphrase
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="export-passphrase"
                            type="password"
                            placeholder="Passphrase for encrypted export"
                            value={exportPassphrase}
                            onChange={(event) => setExportPassphrase(event.target.value)}
                            disabled={desktopSensitiveUnavailable}
                            className="h-9"
                          />
                          <Button
                            size="sm"
                            onClick={() => void handleEncryptedExport()}
                            disabled={loading || desktopSensitiveUnavailable}
                          >
                            <Download className="mr-1.5 size-3.5" />
                            Export
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Import encrypted backup</Label>
                        <div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handlePickImportFile()}
                            disabled={loading || desktopSensitiveUnavailable}
                          >
                            <Upload className="mr-1.5 size-3.5" />
                            Import .cloaked backup
                          </Button>
                        </div>
                      </div>

                      {desktopSensitiveUnavailable ? (
                        <p className="text-xs text-destructive">
                          Unavailable while auth mode is set to passphrase.
                        </p>
                      ) : null}
                    </div>
                  </ToolSection>

                  <ToolSection
                    title="Restore .env Files"
                    description="Write readable env files back to disk for offboarding or migration."
                  >
                    <div className="space-y-4">
                      <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/8 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          This is the only place in the app that creates plaintext env files.
                        </span>
                      </div>

                      <div className="rounded-xl bg-muted/30 px-4 py-3">
                        <p className="text-sm font-medium">
                          {activeProject ? activeProject.name : "No project selected"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {activeProject
                            ? restoreScopeEntries.length > 0
                              ? `${restoreScopeEntries.length} scope file${restoreScopeEntries.length === 1 ? "" : "s"} ready to restore.`
                              : "No stored secrets to restore."
                            : "Select a project first."}
                        </p>
                      </div>

                      {restoreScopeEntries.length > 0 ? (
                        <div className="space-y-1.5">
                          {restoreScopeEntries.map((scope) => (
                            <div
                              key={scope.scope}
                              className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <span className="font-mono text-xs font-medium">
                                  {scope.restoreFileName}
                                </span>
                                <span className="ml-2 text-[11px] text-muted-foreground">
                                  {getScopeLabel(scope)} &middot; {scope.secretCount} secret
                                  {scope.secretCount === 1 ? "" : "s"}
                                </span>
                              </div>
                              {scope.isDefaultScope ? (
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  default
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleRestorePlainEnv("project")}
                          disabled={
                            loading ||
                            !activeProjectId ||
                            !activeProject?.path ||
                            desktopSensitiveUnavailable ||
                            restoreScopeEntries.length === 0
                          }
                        >
                          <FileText className="mr-1.5 size-3.5" />
                          Restore Into Project
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleRestorePlainEnv("choose")}
                          disabled={
                            loading ||
                            !activeProjectId ||
                            desktopSensitiveUnavailable ||
                            restoreScopeEntries.length === 0
                          }
                        >
                          <FolderOpen className="mr-1.5 size-3.5" />
                          Choose Folder
                        </Button>
                      </div>
                    </div>
                  </ToolSection>
                </div>
              </TabsContent>

              {/* ── Schema ── */}
              <TabsContent value="schema" className="h-full overflow-hidden px-6 py-6">
                {!activeProject ? (
                  <div className="rounded-xl bg-muted/30 px-6 py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      Select a project to manage its schema.
                    </p>
                  </div>
                ) : (
                  <div className="grid h-full gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
                    {/* Schema list */}
                    <div className="flex flex-col overflow-hidden rounded-xl border border-border/40">
                      <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
                        <p className="truncate text-sm font-medium">{activeProject.name}</p>
                        <div className="flex gap-1">
                          <Button
                            size="xs"
                            onClick={handleStartSchemaEntry}
                            disabled={loading}
                            title="New field"
                          >
                            <Plus className="size-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void handleImportSchema()}
                            disabled={loading}
                            title="Import schema"
                          >
                            <Upload className="size-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void handleExportSchema()}
                            disabled={loading || schemaEntries.length === 0}
                            title="Export schema"
                          >
                            <Download className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
                        {schemaEntries.length === 0 ? (
                          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                            No schema fields yet
                          </div>
                        ) : (
                          schemaEntries.map((entry) => (
                            <button
                              key={entry.id}
                              ref={(element) => {
                                if (element) {
                                  schemaItemRefs.current.set(entry.id, element);
                                } else {
                                  schemaItemRefs.current.delete(entry.id);
                                }
                              }}
                              type="button"
                              onClick={() => {
                                setIsCreatingSchemaEntry(false);
                                setSelectedSchemaId(entry.id);
                              }}
                              className={cn(
                                "w-full rounded-lg px-3 py-2 text-left transition",
                                entry.id === selectedSchemaId && !isCreatingSchemaEntry
                                  ? "bg-foreground/8"
                                  : "hover:bg-muted/40",
                              )}
                            >
                              <p className="truncate font-mono text-xs font-medium">{entry.key}</p>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {entry.scope}
                                {entry.typeName ? ` \u00b7 ${entry.typeName}` : ""}
                                {!entry.hasStoredValue ? " \u00b7 schema only" : ""}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Schema editor */}
                    <div className="overflow-y-auto">
                      {!selectedSchemaEntry && !isCreatingSchemaEntry ? (
                        <div className="rounded-xl bg-muted/30 px-6 py-12 text-center">
                          <p className="text-sm text-muted-foreground">
                            Select a field or create a new one.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <h3 className="text-sm font-medium">
                              {isCreatingSchemaEntry
                                ? "New Schema Field"
                                : selectedSchemaEntry
                                  ? selectedSchemaEntry.key
                                  : "Schema Metadata"}
                            </h3>
                            {selectedSchemaEntry ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {selectedSchemaEntry.hasStoredValue
                                  ? "Stored value"
                                  : "Schema only"}
                                {selectedSchemaEntry.hasStoredSchema
                                  ? " \u00b7 stored schema"
                                  : " \u00b7 derived"}
                              </p>
                            ) : null}
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-key" className="text-xs">
                                Key
                              </Label>
                              <Input
                                id="schema-key"
                                placeholder="API_KEY"
                                value={schemaForm.key}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    key: event.target.value,
                                  }))
                                }
                                disabled={
                                  !isCreatingSchemaEntry &&
                                  Boolean(selectedSchemaEntry?.hasStoredValue)
                                }
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-scope" className="text-xs">
                                Scope
                              </Label>
                              <Input
                                id="schema-scope"
                                placeholder="default"
                                value={schemaForm.scope}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    scope: event.target.value,
                                  }))
                                }
                                disabled={
                                  !isCreatingSchemaEntry &&
                                  Boolean(selectedSchemaEntry?.hasStoredValue)
                                }
                                className="h-9"
                              />
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-type" className="text-xs">
                                Type
                              </Label>
                              <Input
                                id="schema-type"
                                placeholder="string, url, port, enum"
                                value={schemaForm.typeName}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    typeName: event.target.value,
                                  }))
                                }
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-type-params" className="text-xs">
                                Type params
                              </Label>
                              <Input
                                id="schema-type-params"
                                placeholder="minLength=8, startsWith=sk_"
                                value={schemaForm.typeParams}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    typeParams: event.target.value,
                                  }))
                                }
                                className="h-9"
                              />
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <ToggleRow
                              label="Sensitive"
                              checked={schemaForm.sensitive}
                              onCheckedChange={(checked) =>
                                setSchemaForm((current) => ({ ...current, sensitive: checked }))
                              }
                            />
                            <ToggleRow
                              label="Required"
                              checked={schemaForm.required}
                              onCheckedChange={(checked) =>
                                setSchemaForm((current) => ({ ...current, required: checked }))
                              }
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="schema-description" className="text-xs">
                              Description
                            </Label>
                            <Textarea
                              id="schema-description"
                              rows={2}
                              placeholder="What this variable is for"
                              value={schemaForm.description}
                              onChange={(event) =>
                                setSchemaForm((current) => ({
                                  ...current,
                                  description: event.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-example" className="text-xs">
                                Example
                              </Label>
                              <Input
                                id="schema-example"
                                placeholder="postgres://db.example"
                                value={schemaForm.example}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    example: event.target.value,
                                  }))
                                }
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="schema-default" className="text-xs">
                                Default value
                              </Label>
                              <Input
                                id="schema-default"
                                placeholder="Used when exporting schema"
                                value={schemaForm.defaultValue}
                                onChange={(event) =>
                                  setSchemaForm((current) => ({
                                    ...current,
                                    defaultValue: event.target.value,
                                  }))
                                }
                                className="h-9"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="schema-docs" className="text-xs">
                              Docs URLs
                            </Label>
                            <Textarea
                              id="schema-docs"
                              rows={2}
                              placeholder="One URL per line"
                              value={schemaForm.docsUrls}
                              onChange={(event) =>
                                setSchemaForm((current) => ({
                                  ...current,
                                  docsUrls: event.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            {selectedSchemaEntry?.hasStoredSchema ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleDeleteSchema()}
                                disabled={loading}
                              >
                                <Trash2 className="mr-1.5 size-3.5" />
                                {selectedSchemaEntry.hasStoredValue
                                  ? "Remove Schema"
                                  : "Delete Field"}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              onClick={() => void handleSaveSchema()}
                              disabled={loading}
                            >
                              {isCreatingSchemaEntry
                                ? "Create Field"
                                : !selectedSchemaEntry?.hasStoredSchema
                                  ? "Create Stored Schema"
                                  : "Save Metadata"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Policy ── */}
              <TabsContent value="policy" className="h-full overflow-y-auto px-6 py-6">
                <div className="space-y-8">
                  <ToolSection title="Project Defaults">
                    {!activeProject ? (
                      <p className="text-xs text-muted-foreground">
                        Select a project to configure policy.
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Default scope</Label>
                          <Select
                            value={projectPolicy?.defaultScope ?? "default"}
                            onValueChange={(value) =>
                              void handleSaveProjectDefaults("defaultScope", value)
                            }
                            disabled={loading || !projectPolicy}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Choose a scope" />
                            </SelectTrigger>
                            <SelectContent>
                              {(projectPolicy?.scopes ?? []).map((scope) => (
                                <SelectItem key={scope.scope} value={scope.scope}>
                                  {getScopeLabel(scope)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">CLI default</Label>
                          <Select
                            value={projectPolicy?.defaultCliVisibility ?? "allow"}
                            onValueChange={(value) =>
                              void handleSaveProjectDefaults("defaultCliVisibility", value)
                            }
                            disabled={loading || !projectPolicy}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="allow">Allow</SelectItem>
                              <SelectItem value="deny">Block</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Adapter default</Label>
                          <Select
                            value={projectPolicy?.defaultAdapterVisibility ?? "allow"}
                            onValueChange={(value) =>
                              void handleSaveProjectDefaults("defaultAdapterVisibility", value)
                            }
                            disabled={loading || !projectPolicy}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="allow">Allow</SelectItem>
                              <SelectItem value="deny">Block</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </ToolSection>

                  <ToolSection title="Scope Visibility">
                    {!projectPolicy ? (
                      <p className="text-xs text-muted-foreground">
                        Select a project to manage scoped visibility.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {projectPolicy.scopes.map((scope) => (
                          <div
                            key={scope.scope}
                            className={cn(
                              "rounded-xl px-4 py-3",
                              scope.isDefaultScope
                                ? "bg-emerald-500/6 ring-1 ring-emerald-500/20"
                                : "bg-muted/25",
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-medium">
                                    {getScopeLabel(scope)}
                                  </span>
                                  {scope.isDefaultScope ? (
                                    <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                      default
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {scope.secretCount} secret{scope.secretCount === 1 ? "" : "s"}
                                  {scope.sourceFile ? ` \u00b7 from ${scope.sourceFile}` : ""}
                                </p>
                              </div>

                              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[18rem]">
                                <div className="space-y-1">
                                  <Label className="text-[11px] text-muted-foreground">CLI</Label>
                                  <Select
                                    value={scope.cliVisibilityOverride}
                                    onValueChange={(value) =>
                                      void handleScopePolicyChange(
                                        scope.scope,
                                        "cliVisibilityOverride",
                                        value as "inherit" | "allow" | "deny",
                                      )
                                    }
                                    disabled={loading}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="inherit">
                                        Inherit ({scope.cliVisibility})
                                      </SelectItem>
                                      <SelectItem value="allow">Allow</SelectItem>
                                      <SelectItem value="deny">Block</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[11px] text-muted-foreground">
                                    Adapter
                                  </Label>
                                  <Select
                                    value={scope.adapterVisibilityOverride}
                                    onValueChange={(value) =>
                                      void handleScopePolicyChange(
                                        scope.scope,
                                        "adapterVisibilityOverride",
                                        value as "inherit" | "allow" | "deny",
                                      )
                                    }
                                    disabled={loading}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="inherit">
                                        Inherit ({scope.adapterVisibility})
                                      </SelectItem>
                                      <SelectItem value="allow">Allow</SelectItem>
                                      <SelectItem value="deny">Block</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ToolSection>
                </div>
              </TabsContent>

              {/* ── Runtime ── */}
              <TabsContent value="runtime" className="h-full overflow-y-auto px-6 py-6">
                <div className="space-y-8">
                  <ToolSection title="Provider Status">
                    <div className="space-y-4">
                      <div className="rounded-xl bg-muted/30 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 text-xs font-medium",
                              providerDiagnostics?.reachable
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                providerDiagnostics?.reachable
                                  ? "bg-emerald-500"
                                  : "bg-muted-foreground/40",
                              )}
                            />
                            {providerDiagnostics?.reachable ? "Online" : "Unknown"}
                          </span>
                          {providerDiagnostics ? (
                            <>
                              <span className="text-border">&middot;</span>
                              <span className="text-xs text-muted-foreground">
                                {providerDiagnostics.approvalMode === "terminal"
                                  ? "Terminal prompt"
                                  : "Native dialog"}
                              </span>
                              <span className="text-border">&middot;</span>
                              <span className="text-xs text-muted-foreground">
                                {providerDiagnostics.transport}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <FactRow
                          label="Endpoint"
                          value={providerDiagnostics?.endpoint ?? "Unavailable"}
                          mono
                        />
                        <FactRow
                          label="Auth mode"
                          value={providerDiagnostics?.authMode ?? config.authMode}
                        />
                        <FactRow
                          label="Desktop-sensitive"
                          value={
                            !providerDiagnostics
                              ? "Unknown"
                              : providerDiagnostics.desktopSensitiveAvailable
                                ? "Available"
                                : "Blocked"
                          }
                        />
                        <FactRow
                          label="Session window"
                          value={
                            providerDiagnostics && providerDiagnostics.providerSessionTtlMinutes > 0
                              ? `${providerDiagnostics.providerSessionTtlMinutes}m`
                              : "Off"
                          }
                        />
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void loadProviderDiagnostics()}
                        disabled={loading}
                      >
                        <RefreshCcw className="mr-1.5 size-3.5" />
                        Refresh
                      </Button>
                    </div>
                  </ToolSection>

                  <ToolSection title="Live Session Leases">
                    {!providerDiagnostics || providerDiagnostics.activeSessions.length === 0 ? (
                      <div className="rounded-xl bg-muted/30 px-6 py-10 text-center">
                        <p className="text-sm text-muted-foreground">No live provider sessions</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            {providerDiagnostics.activeSessions.length} active lease
                            {providerDiagnostics.activeSessions.length === 1 ? "" : "s"}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleExpireAllProviderSessions()}
                            disabled={loading}
                          >
                            Expire All
                          </Button>
                        </div>

                        {providerDiagnostics.activeSessions.map((session) => (
                          <div key={session.id} className="rounded-xl bg-muted/25 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">
                                  {session.projectName}
                                  <span className="ml-2 font-normal text-muted-foreground">
                                    {session.scope}
                                  </span>
                                </p>
                                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                  {session.commandPreview}
                                </p>
                                <p className="mt-1 text-[11px] text-muted-foreground/70">
                                  {session.action === "run" ? "Process launch" : "Env resolve"}
                                  {" \u00b7 "}
                                  {session.requesterLabel}
                                  {" \u00b7 "}
                                  reused {session.reuseCount}x{" \u00b7 "}
                                  expires {formatExpiry(session.expiresAt)}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="xs"
                                className="shrink-0 text-destructive hover:text-destructive"
                                onClick={() => void handleExpireProviderSession(session.id)}
                                disabled={loading}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ToolSection>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import passphrase dialog ── */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setImportDialogOpen(false);
            setImportPassphrase("");
            setImportFilePath(null);
            setImportError(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md gap-0 overflow-hidden border-border/60 bg-background p-0 shadow-[0_12px_40px_-4px_rgba(0,0,0,0.2),0_4px_16px_-2px_rgba(0,0,0,0.08)] sm:max-w-md"
        >
          <div className="flex flex-col">
            <div className="relative shrink-0 border-b border-border/30 bg-muted/20 py-2.5">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <ModalTrafficLights onClose={() => setImportDialogOpen(false)} />
              </div>
              <div className="text-center">
                <DialogTitle className="text-[13px] font-medium tracking-tight">
                  Import Encrypted Backup
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-muted-foreground">
                  {importFilePath?.split("/").pop() ?? ""}
                </DialogDescription>
              </div>
            </div>

            <form
              className="space-y-4 px-6 py-5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleImportCloaked();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="import-dialog-passphrase" className="text-xs">
                  Passphrase
                </Label>
                <Input
                  id="import-dialog-passphrase"
                  type="password"
                  autoFocus
                  placeholder="Enter the passphrase for this backup"
                  value={importPassphrase}
                  onChange={(event) => {
                    setImportPassphrase(event.target.value);
                    if (importError) setImportError(null);
                  }}
                  className="h-9"
                />
                {importError ? <p className="text-xs text-destructive">{importError}</p> : null}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setImportDialogOpen(false)}
                  disabled={importLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={importLoading || !importPassphrase.trim()}
                >
                  {importLoading ? "Importing\u2026" : "Import"}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Section wrapper ── */

function ToolSection(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{props.title}</h3>
        {props.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

/* ── Toggle row for schema form ── */

function ToggleRow(props: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/25 px-3 py-2.5">
      <span className="text-sm">{props.label}</span>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  );
}

/* ── Key-value fact row ── */

function FactRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{props.label}</p>
      <p className={cn("mt-0.5 text-sm", props.mono && "break-all font-mono text-xs")}>
        {props.value}
      </p>
    </div>
  );
}

/* ── Helpers ── */

function formatExpiry(timestamp: number): string {
  const deltaMs = Math.max(timestamp - Date.now(), 0);
  const minutes = Math.ceil(deltaMs / 60_000);
  return `${new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${minutes}m left)`;
}

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDocs(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTypeParams(value: string): Record<string, string> | null {
  const params = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, part) => {
      const [rawKey, ...rawValueParts] = part.split("=");
      const key = rawKey?.trim();
      const parsedValue = rawValueParts.join("=").trim();
      if (!key) {
        return accumulator;
      }

      accumulator[key] = parsedValue || "true";
      return accumulator;
    }, {});

  return Object.keys(params).length > 0 ? params : null;
}

function formatTypeParams(params: Record<string, string> | null): string {
  if (!params || Object.keys(params).length === 0) {
    return "";
  }

  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}
