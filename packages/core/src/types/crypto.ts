export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer; // 12 bytes (96-bit, NIST recommendation for GCM)
  tag: Buffer; // 16 bytes (128-bit GCM auth tag)
}

export interface DerivedKey {
  key: Buffer; // 32 bytes (AES-256)
  salt: Buffer; // 32 bytes
}

export interface KeyDerivationParams {
  memoryCost: number; // kibibytes (default: 65536 = 64MB)
  timeCost: number; // iterations (default: 3)
  parallelism: number; // threads (default: 4)
}
