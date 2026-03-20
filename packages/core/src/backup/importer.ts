import type { Database } from "bun:sqlite";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { ALGORITHM, ARGON2_DEFAULTS, TAG_LENGTH } from "../crypto/constants";
import { deriveMasterKey, deriveProjectKey } from "../crypto/key-derivation";
import type { CloakedPayload } from "../types/backup";
import { CLOAKED_HEADER_SIZE } from "../types/backup";
import { EnvironmentRepository } from "../vault/environment-repo";
import { ProjectRepository } from "../vault/project-repo";
import { SchemaRepository } from "../vault/schema-repo";
import { SecretRepository } from "../vault/secret-repo";
import { parseHeader } from "./format";

export interface ImportOptions {
  db: Database;
  masterKey: Buffer;
  filePath: string;
  passphrase: string;
}

export interface ImportResult {
  projectsImported: number;
  secretsImported: number;
}

/**
 * Import vault contents from an encrypted .cloaked backup file.
 */
export async function importVault(options: ImportOptions): Promise<ImportResult> {
  const fileBuf = readFileSync(options.filePath);
  const header = parseHeader(fileBuf);

  // Derive decryption key from passphrase + stored salt
  const { key } = await deriveMasterKey(options.passphrase, header.salt, {
    memoryCost: header.memoryCost,
    timeCost: header.timeCost,
    parallelism: ARGON2_DEFAULTS.parallelism,
  });

  // Extract ciphertext and auth tag
  const ciphertext = fileBuf.subarray(
    CLOAKED_HEADER_SIZE,
    CLOAKED_HEADER_SIZE + header.payloadLength,
  );
  const tag = fileBuf.subarray(
    CLOAKED_HEADER_SIZE + header.payloadLength,
    CLOAKED_HEADER_SIZE + header.payloadLength + TAG_LENGTH,
  );

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, key, header.iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  let plaintext: string;
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    plaintext = decrypted.toString("utf8");
  } catch {
    throw new Error("Failed to decrypt .cloaked file. Wrong passphrase or corrupted file.");
  }

  // Parse and validate payload
  let payload: CloakedPayload;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new Error("Decrypted data is not valid JSON. File may be corrupted.");
  }

  // Import into vault
  const projectRepo = new ProjectRepository(options.db);
  const environmentRepo = new EnvironmentRepository(options.db);
  const schemaRepo = new SchemaRepository(options.db);

  let projectsImported = 0;
  let secretsImported = 0;

  for (const projectData of payload.projects) {
    // Create or find existing project
    let project = projectRepo.getByName(projectData.name);
    if (!project) {
      project = projectRepo.create(projectData.name, projectData.path);
      projectsImported++;
    }

    const projectKey = deriveProjectKey(options.masterKey, project.salt);
    const secretRepo = new SecretRepository(options.db, project.id, projectKey);

    for (const environment of projectData.environments ?? []) {
      environmentRepo.create(
        project.id,
        environment.name,
        environment.sourceKind,
        environment.sourceFile,
      );
    }

    for (const schemaEntry of projectData.schemaEntries ?? []) {
      environmentRepo.create(project.id, schemaEntry.scope, "manual");
      if (!schemaEntry.schema) {
        continue;
      }

      schemaRepo.upsert(project.id, schemaEntry.key, schemaEntry.scope, {
        typeName: schemaEntry.schema.typeName,
        typeParams: schemaEntry.schema.typeParams,
        sensitive: schemaEntry.schema.sensitive,
        required: schemaEntry.schema.required,
        description: schemaEntry.schema.description,
        example: schemaEntry.schema.example,
        docsUrls: schemaEntry.schema.docsUrls ?? [],
        defaultValue: schemaEntry.schema.defaultValue ?? null,
      });
    }

    for (const secretData of projectData.secrets) {
      environmentRepo.create(project.id, secretData.scope, "manual");

      // Check if secret already exists
      const existing = secretRepo.getByKey(secretData.key, secretData.scope);
      if (existing) {
        secretRepo.update(secretData.key, secretData.value, secretData.scope);
      } else {
        secretRepo.create(secretData.key, secretData.value, secretData.scope);
      }

      // Support importing older backup payloads that embedded schema on each secret.
      if ("schema" in secretData && secretData.schema) {
        schemaRepo.upsert(project.id, secretData.key, secretData.scope, {
          typeName: secretData.schema.typeName,
          typeParams: secretData.schema.typeParams,
          sensitive: secretData.schema.sensitive,
          required: secretData.schema.required,
          description: secretData.schema.description,
          example: secretData.schema.example,
          docsUrls: secretData.schema.docsUrls ?? [],
          defaultValue: secretData.schema.defaultValue ?? null,
        });
      }

      secretsImported++;
    }
  }

  return { projectsImported, secretsImported };
}
