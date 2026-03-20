import type { Database } from "bun:sqlite";
import {
  AuditRepository,
  ConfigRepository,
  deriveMasterKey,
  deriveProjectKey,
  getDatabase,
  getKeychainProvider,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  type Project,
  ProjectManager,
  SchemaRepository,
  SecretRepository,
} from "@cloakenv/core";

export interface AppContext {
  db: Database;
  masterKey: Buffer;
  project: Project;
  projectKey: Buffer;
  secretRepo: SecretRepository;
  auditRepo: AuditRepository;
  configRepo: ConfigRepository;
  projectManager: ProjectManager;
}

export interface VaultContext {
  db: Database;
  masterKey: Buffer;
  auditRepo: AuditRepository;
  configRepo: ConfigRepository;
  projectManager: ProjectManager;
}

/**
 * Initialize the full application context for a command.
 */
export async function getAppContext(options: {
  projectName?: string;
  requireProject?: boolean;
}): Promise<AppContext> {
  const { db, masterKey, auditRepo, configRepo, projectManager } = await getVaultContext();

  // Resolve project
  const project =
    options.requireProject !== false
      ? projectManager.resolveOrCreate(options.projectName)
      : (projectManager.resolve(options.projectName) ??
        projectManager.resolveOrCreate(options.projectName));

  const projectKey = deriveProjectKey(masterKey, project.salt);
  const secretRepo = new SecretRepository(db, project.id, projectKey);
  const schemaRepo = new SchemaRepository(db);
  schemaRepo.migrateLegacyProjectEntries(project.id, secretRepo.list());

  return { db, masterKey, project, projectKey, secretRepo, auditRepo, configRepo, projectManager };
}

export async function getVaultContext(): Promise<VaultContext> {
  const db = getDatabase();
  const configRepo = new ConfigRepository(db);
  const projectManager = new ProjectManager(db);
  const auditRepo = new AuditRepository(db);
  const masterKey = await getMasterKey(db, configRepo);

  return { db, masterKey, auditRepo, configRepo, projectManager };
}

async function getMasterKey(db: Database, configRepo: ConfigRepository): Promise<Buffer> {
  const authMode = configRepo.get("authMode");

  if (authMode === "keychain") {
    const keychain = getKeychainProvider();
    const stored = await keychain.retrieve(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

    if (stored) {
      return Buffer.from(stored, "hex");
    }

    // First time: generate and store master key
    const { key, salt } = await deriveMasterKey(
      crypto.randomUUID(), // Random passphrase for keychain-based auth
    );

    // Store the key in keychain
    await keychain.store(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key.toString("hex"));

    // Store the salt in the database
    db.run(
      "INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES ('master_salt', ?, unixepoch())",
      [salt.toString("hex")],
    );

    return key;
  }

  // Passphrase mode — prompt user
  const passphrase = prompt("Enter vault passphrase: ");
  if (!passphrase) {
    console.error("Passphrase is required.");
    process.exit(1);
  }

  // Check for stored salt
  const saltRow = db
    .query<{ value: string }, []>("SELECT value FROM vault_meta WHERE key = 'master_salt'")
    .get();

  if (saltRow) {
    const salt = Buffer.from(saltRow.value, "hex");
    const { key } = await deriveMasterKey(passphrase, salt);
    return key;
  }

  // First time with passphrase
  const { key, salt } = await deriveMasterKey(passphrase);
  db.run(
    "INSERT OR REPLACE INTO vault_meta (key, value, updated_at) VALUES ('master_salt', ?, unixepoch())",
    [salt.toString("hex")],
  );

  return key;
}

function prompt(message: string): string | null {
  process.stdout.write(message);
  // Bun supports synchronous stdin reading
  const buf = new Uint8Array(1024);
  const n = require("node:fs").readSync(0, buf);
  return new TextDecoder().decode(buf.subarray(0, n)).trim() || null;
}
