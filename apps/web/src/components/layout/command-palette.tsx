import { Activity, Download, FileText, FolderOpen, Plus, ShieldCheck, Upload } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAppStore } from "@/lib/store";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setAuditOpen = useAppStore((s) => s.setAuditOpen);
  const setToolPanelOpen = useAppStore((s) => s.setToolPanelOpen);
  const setToolPanelView = useAppStore((s) => s.setToolPanelView);
  const setAddSecretOpen = useAppStore((s) => s.setAddSecretOpen);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeEnvironment = useAppStore((s) => s.activeEnvironment);
  const projects = useAppStore((s) => s.projects);
  const setActiveProject = useAppStore((s) => s.setActiveProject);

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Projects">
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              onSelect={() => {
                setActiveProject(project.id);
                setOpen(false);
                toast.success(`Switched to ${project.name}`);
              }}
            >
              <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{project.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {project.secretCount} secrets
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              if (!activeProjectId || !activeEnvironment) {
                toast.error("Select a project environment before adding a secret");
                setOpen(false);
                return;
              }

              setAddSecretOpen(true);
              setOpen(false);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>Add Secret</span>
            <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              N
            </kbd>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              setAuditOpen(true);
            }}
          >
            <Activity className="mr-2 h-4 w-4" />
            <span>Open Request Trace</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              setToolPanelView("transfer");
              setToolPanelOpen(true);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            <span>Export Vault</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              setToolPanelView("transfer");
              setToolPanelOpen(true);
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            <span>Import from .cloaked</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (!activeProjectId) {
                toast.error("Select a project before working with schema");
                setOpen(false);
                return;
              }

              setOpen(false);
              setToolPanelView("schema");
              setToolPanelOpen(true);
            }}
          >
            <FileText className="mr-2 h-4 w-4" />
            <span>Export Schema</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              setToolPanelView("runtime");
              setToolPanelOpen(true);
            }}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            <span>Open Provider Console</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
