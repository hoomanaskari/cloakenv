export interface Project {
  id: string;
  name: string;
  path: string | null;
  gitRemote: string | null;
  description: string | null;
  defaultScope: string;
  defaultCliVisibility: ScopeAccessMode;
  defaultAdapterVisibility: ScopeAccessMode;
  salt: Buffer;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Secret {
  id: string;
  projectId: string;
  keyHash: Buffer;
  keyEnc: Buffer;
  keyIv: Buffer;
  keyTag: Buffer;
  valueEnc: Buffer;
  valueIv: Buffer;
  valueTag: Buffer;
  scope: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface DecryptedSecret {
  id: string;
  projectId: string;
  key: string;
  value: string;
  scope: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  sourceFile: string | null;
  sourceKind: "imported" | "manual";
  createdAt: number;
  updatedAt: number;
}

export type ScopeAccessMode = "allow" | "deny";

export interface ScopePolicy {
  id: string;
  projectId: string;
  scope: string;
  cliVisibility: ScopeAccessMode | null;
  adapterVisibility: ScopeAccessMode | null;
  createdAt: number;
  updatedAt: number;
}

export interface SecretHistory {
  id: string;
  secretId: string;
  value: string;
  version: number;
  createdAt: number;
}
