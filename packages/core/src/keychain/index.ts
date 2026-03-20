import { platform } from "node:os";
import { LinuxKeychain } from "./linux";
import { MacOSKeychain } from "./macos";
import { MemoryKeychain } from "./memory";
import type { KeychainProvider } from "./types";
import { WindowsKeychain } from "./windows";

export type { KeychainProvider };
export { MacOSKeychain, LinuxKeychain, WindowsKeychain, MemoryKeychain };
export { AUTO_BACKUP_PASSPHRASE_ACCOUNT, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from "./types";

let _provider: KeychainProvider | null = null;

export function getKeychainProvider(): KeychainProvider {
  if (_provider) return _provider;

  switch (platform()) {
    case "darwin":
      _provider = new MacOSKeychain();
      break;
    case "linux":
      _provider = new LinuxKeychain();
      break;
    case "win32":
      _provider = new WindowsKeychain();
      break;
    default:
      _provider = new MemoryKeychain();
      break;
  }

  return _provider;
}

export function setKeychainProvider(provider: KeychainProvider): void {
  _provider = provider;
}
