import type { ConfigInfo, EnvFileInfo } from "@shared/types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  EnvImportDialog,
  type EnvImportDialogPhase,
  type EnvImportDialogState,
} from "@/components/projects/env-import-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { type CliInstallStatusInfo, useRPC } from "@/hooks/use-rpc";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const INITIAL_CONFIG: ConfigInfo = {
  backupPath: null,
  authMode: "keychain",
  autoBackup: true,
  onboardingCompleted: false,
  autoBackupPassphraseConfigured: false,
  launchAtLogin: false,
  providerSessionTtlMinutes: 0,
  desktopAppearance: "dock_and_menu",
};

type OnboardingStep = "backup" | "security" | "cli" | "project" | "finish";

const STEP_ORDER: OnboardingStep[] = ["backup", "security", "cli", "project", "finish"];

type ProjectSetupState = {
  projectId: string | null;
  projectName: string | null;
  folderPath: string | null;
  envFiles: EnvFileInfo[];
  importedFiles: Set<string>;
  originalsDeleted: boolean;
  importDialogOpen: boolean;
  importDialogPhase: EnvImportDialogPhase;
};

const EMPTY_PROJECT_SETUP: ProjectSetupState = {
  projectId: null,
  projectName: null,
  folderPath: null,
  envFiles: [],
  importedFiles: new Set(),
  originalsDeleted: false,
  importDialogOpen: false,
  importDialogPhase: "preview",
};

