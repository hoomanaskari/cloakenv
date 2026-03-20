import { Boxes, Copy, Eye, EyeOff, History, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRPC } from "@/hooks/use-rpc";
import { useAppStore } from "@/lib/store";
import { cn, formatRelativeTime } from "@/lib/utils";
import { SensitivityBadge } from "./sensitivity-badge";

export function SecretTable() {
  const rpc = useRPC();
  const secrets = useAppStore((s) => s.secrets);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const setActiveEnvironment = useAppStore((s) => s.setActiveEnvironment);
  const setEnvironments = useAppStore((s) => s.setEnvironments);
  const setSecrets = useAppStore((s) => s.setSecrets);
  const setProjects = useAppStore((s) => s.setProjects);
  const addDialog = useAppStore((s) => s.addSecretOpen);
  const setAddDialog = useAppStore((s) => s.setAddSecretOpen);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [historyDialog, setHistoryDialog] = useState<{
    open: boolean;
    key: string;
    entries: Array<{ value: string; version: number; createdAt: number }>;
  }>({ open: false, key: "", entries: [] });

  const filteredSecrets = useMemo(() => {
    if (!searchQuery) return secrets;
    const q = searchQuery.toLowerCase();
    return secrets.filter((s) => s.key.toLowerCase().includes(q));
  }, [secrets, searchQuery]);

  const refreshProjectData = useCallback(
    async (preferredEnvironment?: string | null) => {
      if (!rpc || !activeProjectId) return;

      const [updatedEnvironments, updatedProjects] = await Promise.all([
        rpc.listEnvironments({ projectId: activeProjectId }),
        rpc.listProjects(),
      ]);

      setEnvironments(updatedEnvironments);
      setProjects(updatedProjects);

      const nextEnvironment =
        preferredEnvironment && updatedEnvironments.some((env) => env.name === preferredEnvironment)
          ? preferredEnvironment
          : updatedEnvironments.some((env) => env.name === activeEnvironment)
            ? activeEnvironment
            : (updatedEnvironments[0]?.name ?? null);

      setActiveEnvironment(nextEnvironment);

      if (!nextEnvironment) {
        setSecrets([]);
        setRevealedValues({});
        return;
      }

      const updatedSecrets = await rpc.getSecrets({
        projectId: activeProjectId,
        environment: nextEnvironment,
      });
      setSecrets(updatedSecrets);
      setRevealedValues({});
    },
    [
      rpc,
      activeProjectId,
      activeEnvironment,
      setActiveEnvironment,
      setEnvironments,
      setProjects,
      setSecrets,
    ],
  );

  const copyValue = useCallback((value: string, key: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`Copied ${key} to clipboard`);
  }, []);

  const fetchSecretValue = useCallback(
    async (secretId: string) => {
      if (!rpc || !activeProjectId) {
        return null;
      }

      if (revealedValues[secretId]) {
        return revealedValues[secretId];
      }

      const result = await rpc.revealSecret({ projectId: activeProjectId, secretId });
      return result.value;
    },
    [rpc, activeProjectId, revealedValues],
  );

  const resolveSecretValue = useCallback(
    async (secretId: string) => {
      const value = await fetchSecretValue(secretId);
      if (!value || revealedValues[secretId] === value) {
        return value;
      }

      setRevealedValues((prev) => ({
        ...prev,
        [secretId]: value,
      }));
      return value;
    },
    [fetchSecretValue, revealedValues],
  );

  const handleToggleReveal = useCallback(
    async (secretId: string) => {
      if (revealedValues[secretId]) {
        setRevealedValues((prev) => {
          const next = { ...prev };
          delete next[secretId];
          return next;
        });
        return;
      }

      try {
        await resolveSecretValue(secretId);
      } catch (err) {
        console.error("[CloakEnv] Failed to reveal secret:", err);
        toast.error("Failed to reveal secret");
      }
    },
    [resolveSecretValue, revealedValues],
  );

  const handleCopySecret = useCallback(
    async (secretId: string, key: string) => {
      try {
        const value = await fetchSecretValue(secretId);
        if (!value) {
          return;
        }
        copyValue(value, key);
      } catch (err) {
        console.error("[CloakEnv] Failed to copy secret:", err);
        toast.error("Failed to copy secret");
      }
    },
    [copyValue, fetchSecretValue],
  );

  const handleAddSecret = useCallback(async () => {
    if (!rpc || !activeProjectId || !activeEnvironment || !newKey.trim()) return;

    setSaving(true);
    try {
      await rpc.setSecret({
        projectId: activeProjectId,
        key: newKey.trim(),
        value: newValue,
        scope: activeEnvironment,
      });
      toast.success(`Saved "${newKey.trim()}" in ${activeEnvironment}`);
      setAddDialog(false);
      setNewKey("");
      setNewValue("");
      await refreshProjectData(activeEnvironment);
    } catch (err) {
      console.error("[CloakEnv] Failed to add secret:", err);
      toast.error("Failed to save secret");
    } finally {
      setSaving(false);
    }
  }, [rpc, activeProjectId, activeEnvironment, newKey, newValue, refreshProjectData, setAddDialog]);

  const handleDeleteSecret = useCallback(
    async (secretId: string, key: string) => {
      if (!rpc || !activeProjectId) return;

      try {
        await rpc.removeSecret({ projectId: activeProjectId, secretId });
        toast.success(`Deleted "${key}"`);
        await refreshProjectData(activeEnvironment);
      } catch (err) {
        console.error("[CloakEnv] Failed to delete secret:", err);
        toast.error("Failed to delete secret");
      }
    },
    [rpc, activeProjectId, activeEnvironment, refreshProjectData],
  );

  const handleViewHistory = useCallback(
    async (secretId: string, key: string) => {
      if (!rpc || !activeProjectId) return;

      try {
        const entries = await rpc.getSecretHistory({ projectId: activeProjectId, secretId });
        setHistoryDialog({ open: true, key, entries });
      } catch (err) {
        console.error("[CloakEnv] Failed to load history:", err);
        toast.error("Failed to load history");
      }
    },
    [rpc, activeProjectId],
  );

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {activeEnvironment ? (
              <span className="text-foreground font-semibold">{activeEnvironment}</span>
            ) : (
              "No environment selected"
            )}
          </h3>
          {activeEnvironment && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono tabular-nums">
              {filteredSecrets.length}
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setAddDialog(true)}
          disabled={!activeEnvironment}
        >
          <Plus className="h-3 w-3" />
          Add Variable
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-70 text-[11px] font-semibold uppercase tracking-wider">
                Key
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider">
                Value
              </TableHead>
              <TableHead className="w-22.5 text-[11px] font-semibold uppercase tracking-wider">
                Type
              </TableHead>
              <TableHead className="w-27.5 text-[11px] font-semibold uppercase tracking-wider">
                Updated
              </TableHead>
              <TableHead className="w-12.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSecrets.map((secret) => {
              const revealedValue = revealedValues[secret.id];
              const isRevealed = typeof revealedValue === "string";

              return (
                <tr
                  key={secret.id}
                  className="group border-b border-border transition-colors hover:bg-muted/30"
                >
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[13px] font-medium text-foreground">
                        {secret.key}
                      </code>
                      {secret.version > 1 && (
                        <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                          v{secret.version}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2">
                      <code
                        className={cn(
                          "max-w-85 truncate font-mono text-xs",
                          isRevealed ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {isRevealed ? revealedValue : secret.maskedValue}
                      </code>
                      <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => void handleToggleReveal(secret.id)}
                        >
                          {isRevealed ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => void handleCopySecret(secret.id, secret.key)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="py-2.5">
                    <SensitivityBadge sensitive={secret.sensitive} />
                  </TableCell>

                  <TableCell className="py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(secret.updatedAt)}
                    </span>
                  </TableCell>

                  <TableCell className="py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => void handleCopySecret(secret.id, secret.key)}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy value
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleViewHistory(secret.id, secret.key)}>
                          <History className="mr-2 h-3.5 w-3.5" />
                          View history
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDeleteSecret(secret.id, secret.key)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </tr>
              );
            })}
          </TableBody>
        </Table>

        {!activeEnvironment && (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">No environment selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Select an environment from the sidebar or import .env files.
              </p>
            </div>
          </div>
        )}

        {activeEnvironment && filteredSecrets.length === 0 && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            {searchQuery
              ? "No variables match your search in this environment."
              : "No variables in this environment yet."}
          </div>
        )}
      </div>

      {/* Add Variable Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Variable</DialogTitle>
            <DialogDescription>
              Save an encrypted environment variable inside the selected environment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Environment</Label>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-mono font-medium">
                {activeEnvironment ?? "No environment selected"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-key">Key</Label>
              <Input
                id="secret-key"
                placeholder="DATABASE_URL"
                value={newKey}
                onChange={(e) =>
                  setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
                }
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                placeholder="postgres://..."
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddSecret}
              disabled={!newKey.trim() || !activeEnvironment || saving}
            >
              {saving ? "Saving..." : "Save Variable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog
        open={historyDialog.open}
        onOpenChange={(open) => setHistoryDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              History for <code className="font-mono text-sm">{historyDialog.key}</code>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-auto py-2">
            {historyDialog.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history available.</p>
            ) : (
              historyDialog.entries.map((entry) => (
                <div
                  key={entry.version}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <code className="block truncate font-mono text-xs text-foreground">
                      {entry.value}
                    </code>
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                    v{entry.version}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
