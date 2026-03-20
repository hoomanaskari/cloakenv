import type { Database } from "bun:sqlite";
import type { Project } from "../types/vault";
import { ProjectRepository } from "../vault/project-repo";
import { detectProject } from "./detector";

export class ProjectManager {
  private repo: ProjectRepository;

  constructor(db: Database) {
    this.repo = new ProjectRepository(db);
  }

  /**
   * Resolve the current project context.
   * Priority: explicit name > auto-detection > null
   */
  resolve(explicitName?: string, cwd?: string): Project | null {
    if (explicitName) {
      return this.repo.getByName(explicitName);
    }

    const detected = detectProject(cwd);
    if (!detected) return null;

    // Try to find existing project by path
    const existing = this.repo.getByPath(detected.path);
    if (existing) return existing;

    // Try by name
    return this.repo.getByName(detected.name);
  }

  /**
   * Resolve or auto-create a project from CWD.
   */
  resolveOrCreate(explicitName?: string, cwd?: string): Project {
    const existing = this.resolve(explicitName, cwd);
    if (existing) return existing;

    const detected = detectProject(cwd);
    if (!detected) {
      throw new Error(
        "Could not detect project. Run from a Git repository, a directory with a supported project manifest, or use --project to specify.",
      );
    }

    return this.repo.create(detected.name, detected.path, detected.gitRemote);
  }

  create(name: string, path?: string, gitRemote?: string, description?: string): Project {
    return this.repo.create(name, path, gitRemote, description);
  }

  list(): Project[] {
    return this.repo.list();
  }

  rename(id: string, newName: string): void {
    this.repo.rename(id, newName);
  }

  remove(id: string): void {
    this.repo.remove(id);
  }

  getSecretCount(projectId: string): number {
    return this.repo.getSecretCount(projectId);
  }
}
