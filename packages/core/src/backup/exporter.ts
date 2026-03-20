import type { Database } from "bun:sqlite";
import { createCipheriv } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ALGORITHM, ARGON2_DEFAULTS, TAG_LENGTH } from "../crypto/constants";
import { deriveMasterKey, deriveProjectKey } from "../crypto/key-derivation";
import { generateIv, generateSalt } from "../crypto/random";
import type { CloakedFileHeader, CloakedPayload } from "../types/backup";
import { CLOAKED_FORMAT_VERSION, CLOAKED_MAGIC } from "../types/backup";
import { EnvironmentRepository } from "../vault/environment-repo";
import { ProjectRepository } from "../vault/project-repo";
import { SchemaRepository } from "../vault/schema-repo";
import { SecretRepository } from "../vault/secret-repo";
import { serializeHeader } from "./format";

export interface ExportOptions {
  db: Database;
  masterKey: Buffer;
  passphrase: string;
  projectName?: string; // Export single project, or all if not specified
  outputPath: string;
}

/**
 * Export vault contents to an encrypted .cloaked backup file.
 */
export async function exportVault(options: ExportOptions): Promise<void> {
  const projectRepo = new ProjectRepository(options.db);
  const environmentRepo = new EnvironmentRepository(options.db);
  const schemaRepo = new SchemaRepository(options.db);

  const projects = options.projectName
    ? [projectRepo.getByName(options.projectName)].filter(Boolean)
    : projectRepo.list();

  if (projects.length === 0 && options.projectName) {
    throw new Error(`Project "${options.projectName}" not found`);
  }

  // Build payload
  const payload: CloakedPayload = {
    version: CLOAKED_FORMAT_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    projects: [],
  };

  for (const project of projects) {
    if (!project) continue;
    const projectKey = deriveProjectKey(options.masterKey, project.salt);
    const secretRepo = new SecretRepository(options.db, project.id, projectKey);
    const secrets = secretRepo.getAllDecrypted();
    const schemaEntries = schemaRepo.listByProject(project.id);

    payload.projects.push({
      name: project.name,
      path: project.path,
      environments: environmentRepo.list(project.id).map((env) => ({
        name: env.name,
        sourceFile: env.sourceFile,
        sourceKind: env.sourceKind,
      })),
      schemaEntries: schemaEntries.map((entry) => ({
        key: entry.key,
        scope: entry.scope,
        schema: {
          typeName: entry.typeName,
          typeParams: entry.typeParams,
          sensitive: entry.sensitive,
          required: entry.required,
          description: entry.description,
          example: entry.example,
          docsUrls: entry.docsUrls,
          defaultValue: entry.defaultValue,
        },
      })),
      secrets: secrets.map((s) => ({
        key: s.key,
        value: s.value,
        scope: s.scope,
      })),
    });
  }

  // Encrypt payload with passphrase-derived key
  const salt = generateSalt();
  const { key } = await deriveMasterKey(options.passphrase, salt);
  const iv = generateIv();
  const plaintext = JSON.stringify(payload);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Build header
  const header: CloakedFileHeader = {
    magic: CLOAKED_MAGIC,
    version: CLOAKED_FORMAT_VERSION,
    flags: options.projectName ? 0 : 1, // 0=single, 1=full vault
    salt,
    memoryCost: ARGON2_DEFAULTS.memoryCost,
    timeCost: ARGON2_DEFAULTS.timeCost,
    iv,
    payloadLength: ciphertext.length,
  };

  // Write file: header + ciphertext + tag
  const headerBuf = serializeHeader(header);
  const file = Buffer.concat([headerBuf, ciphertext, tag]);
  writeFileSync(options.outputPath, file);
}