export function FirstLaunchOnboarding() {
  const rpc = useRPC();
  const setProjects = useAppStore((s) => s.setProjects);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const setEnvironments = useAppStore((s) => s.setEnvironments);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const setSecrets = useAppStore((s) => s.setSecrets);

  const [config, setConfig] = useState<ConfigInfo>(INITIAL_CONFIG);
  const [projectCount, setProjectCount] = useState(0);
  const [cliStatus, setCliStatus] = useState<CliInstallStatusInfo | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] = useState("");
  const [showBackupPassphrase, setShowBackupPassphrase] = useState(false);
  const [projectSetup, setProjectSetup] = useState<ProjectSetupState>(EMPTY_PROJECT_SETUP);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState<OnboardingStep>("backup");
  const [stepWasChosen, setStepWasChosen] = useState(false);
  const [busy, setBusy] = useState<
    null | "backup" | "passphrase" | "cli" | "project" | "cleanup" | "finish"
  >(null);

  /* ------------------------------------------------------------------ */
  /*  Data loading                                                       */
  /* ------------------------------------------------------------------ */

  const refreshSetupState = useCallback(async () => {
    if (!rpc) {
      return;
    }

    const [nextConfig, projects, nextCliStatus] = await Promise.all([
      rpc.getConfig(),
      rpc.listProjects(),
      rpc.getCliInstallStatus(),
    ]);

    setConfig(nextConfig);
    setProjectCount(projects.length);
    setProjects(projects);
    setCliStatus(nextCliStatus);
  }, [rpc, setProjects]);

  useEffect(() => {
    if (!rpc) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void refreshSetupState()
      .catch((error) => {
        if (!cancelled) {
          console.error("[CloakEnv] Failed to load onboarding state:", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, refreshSetupState]);

  useEffect(() => {
    if (!rpc || loading || config.onboardingCompleted) {
      return;
    }

    if (!config.backupPath || projectCount === 0 || projectSetup.projectId) {
      return;
    }

    void rpc
      .setConfig({ key: "onboardingCompleted", value: "true" })
      .then(() => refreshSetupState())
      .catch((error) => {
        console.error("[CloakEnv] Failed to mark onboarding complete:", error);
      });
  }, [
    config.backupPath,
    config.onboardingCompleted,
    loading,
    projectCount,
    projectSetup.projectId,
    refreshSetupState,
    rpc,
  ]);

  /* ------------------------------------------------------------------ */
  /*  Derived state                                                      */
  /* ------------------------------------------------------------------ */

  const needsOnboarding = useMemo(
    () =>
      !loading &&
      !config.onboardingCompleted &&
      (projectSetup.projectId !== null || !config.backupPath || projectCount === 0),
    [config.backupPath, config.onboardingCompleted, loading, projectCount, projectSetup.projectId],
  );

  const backupPassphraseMismatch =
    backupPassphraseConfirmation.length > 0 && backupPassphrase !== backupPassphraseConfirmation;
  const allEnvFilesImported =
    projectSetup.envFiles.length > 0 &&
    projectSetup.envFiles.every((file) => projectSetup.importedFiles.has(file.filePath));
  const importedFileCount = projectSetup.importedFiles.size;
  const backupReady = Boolean(config.backupPath);
  const cliReady = Boolean(
    cliStatus?.installed && cliStatus.pathConfigured && (!cliStatus.managed || cliStatus.upToDate),
  );
  const cliBundled = Boolean(cliStatus?.bundled);

  const recommendedStep = useMemo<OnboardingStep>(() => {
    if (!backupReady) {
      return "backup";
    }

    if (!config.autoBackupPassphraseConfigured) {
      return "security";
    }

    if (cliBundled && !cliReady) {
      return "cli";
    }

    if (projectSetup.projectId || projectCount === 0) {
      return "project";
    }

    return "finish";
  }, [
    backupReady,
    cliBundled,
    cliReady,
    config.autoBackupPassphraseConfigured,
    projectCount,
    projectSetup.projectId,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!stepWasChosen) {
      setActiveStep(recommendedStep);
      return;
    }

    if (!backupReady && activeStep === "finish") {
      setActiveStep("backup");
    }
  }, [activeStep, backupReady, loading, recommendedStep, stepWasChosen]);

  /* ------------------------------------------------------------------ */
  /*  Navigation                                                         */
  /* ------------------------------------------------------------------ */

  const visibleSteps = useMemo(
    () => STEP_ORDER.filter((step) => step !== "cli" || cliBundled),
    [cliBundled],
  );

  const activeVisibleIndex = visibleSteps.indexOf(activeStep);
  const previousVisibleStep = activeVisibleIndex > 0 ? visibleSteps[activeVisibleIndex - 1] : null;
  const nextVisibleStep =
    activeVisibleIndex < visibleSteps.length - 1 ? visibleSteps[activeVisibleIndex + 1] : null;

  const isStepDone = (step: OnboardingStep): boolean => {
    switch (step) {
      case "backup":
        return backupReady;
      case "security":
        return config.autoBackupPassphraseConfigured;
      case "cli":
        return cliReady;
      case "project":
        return projectCount > 0;
      case "finish":
        return backupReady;
    }
  };

  const projectImportDialogState = useMemo<EnvImportDialogState>(
    () => ({
      open: projectSetup.importDialogOpen,
      projectId: projectSetup.projectId,
      projectName: projectSetup.projectName ?? "",
      folderPath: projectSetup.folderPath ?? "",
      envFiles: projectSetup.envFiles,
      importedFiles: projectSetup.importedFiles,
      phase: projectSetup.importDialogPhase,
    }),
    [projectSetup],
  );

  const navigateToStep = useCallback((step: OnboardingStep) => {
    setStepWasChosen(true);
    setActiveStep(step);
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Handlers                                                           */
  /* ------------------------------------------------------------------ */

  const syncActiveProject = useCallback(
    async (projectId: string) => {
      if (!rpc) {
        return;
      }

      const [projects, environments] = await Promise.all([
        rpc.listProjects(),
        rpc.listEnvironments({ projectId }),
      ]);

      setProjects(projects);
      setActiveProject(projectId);
      setEnvironments(environments);

      const nextEnvironment = environments[0]?.name ?? null;
      setActiveEnvironment(nextEnvironment);
      setSecrets(
        nextEnvironment ? await rpc.getSecrets({ projectId, environment: nextEnvironment }) : [],
      );
    },
    [rpc, setActiveEnvironment, setActiveProject, setEnvironments, setProjects, setSecrets],
  );

  const handleChooseBackupPath = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setBusy("backup");
    try {
      const path = await rpc.openBackupFolderDialog();
      if (!path) {
        return;
      }

      await rpc.setConfig({ key: "backupPath", value: path });
      await refreshSetupState();
      toast.success("Backup location saved");
    } catch (error) {
      console.error("[CloakEnv] Failed to set backup path:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save backup path");
    } finally {
      setBusy(null);
    }
  }, [refreshSetupState, rpc]);

  const handleSaveBackupPassphrase = useCallback(async () => {
    if (!rpc || !backupPassphrase.trim()) {
      return;
    }

    if (backupPassphrase !== backupPassphraseConfirmation) {
      toast.error("Backup passphrase entries must match.");
      return;
    }

    setBusy("passphrase");
    try {
      await rpc.setAutoBackupPassphrase({ passphrase: backupPassphrase.trim() });
      setBackupPassphrase("");
      setBackupPassphraseConfirmation("");
      await refreshSetupState();
      toast.success("Backup passphrase saved");
    } catch (error) {
      console.error("[CloakEnv] Failed to save backup passphrase:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save backup passphrase");
    } finally {
      setBusy(null);
    }
  }, [backupPassphrase, backupPassphraseConfirmation, refreshSetupState, rpc]);

  const handleInstallCli = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setBusy("cli");
    try {
      const result = await rpc.installCliCommand();
      await refreshSetupState();
      toast.success(
        result.requiresRestart
          ? result.updated
            ? "CLI updated. Open a new terminal to use cloakenv."
            : "CLI installed. Open a new terminal to use cloakenv."
          : result.updated
            ? "CLI updated and ready."
            : "CLI installed and ready.",
      );
    } catch (error) {
      console.error("[CloakEnv] Failed to install CLI:", error);
      toast.error(error instanceof Error ? error.message : "Failed to install CLI");
    } finally {
      setBusy(null);
    }
  }, [refreshSetupState, rpc]);

  const handleOpenProjectFolder = useCallback(async () => {
    if (!rpc) {
      return;
    }

    setBusy("project");
    try {
      const folderPath = await rpc.openFolderDialog();
      if (!folderPath) {
        return;
      }

      const projectName = deriveProjectName(folderPath);
      const project = await rpc.createProject({ name: projectName, path: folderPath });
      const envFiles = await rpc.scanEnvFiles({ folderPath });

      setProjectSetup({
        projectId: project.id,
        projectName: project.name,
        folderPath,
        envFiles,
        importedFiles: new Set(),
        originalsDeleted: false,
        importDialogOpen: envFiles.length > 0,
        importDialogPhase: "preview",
      });

      await syncActiveProject(project.id);
      await refreshSetupState();

      toast.success(
        envFiles.length > 0
          ? `Project "${project.name}" added. ${envFiles.length} dotenv file${envFiles.length === 1 ? "" : "s"} ready to review.`
          : `Project "${project.name}" added.`,
      );
    } catch (error) {
      console.error("[CloakEnv] Failed to add onboarding project:", error);
      toast.error(error instanceof Error ? error.message : "Failed to add project");
    } finally {
      setBusy(null);
    }
  }, [refreshSetupState, rpc, syncActiveProject]);

  const handleImportEnvFile = useCallback(
    async (filePath: string) => {
      if (!rpc || !projectSetup.projectId || projectSetup.importedFiles.has(filePath)) {
        return;
      }

      const result = await rpc.importEnvFile({ projectId: projectSetup.projectId, filePath });

      setProjectSetup((current) => ({
        ...current,
        importedFiles: new Set([...current.importedFiles, filePath]),
      }));

      const schemaSuffix =
        result.schemaMatched > 0 ? ` and matched ${result.schemaMatched} schema entries` : "";
      toast.success(`Imported ${result.imported} secrets${schemaSuffix}`);
      for (const warning of result.warnings) {
        toast.warning(`${warning.key}: ${warning.message}`);
      }
    },
    [projectSetup.importedFiles, projectSetup.projectId, rpc],
  );

  const handleImportAllEnvFiles = useCallback(async () => {
    if (!rpc || !projectSetup.projectId) {
      return;
    }

    setBusy("project");
    try {
      setProjectSetup((current) => ({
        ...current,
        importDialogOpen: true,
        importDialogPhase: "importing",
      }));

      for (const file of projectSetup.envFiles) {
        if (!projectSetup.importedFiles.has(file.filePath)) {
          await handleImportEnvFile(file.filePath);
        }
      }

      await syncActiveProject(projectSetup.projectId);
      await refreshSetupState();
      setProjectSetup((current) => ({
        ...current,
        importDialogOpen: true,
        importDialogPhase: "delete-prompt",
      }));
    } catch (error) {
      console.error("[CloakEnv] Failed to import dotenv files:", error);
      toast.error(error instanceof Error ? error.message : "Failed to import dotenv files");
      setProjectSetup((current) => ({
        ...current,
        importDialogOpen: true,
        importDialogPhase: "preview",
      }));
    } finally {
      setBusy(null);
    }
  }, [
    handleImportEnvFile,
    projectSetup.importedFiles,
    projectSetup.envFiles,
    projectSetup.projectId,
    refreshSetupState,
    rpc,
    syncActiveProject,
  ]);

  const handleDeleteOriginals = useCallback(async () => {
    if (!rpc || projectSetup.envFiles.length === 0) {
      return;
    }

    setBusy("cleanup");
    try {
      for (const file of projectSetup.envFiles) {
        await rpc.deleteFile({ filePath: file.filePath });
      }

      setProjectSetup((current) => ({
        ...current,
        originalsDeleted: true,
        importDialogOpen: false,
        importDialogPhase: "done",
      }));
      toast.success("Original dotenv files moved to trash");
    } catch (error) {
      console.error("[CloakEnv] Failed to delete original dotenv files:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to move original files to trash",
      );
    } finally {
      setBusy(null);
    }
  }, [projectSetup.envFiles, rpc]);

  const handleProjectImportDialogOpenChange = useCallback((open: boolean) => {
    setProjectSetup((current) => ({
      ...current,
      importDialogOpen: open,
    }));
  }, []);

  const handleFinish = useCallback(async () => {
    if (!rpc || !config.backupPath) {
      return;
    }

    setBusy("finish");
    try {
      await rpc.setConfig({ key: "onboardingCompleted", value: "true" });
      await refreshSetupState();
    } catch (error) {
      console.error("[CloakEnv] Failed to complete onboarding:", error);
      toast.error(error instanceof Error ? error.message : "Failed to finish setup");
    } finally {
      setBusy(null);
    }
  }, [config.backupPath, refreshSetupState, rpc]);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  if (!needsOnboarding) {
    return null;
  }

  const currentStepDone = isStepDone(activeStep);
  const isOptional = activeStep !== "backup" && activeStep !== "finish";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/88 backdrop-blur-xl">
      <div className="w-full max-w-[520px] px-4">
        {/* Progress pills */}
        <div className="mb-8 flex items-center justify-center gap-1.5">
          {visibleSteps.map((step, i) => (
            <div
              key={step}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                i === activeVisibleIndex
                  ? "w-8 bg-foreground"
                  : isStepDone(step)
                    ? "w-1.5 bg-foreground/30"
                    : "w-1.5 bg-foreground/15",
              )}
            />
          ))}
        </div>

        {/* Step card */}
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_24px_80px_-12px_rgba(0,0,0,0.12)] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.4)]">
          <div className="px-8 pt-10 pb-8">
            {/* ── Backup ── */}
            {activeStep === "backup" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <FolderOpen className="h-5 w-5 text-foreground" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">Choose a backup folder</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  CloakEnv stores encrypted vault snapshots here. Pick a stable location you
                  won&rsquo;t accidentally delete.
                </p>

                {config.backupPath ? (
                  <div className="mt-5 w-full rounded-xl bg-muted/50 px-4 py-3">
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {config.backupPath}
                    </p>
                  </div>
                ) : null}

                <Button
                  onClick={handleChooseBackupPath}
                  disabled={busy !== null}
                  className="mt-5 rounded-xl px-5"
                >
                  <FolderOpen className="h-4 w-4" />
                  {busy === "backup"
                    ? "Opening..."
                    : config.backupPath
                      ? "Change folder"
                      : "Choose folder"}
                </Button>
              </div>
            )}

            {/* ── Security ── */}
            {activeStep === "security" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <KeyRound className="h-5 w-5 text-foreground" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">
                  Set a backup passphrase
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Enables unattended backup encryption. You can always set this later in
                  Preferences.
                </p>

                {config.autoBackupPassphraseConfigured ? (
                  <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Passphrase configured
                  </div>
                ) : (
                  <div className="mt-6 w-full space-y-3 text-left">
                    <div className="space-y-1.5">
                      <Label htmlFor="onboarding-passphrase" className="text-xs">
                        Passphrase
                      </Label>
                      <PasswordInput
                        id="onboarding-passphrase"
                        placeholder="Enter a strong passphrase"
                        value={backupPassphrase}
                        onChange={(e) => setBackupPassphrase(e.target.value)}
                        visible={showBackupPassphrase}
                        onToggleVisibility={() => setShowBackupPassphrase((v) => !v)}
                        className="h-10 rounded-xl border-border/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="onboarding-passphrase-confirm" className="text-xs">
                        Confirm passphrase
                      </Label>
                      <PasswordInput
                        id="onboarding-passphrase-confirm"
                        placeholder="Confirm passphrase"
                        value={backupPassphraseConfirmation}
                        onChange={(e) => setBackupPassphraseConfirmation(e.target.value)}
                        visible={showBackupPassphrase}
                        onToggleVisibility={() => setShowBackupPassphrase((v) => !v)}
                        className="h-10 rounded-xl border-border/60"
                      />
                      {backupPassphraseMismatch ? (
                        <p className="text-xs text-destructive">Passphrases don&rsquo;t match.</p>
                      ) : null}
                    </div>
                    <Button
                      onClick={handleSaveBackupPassphrase}
                      disabled={
                        !backupPassphrase.trim() ||
                        !backupPassphraseConfirmation.trim() ||
                        backupPassphraseMismatch ||
                        busy !== null
                      }
                      variant="secondary"
                      className="mt-1 w-full rounded-xl"
                    >
                      <KeyRound className="h-4 w-4" />
                      {busy === "passphrase"
                        ? "Saving..."
                        : config.autoBackupPassphraseConfigured
                          ? "Replace passphrase"
                          : "Save passphrase"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ── CLI ── */}
            {activeStep === "cli" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <TerminalSquare className="h-5 w-5 text-foreground" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">
                  Install Terminal command
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Access your vault from the command line with{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    cloakenv
                  </code>
                  .
                </p>

                {cliReady ? (
                  <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    CLI installed and ready
                  </div>
                ) : (
                  <>
                    {cliStatus?.binDirectory ? (
                      <div className="mt-5 w-full rounded-xl bg-muted/50 px-4 py-3">
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {cliStatus.binDirectory}
                        </p>
                      </div>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={handleInstallCli}
                      disabled={busy !== null || !cliBundled}
                      className="mt-4 rounded-xl px-5"
                    >
                      <TerminalSquare className="h-4 w-4" />
                      {busy === "cli"
                        ? cliStatus?.updateAvailable
                          ? "Updating..."
                          : "Installing..."
                        : cliStatus?.updateAvailable
                          ? "Update cloakenv"
                          : "Install cloakenv"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── Project ── */}
            {activeStep === "project" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <FolderOpen className="h-5 w-5 text-foreground" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">Add your first project</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Import a project folder to scan for .env files and bring secrets into the vault.
                </p>

                {projectSetup.projectName ? (
                  <div className="mt-6 w-full space-y-3">
                    <div className="rounded-xl bg-muted/50 px-4 py-3 text-left">
                      <p className="text-sm font-medium text-foreground">
                        {projectSetup.projectName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {projectSetup.folderPath}
                      </p>
                    </div>
                    {projectSetup.envFiles.length > 0 ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (allEnvFilesImported) {
                            setProjectSetup((c) => ({ ...c, importDialogOpen: true }));
                          } else {
                            void handleImportAllEnvFiles();
                          }
                        }}
                        disabled={busy !== null}
                        className="rounded-xl"
                      >
                        {allEnvFilesImported
                          ? `${importedFileCount} file${importedFileCount === 1 ? "" : "s"} imported`
                          : busy === "project"
                            ? "Importing..."
                            : `Import ${projectSetup.envFiles.length} .env file${projectSetup.envFiles.length === 1 ? "" : "s"}`}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {projectCount > 0 ? (
                      <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        {projectCount} project{projectCount === 1 ? "" : "s"} in vault
                      </div>
                    ) : null}
                    <Button
                      onClick={handleOpenProjectFolder}
                      disabled={busy !== null}
                      variant={projectCount > 0 ? "secondary" : "default"}
                      className="mt-5 rounded-xl px-5"
                    >
                      <FolderOpen className="h-4 w-4" />
                      {busy === "project"
                        ? "Opening..."
                        : projectCount > 0
                          ? "Add another project"
                          : "Choose project folder"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── Finish ── */}
            {activeStep === "finish" && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em]">You&rsquo;re all set</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Optional steps can be revisited anytime from Preferences.
                </p>

                <div className="mt-6 w-full space-y-1">
                  {[
                    { label: "Backup folder", done: backupReady },
                    {
                      label: "Backup passphrase",
                      done: config.autoBackupPassphraseConfigured,
                    },
                    ...(cliBundled ? [{ label: "Terminal command", done: cliReady }] : []),
                    { label: "First project", done: projectCount > 0 },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-2.5"
                    >
                      <span className="text-sm text-foreground">{item.label}</span>
                      {item.done ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
                          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Later</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/40 px-8 py-4">
            <div>
              {previousVisibleStep ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToStep(previousVisibleStep)}
                  disabled={busy !== null}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
              ) : null}
            </div>

            {activeStep === "finish" ? (
              <Button
                onClick={handleFinish}
                disabled={busy !== null || !backupReady}
                className="rounded-xl px-6"
              >
                {busy === "finish" ? "Finalizing..." : "Enter CloakEnv"}
              </Button>
            ) : (
              <Button
                variant={currentStepDone || !isOptional ? "default" : "ghost"}
                onClick={() => nextVisibleStep && navigateToStep(nextVisibleStep)}
                disabled={busy !== null || (activeStep === "backup" && !backupReady)}
                className="rounded-xl px-5"
              >
                {currentStepDone || !isOptional ? "Continue" : "Skip"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <EnvImportDialog
        state={projectImportDialogState}
        busy={busy === "project" || busy === "cleanup"}
        onOpenChange={handleProjectImportDialogOpenChange}
        onImportFile={handleImportEnvFile}
        onImportAll={handleImportAllEnvFiles}
        onDeleteEnvFiles={handleDeleteOriginals}
      />
    </div>
  );
}

function deriveProjectName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}
