export const ALGORITHM = "aes-256-gcm" as const;
export const IV_LENGTH = 12; // 96 bits — NIST recommendation for GCM
export const TAG_LENGTH = 16; // 128 bits
export const KEY_LENGTH = 32; // 256 bits
export const SALT_LENGTH = 32; // 256 bits
export const HMAC_ALGORITHM = "sha256" as const;

// scrypt parameters: N=16384 (2^14), r=8, p=1
// Memory usage: 128 * N * r = 128 * 16384 * 8 = 16 MB
// This is OWASP-recommended for interactive use
export const KDF_DEFAULTS = {
  memoryCost: 16384, // N parameter (must be power of 2)
  timeCost: 1, // Not used by scrypt directly, kept for interface compat
  parallelism: 1, // p parameter
} as const;

/** @deprecated Use KDF_DEFAULTS instead */
export const ARGON2_DEFAULTS = KDF_DEFAULTS;

export const HKDF_INFO = {
  masterKey: "cloakenv-master-key-v1",
  projectKey: "cloakenv-project-key-v1",
} as const;
