import type { KeychainProvider } from "./types";

/**
 * In-memory keychain provider for testing and CI environments.
 */
export class MemoryKeychain implements KeychainProvider {
  private data = new Map<string, string>();

  private makeKey(service: string, account: string): string {
    return `${service}:${account}`;
  }

  async store(service: string, account: string, secret: string): Promise<void> {
    this.data.set(this.makeKey(service, account), secret);
  }

  async retrieve(service: string, account: string): Promise<string | null> {
    return this.data.get(this.makeKey(service, account)) ?? null;
  }

  async remove(service: string, account: string): Promise<void> {
    this.data.delete(this.makeKey(service, account));
  }

  clear(): void {
    this.data.clear();
  }
}
