export interface CloakedFileHeader {
  magic: Buffer; // "CLKD" (4 bytes)
  version: number; // Format version (1 byte)
  flags: number; // Bit 0: 0=single project, 1=full vault (1 byte)
  salt: Buffer; // Argon2id salt (32 bytes)
  memoryCost: number; // Argon2id memory cost (4 bytes, uint32 BE)
  timeCost: number; // Argon2id time cost (4 bytes, uint32 BE)
  iv: Buffer; // Payload IV (12 bytes)
  payloadLength: number; // Encrypted payload length (4 bytes, uint32 BE)
}

export interface CloakedPayload {
  version: number;
  exportedAt: number;
  projects: CloakedProject[];
}

export interface CloakedProject {
  name: string;
  path: string | null;
  environments?: CloakedEnvironment[];
  schemaEntries?: CloakedSchemaEntry[];
  secrets: CloakedSecret[];
}

export interface CloakedEnvironment {
  name: string;
  sourceFile: string | null;
  sourceKind: "imported" | "manual";
}

export interface CloakedSecret {
  key: string;
  value: string;
  scope: string;
}

export interface CloakedSchemaEntry {
  key: string;
  scope: string;
  schema?: {
    typeName: string | null;
    typeParams: Record<string, string> | null;
    sensitive: boolean;
    required: boolean;
    description: string | null;
    example: string | null;
    docsUrls?: string[];
    defaultValue?: string | null;
  };
}

export const DEFAULT_CLOAKED_BACKUP_FILENAME = "vault.env.cloaked";
export const CLOAKED_MAGIC = Buffer.from("CLKD", "ascii");
export const CLOAKED_FORMAT_VERSION = 2;
export const CLOAKED_HEADER_SIZE = 62; // 4+1+1+32+4+4+12+4
