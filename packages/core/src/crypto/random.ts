import { randomBytes, randomUUID } from "node:crypto";
import { IV_LENGTH, SALT_LENGTH } from "./constants";

export function generateIv(): Buffer {
  return randomBytes(IV_LENGTH);
}

export function generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH);
}

export function generateId(): string {
  return randomUUID();
}

export function randomBytesBuffer(length: number): Buffer {
  return randomBytes(length);
}
