import { join } from "node:path";
import { VAULT_DIR } from "../vault/database";

const WINDOWS_PROVIDER_PIPE = "\\\\.\\pipe\\cloakenv-provider";
const PROVIDER_ENDPOINT_ENV_VAR = "CLOAKENV_PROVIDER_ENDPOINT";
const BROKER_ENDPOINT_ENV_VAR = "CLOAKENV_APPROVAL_BROKER_ENDPOINT";

export interface ProviderEndpointInfo {
  endpoint: string;
  source: "default" | "env";
  transport: "named_pipe" | "unix_socket";
}

export function getProviderEndpointInfo(): ProviderEndpointInfo {
  const override = process.env[PROVIDER_ENDPOINT_ENV_VAR] ?? process.env[BROKER_ENDPOINT_ENV_VAR];
  if (override) {
    return {
      endpoint: override,
      source: "env",
      transport: process.platform === "win32" ? "named_pipe" : "unix_socket",
    };
  }

  if (process.platform === "win32") {
    return {
      endpoint: WINDOWS_PROVIDER_PIPE,
      source: "default",
      transport: "named_pipe",
    };
  }

  return {
    endpoint: join(VAULT_DIR, "provider.sock"),
    source: "default",
    transport: "unix_socket",
  };
}

export function getProviderEndpoint(): string {
  return getProviderEndpointInfo().endpoint;
}

export function getApprovalBrokerEndpoint(): string {
  return getProviderEndpoint();
}
