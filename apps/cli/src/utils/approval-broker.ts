import {
  invokeApprovalBrokerRequest,
  type BrokerRequest,
  type RunBrokerRequest,
  runApprovalBrokerCommand,
} from "@cloakenv/core";

export function formatSensitiveRequestError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  switch (code) {
    case "approval_denied":
      return "Request denied in CloakEnv desktop.";
    case "auth_mode_unsupported":
      return `${error.message} Switch to keychain auth for desktop-mediated access, or run \`cloakenv provider start\` for foreground approvals.`;
    case "desktop_not_ready":
    case "dialog_unavailable":
    case "secret_not_found":
    case "no_secrets":
    case "spawn_failed":
    case "request_replayed":
    case "request_already_bound":
    case "request_mismatch":
    case "invalid_message":
    case "request_failed":
      return error.message;
    default:
      return error.message;
  }
}

export async function invokeSensitiveRequest<T>(request: BrokerRequest): Promise<T> {
  return invokeApprovalBrokerRequest<T>(request);
}

export async function runSensitiveCommand(request: RunBrokerRequest): Promise<number> {
  return runApprovalBrokerCommand(request);
}
