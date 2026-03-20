// Crypto

export {
  invokeApprovalBrokerRequest,
  normalizeApprovalBrokerConnectionError,
  runApprovalBrokerCommand,
} from "./approval/broker-client";
export {
  expireProviderSession,
  getProviderStatus,
  normalizeProviderConnectionError,
  resolveProviderEnvironment,
  runProviderCommand,
} from "./approval/client";
export {
  getApprovalBrokerEndpoint,
  getProviderEndpoint,
  getProviderEndpointInfo,
} from "./approval/path";
export type * from "./approval/protocol";
export { PROVIDER_PROTOCOL, PROVIDER_PROTOCOL_VERSION } from "./approval/protocol";
// Backup
export {
  DEFAULT_CLOAKED_BACKUP_FILENAME,
  exportVault,
  importVault,
  triggerAutoBackup,
} from "./backup";
export {
  decrypt,
  deriveMasterKey,
  deriveProjectKey,
  encrypt,
  generateId,
  generateIv,
  generateSalt,
  hmacKey,
} from "./crypto";

// Keychain
export {
  AUTO_BACKUP_PASSPHRASE_ACCOUNT,
  getKeychainProvider,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  MemoryKeychain,
  setKeychainProvider,
} from "./keychain";
// Passphrase
export { checkPwnedPassphrase, evaluatePassphrase, generatePassphrase } from "./passphrase";

// Process
export { createSpawnEnvironment, getProcessContext, spawnWithSecrets } from "./process";
// Project
export { detectProject, ProjectManager } from "./project";
// Schema
export {
  bootstrapSecretsFromSchema,
  diffSchema,
  findSchemaEntry,
  parseEnvSpec,
  resolveSchemaEntry,
  serializeEnvSpec,
  storedSchemaToResolvedEntry,
  upsertSchemaMetadataFromEntry,
  validateValue,
  validateValueAgainstSchemaEntry,
} from "./schema";
// Types
export type * from "./types";
// Vault
export {
  AuditRepository,
  ConfigRepository,
  closeDatabase,
  EnvironmentRepository,
  getDatabase,
  ProjectRepository,
  resetDatabaseSingleton,
  SchemaRepository,
  ScopePolicyRepository,
  SecretRepository,
} from "./vault";
