export function prompt(message: string): string | null {
  process.stdout.write(message);

  try {
    const buf = new Uint8Array(1024);
    const n = require("node:fs").readSync(0, buf);
    return new TextDecoder().decode(buf.subarray(0, n)).trim() || null;
  } catch {
    return null;
  }
}

export function confirm(message: string, defaultValue = true): boolean {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const response = prompt(`${message}${suffix}`);

  if (!response) {
    return defaultValue;
  }

  const normalized = response.trim().toLowerCase();
  if (["y", "yes"].includes(normalized)) {
    return true;
  }

  if (["n", "no"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}
