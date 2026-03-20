export const PROVIDER_PROTOCOL = "cloakenv-provider";
export const PROVIDER_PROTOCOL_VERSION = 1;

export type SensitiveAction =
  | "get"
  | "history"
  | "list_values"
  | "resolve_environment"
  | "run"
  | "export"
  | "export_plaintext";

export interface BrokerRequesterInfo {
  processName: string;
  processPid: number;
  argv: string[];
  hasTty: boolean;
}

export interface BrokerRequestBase {
  requestId: string;
  projectName?: string;
  cwd: string;
  requester?: BrokerRequesterInfo;
}

export interface GetSecretBrokerRequest extends BrokerRequestBase {
  kind: "get";
  key: string;
  scope?: string;
}

export interface GetHistoryBrokerRequest extends BrokerRequestBase {
  kind: "history";
  key: string;
  scope?: string;
  limit: number;
}

export interface ListValuesBrokerRequest extends BrokerRequestBase {
  kind: "list_values";
  scope?: string;
}

export interface RunBrokerRequest extends BrokerRequestBase {
  kind: "run";
  scope?: string;
  argv: string[];
  launcherPath?: string;
}

export interface ExportBrokerRequest extends BrokerRequestBase {
  kind: "export";
  outputPath: string;
  passphrase: string;
}

export type BrokerRequest =
  | ExportBrokerRequest
  | GetHistoryBrokerRequest
  | GetSecretBrokerRequest
  | ListValuesBrokerRequest
  | RunBrokerRequest;

export interface BrokerSuccessResponse<T = unknown> {
  type: "response";
  requestId: string;
  ok: true;
  data: T;
}

export interface BrokerErrorResponse {
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface BrokerStdoutMessage {
  type: "stdout";
  requestId: string;
  chunk: string;
}

export interface BrokerStderrMessage {
  type: "stderr";
  requestId: string;
  chunk: string;
}

export interface BrokerRunExitMessage {
  type: "run_exit";
  requestId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface BrokerRunStartedMessage {
  type: "run_started";
  requestId: string;
}

export type BrokerServerMessage =
  | BrokerErrorResponse
  | BrokerRunExitMessage
  | BrokerRunStartedMessage
  | BrokerStdoutMessage
  | BrokerStderrMessage
  | BrokerSuccessResponse;

export interface BrokerClientRequestEnvelope {
  type: "request";
  request: BrokerRequest;
}

export interface BrokerStdinMessage {
  type: "stdin";
  requestId: string;
  chunk: string;
}

export interface BrokerStdinEndMessage {
  type: "stdin_end";
  requestId: string;
}

export interface BrokerSignalMessage {
  type: "signal";
  requestId: string;
  signal: NodeJS.Signals;
}

export type BrokerClientMessage =
  | BrokerClientRequestEnvelope
  | BrokerSignalMessage
  | BrokerStdinEndMessage
  | BrokerStdinMessage;

export interface ProviderRequestBase extends BrokerRequestBase {
  scope?: string;
}

export interface ResolveEnvironmentProviderRequest extends ProviderRequestBase {
  kind: "resolve_environment";
}

export interface RunProcessProviderRequest extends ProviderRequestBase {
  kind: "run_process";
  argv: string[];
  launcherPath?: string;
}

export interface ProviderStatusRequest {
  kind: "status";
  requestId: string;
}

export interface ExpireProviderSessionRequest {
  kind: "expire_session";
  requestId: string;
  sessionId?: string;
  all?: boolean;
}

export type ProviderRequest =
  | ExpireProviderSessionRequest
  | ProviderStatusRequest
  | ResolveEnvironmentProviderRequest
  | RunProcessProviderRequest;

export interface ProviderRequestEnvelope {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "request";
  request: ProviderRequest;
}

export interface ProviderSuccessResponse<T = unknown> {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "response";
  requestId: string;
  ok: true;
  data: T;
}

export interface ProviderErrorResponse {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "response";
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ProviderRunStartedMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "run_started";
  requestId: string;
}

export interface ProviderStdoutMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "stdout";
  requestId: string;
  chunk: string;
}

export interface ProviderStderrMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "stderr";
  requestId: string;
  chunk: string;
}

export interface ProviderRunExitMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "run_exit";
  requestId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export type ProviderServerMessage =
  | ProviderErrorResponse
  | ProviderRunExitMessage
  | ProviderRunStartedMessage
  | ProviderStdoutMessage
  | ProviderStderrMessage
  | ProviderSuccessResponse;

export interface ProviderStdinMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "stdin";
  requestId: string;
  chunk: string;
}

export interface ProviderStdinEndMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "stdin_end";
  requestId: string;
}

export interface ProviderSignalMessage {
  protocol: typeof PROVIDER_PROTOCOL;
  version: typeof PROVIDER_PROTOCOL_VERSION;
  type: "signal";
  requestId: string;
  signal: NodeJS.Signals;
}

export type ProviderClientMessage =
  | ProviderRequestEnvelope
  | ProviderSignalMessage
  | ProviderStdinEndMessage
  | ProviderStdinMessage;
