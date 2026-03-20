import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { KEY_LENGTH } from "../../src/crypto/constants";
import { deriveProjectKey } from "../../src/crypto/key-derivation";
import { randomBytesBuffer } from "../../src/crypto/random";
import { bootstrapSecretsFromSchema, findSchemaEntry } from "../../src/schema/bootstrap";
import type { ParsedEnvSpec } from "../../src/types/schema";
import { runMigrations } from "../../src/vault/migrations";
import { ProjectRepository } from "../../src/vault/project-repo";
import { SchemaRepository } from "../../src/vault/schema-repo";
import { SecretRepository } from "../../src/vault/secret-repo";

describe("Schema bootstrap", () => {
  let db: Database;
  let secretRepo: SecretRepository;
  let schemaRepo: SchemaRepository;
  let projectId: string;

  beforeEach(() => {
    db = new Database(":memory:", { create: true, strict: true });
    db.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const masterKey = randomBytesBuffer(KEY_LENGTH);
    const project = new ProjectRepository(db).create("schema-test");
    const projectKey = deriveProjectKey(masterKey, project.salt);
    projectId = project.id;

    secretRepo = new SecretRepository(db, project.id, projectKey);
    schemaRepo = new SchemaRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("creates secrets from defaults and prompted values, skipping unresolved optional entries", async () => {
    const spec: ParsedEnvSpec = {
      rootDecorators: {
        defaultSensitive: true,
      },
      entries: [
        {
          key: "API_KEY",
          defaultValue: null,
          description: "Primary API key",
          type: { name: "string", params: { startsWith: "sk_" } },
          sensitive: null,
          required: true,
          example: null,
          docsUrls: [],
        },
        {
          key: "PORT",
          defaultValue: "3000",
          description: null,
          type: { name: "port", params: {} },
          sensitive: false,
          required: null,
          example: null,
          docsUrls: [],
        },
        {
          key: "OPTIONAL_TOKEN",
          defaultValue: null,
          description: null,
          type: null,
          sensitive: null,
          required: false,
          example: null,
          docsUrls: [],
        },
      ],
    };

    const result = await bootstrapSecretsFromSchema({
      projectId,
      spec,
      secretRepo,
      schemaRepo,
      resolveValue: (entry) => {
        if (entry.key === "API_KEY") {
          return "sk_live_123";
        }

        return undefined;
      },
    });

    expect(result.created).toBe(2);
    expect(result.metadataApplied).toBe(3);
    expect(result.prompted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.warnings).toHaveLength(0);

    expect(secretRepo.getByKey("API_KEY")?.value).toBe("sk_live_123");
    expect(secretRepo.getByKey("PORT")?.value).toBe("3000");
    expect(secretRepo.getByKey("OPTIONAL_TOKEN")).toBeNull();

    expect(schemaRepo.getByKey(projectId, "API_KEY")?.typeName).toBe("string");
    expect(schemaRepo.getByKey(projectId, "PORT")?.sensitive).toBe(false);
  });

  test("applies metadata to existing secrets and surfaces validation warnings", async () => {
    const existing = secretRepo.create("PORT", "99999");
    const spec: ParsedEnvSpec = {
      rootDecorators: {},
      entries: [
        {
          key: "PORT",
          defaultValue: null,
          description: null,
          type: { name: "port", params: { max: "65535" } },
          sensitive: null,
          required: null,
          example: null,
          docsUrls: [],
        },
      ],
    };

    const result = await bootstrapSecretsFromSchema({
      projectId,
      spec,
      secretRepo,
      schemaRepo,
    });

    expect(result.created).toBe(0);
    expect(result.metadataApplied).toBe(1);
    expect(result.warnings).toEqual([
      {
        key: "PORT",
        scope: "default",
        message: "Must be a valid port number (0-65535)",
      },
    ]);

    expect(schemaRepo.getByKey(projectId, existing.key, existing.scope)?.typeName).toBe("port");
  });

  test("resolves schema defaults from root decorators", () => {
    const spec: ParsedEnvSpec = {
      rootDecorators: {
        defaultSensitive: false,
        defaultRequired: false,
      },
      entries: [
        {
          key: "PUBLIC_URL",
          defaultValue: "https://example.com",
          description: null,
          type: { name: "url", params: {} },
          sensitive: null,
          required: null,
          example: null,
          docsUrls: [],
        },
      ],
    };

    const entry = findSchemaEntry(spec, "PUBLIC_URL");
    expect(entry).not.toBeNull();
    expect(entry?.sensitive).toBe(false);
    expect(entry?.required).toBe(false);
  });
});
