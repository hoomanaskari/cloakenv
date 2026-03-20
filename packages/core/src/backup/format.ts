import {
  CLOAKED_FORMAT_VERSION,
  CLOAKED_HEADER_SIZE,
  CLOAKED_MAGIC,
  type CloakedFileHeader,
} from "../types/backup";

/**
 * Serialize the .cloaked file header to a Buffer.
 */
export function serializeHeader(header: CloakedFileHeader): Buffer {
  const buf = Buffer.alloc(CLOAKED_HEADER_SIZE);
  let offset = 0;

  header.magic.copy(buf, offset);
  offset += 4;

  buf.writeUInt8(header.version, offset);
  offset += 1;

  buf.writeUInt8(header.flags, offset);
  offset += 1;

  header.salt.copy(buf, offset);
  offset += 32;

  buf.writeUInt32BE(header.memoryCost, offset);
  offset += 4;

  buf.writeUInt32BE(header.timeCost, offset);
  offset += 4;

  header.iv.copy(buf, offset);
  offset += 12;

  buf.writeUInt32BE(header.payloadLength, offset);

  return buf;
}

/**
 * Parse the .cloaked file header from a Buffer.
 */
export function parseHeader(buf: Buffer): CloakedFileHeader {
  if (buf.length < CLOAKED_HEADER_SIZE) {
    throw new Error(`Invalid .cloaked file: header too short (${buf.length} bytes)`);
  }

  let offset = 0;

  const magic = buf.subarray(offset, offset + 4);
  offset += 4;

  if (!magic.equals(CLOAKED_MAGIC)) {
    throw new Error("Invalid .cloaked file: bad magic bytes");
  }

  const version = buf.readUInt8(offset);
  offset += 1;

  if (version > CLOAKED_FORMAT_VERSION) {
    throw new Error(
      `Unsupported .cloaked format version ${version} (max supported: ${CLOAKED_FORMAT_VERSION})`,
    );
  }

  const flags = buf.readUInt8(offset);
  offset += 1;

  const salt = Buffer.from(buf.subarray(offset, offset + 32));
  offset += 32;

  const memoryCost = buf.readUInt32BE(offset);
  offset += 4;

  const timeCost = buf.readUInt32BE(offset);
  offset += 4;

  const iv = Buffer.from(buf.subarray(offset, offset + 12));
  offset += 12;

  const payloadLength = buf.readUInt32BE(offset);

  return {
    magic,
    version,
    flags,
    salt,
    memoryCost,
    timeCost,
    iv,
    payloadLength,
  };
}
