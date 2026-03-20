import type { EnvFileInfo } from "@shared/types";
import { Check, FileCode2, FileWarning, Import, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type EnvImportDialogPhase = "preview" | "importing" | "delete-prompt" | "done";

export interface EnvImportDialogState {
  open: boolean;
  projectId: string | null;
  projectName: string;
  folderPath: string;
  envFiles: EnvFileInfo[];
  importedFiles: Set<string>;
  phase: EnvImportDialogPhase;
}

interface EnvImportDialogProps {
  state: EnvImportDialogState;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onImportFile: (filePath: string) => void | Promise<void>;
  onImportAll: () => void | Promise<void>;
  onDeleteEnvFiles: () => void | Promise<void>;
}

export function EnvImportDialog({
  state,
  busy = false,
  onOpenChange,
  onImportFile,
  onImportAll,
  onDeleteEnvFiles,
}: EnvImportDialogProps) {
  const allEnvFilesImported =
    state.envFiles.length > 0 &&
    state.envFiles.every((file) => state.importedFiles.has(file.filePath));

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-4 w-4 shrink-0 text-amber-400" />
            {state.phase === "delete-prompt" ? "Delete original files?" : "Import .env files"}
          </DialogTitle>
          <DialogDescription>
            {state.phase === "delete-prompt"
              ? "Plaintext secrets are a security risk. Files will be moved to trash."
              : `Found ${state.envFiles.length} file${state.envFiles.length === 1 ? "" : "s"} in ${state.projectName}`}
          </DialogDescription>
        </DialogHeader>

        {state.phase !== "delete-prompt" && (
          <div className="max-h-60 space-y-1 overflow-y-auto py-1">
            {state.envFiles.map((file) => {
              const isImported = state.importedFiles.has(file.filePath);
              return (
                <div
                  key={file.filePath}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  {isImported ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <code className="block truncate text-xs font-medium">{file.fileName}</code>
                    <span className="text-[10px] text-muted-foreground">
                      {file.entries.length} variables
                    </span>
                  </div>
                  {!isImported && state.phase === "preview" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      disabled={busy}
                      onClick={() => void onImportFile(file.filePath)}
                    >
                      Import
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {state.phase === "preview" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Skip
              </Button>
              <Button
                size="sm"
                onClick={() => void onImportAll()}
                disabled={busy || allEnvFilesImported}
              >
                <Import className="mr-1.5 h-3.5 w-3.5" />
                {busy ? "Importing..." : allEnvFilesImported ? "All imported" : "Import All"}
              </Button>
            </>
          )}

          {state.phase === "delete-prompt" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Keep files
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onDeleteEnvFiles()}
                disabled={busy}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Move to Trash
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
