import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, ProjectManager, triggerAutoBackup } from "@cloakenv/core";
import type { Command } from "commander";
import { ensureAutoBackupReady, ensureBackupPathConfigured } from "../utils/backup-policy";
import { getVaultContext } from "../utils/context";
import { confirm } from "../utils/prompt";

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage projects");

  project
    .command("create <name>")
    .description("Register a new project")
    .option("--path <directory>", "Associate with a directory path")
    .action(async (name: string, options: { path?: string }) => {
      const { db, masterKey, configRepo } = await getVaultContext();
      ensureBackupPathConfigured(configRepo);
      await ensureAutoBackupReady(configRepo);
      const manager = new ProjectManager(db);
      const created = manager.create(name, options.path);
      await triggerAutoBackup(db, masterKey);
      console.log(`Project created: ${created.name}`);
      if (created.path) console.log(`  Path: ${created.path}`);
    });

  project
    .command("list")
    .description("List all registered projects")
    .action(() => {
      const db = getDatabase();
      const manager = new ProjectManager(db);
      const projects = manager.list();

      if (projects.length === 0) {
        console.log("No projects found. Create one with: cloakenv project create <name>");
        return;
      }

      console.log(`Projects (${projects.length}):\n`);
      for (const p of projects) {
        const secrets = manager.getSecretCount(p.id);
        const date = new Date(p.updatedAt * 1000).toISOString().substring(0, 10);
        console.log(`  ${p.name.padEnd(24)} ${String(secrets).padStart(3)} secrets  ${date}`);
        if (p.path) console.log(`    ${p.path}`);
      }
    });

  project
    .command("rename <old> <new>")
    .description("Rename an existing project")
    .action(async (oldName: string, newName: string) => {
      const { db, masterKey, configRepo } = await getVaultContext();
      ensureBackupPathConfigured(configRepo);
      await ensureAutoBackupReady(configRepo);
      const manager = new ProjectManager(db);
      const existing = manager.resolve(oldName);
      if (!existing) {
        console.error(`Project "${oldName}" not found.`);
        process.exit(1);
      }
      manager.rename(existing.id, newName);
      await triggerAutoBackup(db, masterKey);
      console.log(`Renamed: "${oldName}" → "${newName}"`);
    });

  project
    .command("remove <name>")
    .description("Remove a project and its secrets")
    .option("--yes", "Skip the confirmation prompt")
    .action(async (name: string, options: { yes?: boolean }) => {
      const { db, masterKey } = await getVaultContext();
      const manager = new ProjectManager(db);
      const existing = manager.resolve(name);
      if (!existing) {
        console.error(`Project "${name}" not found.`);
        process.exit(1);
      }

      if (!options.yes) {
        const approved = confirm(
          `Remove project "${name}" and all of its currently active secrets from the vault?`,
          false,
        );
        if (!approved) {
          console.log("Aborted.");
          process.exit(1);
        }
      }

      manager.remove(existing.id);
      await triggerAutoBackup(db, masterKey);
      console.log(`Removed: "${name}"`);
    });

  project
    .command("switch <name>")
    .description("Bind the current directory to an existing project via a .cloakenv marker")
    .action((name: string) => {
      const db = getDatabase();
      const manager = new ProjectManager(db);
      const existing = manager.resolve(name);
      if (!existing) {
        console.error(`Project "${name}" not found.`);
        process.exit(1);
      }

      const markerPath = join(process.cwd(), ".cloakenv");
      writeFileSync(markerPath, `project=${existing.name}\n`, "utf8");
      console.log(`Current directory now resolves to project "${existing.name}".`);
      console.log(`Marker written to: ${markerPath}`);
    });
}
