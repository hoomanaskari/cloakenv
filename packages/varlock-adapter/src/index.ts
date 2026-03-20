import {
  type BrokerRequesterInfo,
  getProcessContext,
  resolveProviderEnvironment,
} from "@cloakenv/core";

export interface PrepareVarlockEnvironmentOptions {
  cwd?: string;
  injectIntoProcessEnv?: boolean;
  projectName?: string;
  requestId?: string;
  requester?: Partial<BrokerRequesterInfo>;
  scope?: string;
}

export interface PreparedVarlockEnvironment {
  env: Record<string, string>;
  projectId: string;
  projectName: string;
  requester: BrokerRequesterInfo;
}

export async function prepareVarlockEnvironment(
  options: PrepareVarlockEnvironmentOptions = {},
): Promise<PreparedVarlockEnvironment> {
  const requester = buildRequester(options.requester);
  const result = await resolveProviderEnvironment({
    kind: "resolve_environment",
    requestId: options.requestId ?? crypto.randomUUID(),
    projectName: options.projectName,
    cwd: options.cwd ?? process.cwd(),
    requester,
    scope: options.scope,
  });

  if (options.injectIntoProcessEnv !== false) {
    for (const [key, value] of Object.entries(result.env)) {
      process.env[key] = value;
    }
  }

  return {
    ...result,
    requester,
  };
}

export async function withVarlockEnvironment<T>(
  callback: (prepared: PreparedVarlockEnvironment) => Promise<T> | T,
  options: PrepareVarlockEnvironmentOptions = {},
): Promise<T> {
  const prepared = await prepareVarlockEnvironment(options);
  return callback(prepared);
}

function buildRequester(override?: Partial<BrokerRequesterInfo>): BrokerRequesterInfo {
  const context = getProcessContext();
  return {
    processName: override?.processName ?? context.processName,
    processPid: override?.processPid ?? context.processPid,
    argv: override?.argv ?? context.argv,
    hasTty: override?.hasTty ?? context.hasTty,
  };
}
