# Provider API v1

CloakEnv exposes a desktop-owned local provider over:

- Unix: `~/.config/cloakenv/provider.sock`
- Windows: `\\\\.\\pipe\\cloakenv-provider`

`CLOAKENV_PROVIDER_ENDPOINT` overrides the endpoint. `CLOAKENV_APPROVAL_BROKER_ENDPOINT` is still accepted as a compatibility fallback during the broker-to-provider transition.

## Transport

- One request per connection
- Newline-delimited JSON messages
- Replay protection is enforced by single-use request IDs inside the desktop service

Every provider message is versioned:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "request",
  "request": {
    "kind": "resolve_environment",
    "requestId": "2f5f9b0d-0b69-4d53-b768-3be8d14d2367",
    "cwd": "/workspace/app",
    "projectName": "app",
    "scope": ".env.local"
  }
}
```

## Requests

### `status`

Use this for diagnostics surfaces such as `cloakenv provider status` or the desktop provider control room.

Request fields:

- `kind`: `"status"`
- `requestId`: client-generated unique ID

Success response:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "response",
  "requestId": "status_1",
  "ok": true,
  "data": {
    "reachable": true,
    "mode": "desktop",
    "approvalMode": "native",
    "endpoint": "/Users/me/.config/cloakenv/provider.sock",
    "endpointSource": "default",
    "transport": "unix_socket",
    "authMode": "keychain",
    "desktopSensitiveAvailable": true,
    "providerSessionTtlMinutes": 15,
    "activeSessionCount": 1,
    "activeSessions": []
  }
}
```

Active session entries include stable session ids so operators can explicitly expire one lease without waiting for TTL expiry.

### `expire_session`

Use this to invalidate one live provider session or clear all of them.

Request fields:

- `kind`: `"expire_session"`
- `requestId`: client-generated unique ID
- `sessionId`: optional session id to invalidate
- `all`: optional boolean; when `true`, all live sessions are invalidated

Success response:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "response",
  "requestId": "expire_1",
  "ok": true,
  "data": {
    "expired": 1,
    "remaining": 0,
    "expiredSessionId": "session_123"
  }
}
```

### `resolve_environment`

Use this when a runtime needs an approved env map without asking CloakEnv to spawn the child process.

Request fields:

- `kind`: `"resolve_environment"`
- `requestId`: client-generated unique ID
- `cwd`: requester working directory
- `projectName`: optional explicit project override
- `scope`: optional scope/environment name; when omitted, CloakEnv resolves the project's configured default scope (which starts as `default`)
- `requester`: optional process metadata `{ processName, processPid, argv, hasTty }`

When `providerSessionTtlMinutes` is greater than zero, CloakEnv may reuse an already approved session for a matching requester fingerprint instead of prompting again. Matching stays pinned to the same project, scope, working directory, process name, and argv.

Success response:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "response",
  "requestId": "2f5f9b0d-0b69-4d53-b768-3be8d14d2367",
  "ok": true,
  "data": {
    "projectId": "proj_123",
    "projectName": "app",
    "env": {
      "API_KEY": "sk_live_123"
    }
  }
}
```

### `run_process`

Use this when CloakEnv should remain the thin reference client that spawns the approved process.

Request fields:

- All `resolve_environment` fields
- `kind`: `"run_process"`
- `argv`: command and arguments to execute

The server first sends a successful `response`, then emits process lifecycle messages:

```json
{"protocol":"cloakenv-provider","version":1,"type":"response","requestId":"req_1","ok":true,"data":{"projectId":"proj_123","projectName":"app","env":{"API_KEY":"sk_live_123"}}}
{"protocol":"cloakenv-provider","version":1,"type":"run_started","requestId":"req_1"}
{"protocol":"cloakenv-provider","version":1,"type":"stdout","requestId":"req_1","chunk":"ready\n"}
{"protocol":"cloakenv-provider","version":1,"type":"run_exit","requestId":"req_1","exitCode":0,"signal":null}
```

Clients may send:

- `stdin`
- `stdin_end`
- `signal`

using the same `protocol`, `version`, and `requestId`.

Because the provider owns the child process, its stdio bridge, and the request socket, a `run_process` child is expected to stop when that provider-owned session ends.

## Errors

Failures return:

```json
{
  "protocol": "cloakenv-provider",
  "version": 1,
  "type": "response",
  "requestId": "req_1",
  "ok": false,
  "error": {
    "code": "approval_denied",
    "message": "Access was denied."
  }
}
```

Common codes include `approval_denied`, `no_secrets`, `spawn_failed`, `project_not_found`, and `auth_mode_unsupported`.

## Compatibility

- `cloakenv run` now uses provider v1 through `resolve_environment`, then launches the approved command locally.
- `cloakenv provider status` and `cloakenv provider expire` use the same socket contract for diagnostics and session invalidation.
- Legacy broker-style requests for `get`, `history`, `list_values`, and `export` remain accepted on the same endpoint during migration.
- Non-Node clients only need a local socket client plus JSON framing; no Bun or Node-specific runtime hooks are required.
- See [provider-client-contract.md](./provider-client-contract.md) for adapter guidance and foreground-provider expectations.
