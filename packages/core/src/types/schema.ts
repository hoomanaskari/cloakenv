export interface EnvSpecRootDecorators {
  defaultSensitive?: boolean;
  defaultRequired?: "infer" | boolean;
  currentEnv?: string;
}

export interface EnvSpecEntry {
  key: string;
  defaultValue: string | null;
  description: string | null;
  type: EnvSpecType | null;
  sensitive: boolean | null;
  required: boolean | null;
  example: string | null;
  docsUrls: string[];
}

export interface EnvSpecType {
  name: string;
  params: Record<string, string>;
}

export interface ParsedEnvSpec {
  rootDecorators: EnvSpecRootDecorators;
  entries: EnvSpecEntry[];
}

export interface SchemaMetadata {
  id: string;
  projectId: string;
  key: string;
  scope: string;
  typeName: string | null;
  typeParams: Record<string, string> | null;
  sensitive: boolean;
  required: boolean;
  description: string | null;
  example: string | null;
  docsUrls: string[];
  defaultValue: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SchemaDiffType = "missing" | "extra" | "changed";

export interface SchemaDiffEntry {
  key: string;
  scope: string;
  type: SchemaDiffType;
  details?: string;
}
