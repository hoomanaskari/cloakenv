# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Overview

CloakEnv is a local-first desktop app and CLI for encrypted developer secrets. The desktop app is built with ElectroBun, and release artifacts are published through GitHub Releases.

## Important Notes

- Never use em dashes in repository content or agent responses.
- Do not keep probing the Keychain if signing or notarization is not already configured. Ask the user instead.
- Do not publish macOS release assets unless they pass Apple distribution validation.

## Release Checklist

Use this exact order for stable releases so macOS signing, notarization, direct GitHub installs, and in-app updates all keep working.

### 1. Bump versions first

Update the version in:

- `/Users/hooman/Sites/cloakenv/package.json`
- `/Users/hooman/Sites/cloakenv/apps/cli/package.json`
- `/Users/hooman/Sites/cloakenv/packages/core/package.json`
- `/Users/hooman/Sites/cloakenv/packages/varlock-adapter/package.json`
- `/Users/hooman/Sites/cloakenv/packages/varlock-helper/package.json`

Commit the release prep before tagging.

### 2. Build the signed macOS release locally before pushing the tag

This must happen before pushing `vX.Y.Z`, otherwise patch generation may not use the previous stable macOS release as the base.

Required local configuration:

- Signing identity: `Developer ID Application: Pixel Forty Inc. (2SQ9JNU8XE)`
- Notary keychain profile: `cloakenv-notary`
- Team ID: `2SQ9JNU8XE`

Run:

```bash
CLOAKENV_MACOS_SIGN_IDENTITY='Developer ID Application: Pixel Forty Inc. (2SQ9JNU8XE)' \
CLOAKENV_MACOS_NOTARY_PROFILE='cloakenv-notary' \
CLOAKENV_MACOS_TEAM_ID='2SQ9JNU8XE' \
bun run release:build
```

Notes:

- `src/scripts/release-build.ts` injects the GitHub release feed URL automatically.
- `src/scripts/bin/xcrun` rewrites ElectroBun notarytool calls to use the stored keychain profile.
- `src/scripts/embed-cli.ts` signs the bundled CLI before it is embedded into the app bundle.

### 3. Validate the local macOS artifacts

The release is not ready unless both checks pass.

Validate the updater bundle:

```bash
tmpdir=$(mktemp -d)
zstd -dc artifacts/stable-macos-arm64-CloakEnv.app.tar.zst | tar -xf - -C "$tmpdir"
syspolicy_check distribution "$tmpdir/CloakEnv.app"
rm -rf "$tmpdir"
```

Validate the DMG install path:

```bash
tmpdir=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$tmpdir/mnt" artifacts/stable-macos-arm64-CloakEnv.dmg >/dev/null 2>&1
syspolicy_check distribution "$tmpdir/mnt/CloakEnv.app"
hdiutil detach "$tmpdir/mnt" >/dev/null 2>&1
rm -rf "$tmpdir"
```

### 4. Push `main`, then tag and push the release

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

The GitHub Actions `Release` workflow builds and publishes Windows and Linux assets.

### 5. Wait for the GitHub release to exist, then upload macOS assets

After the `Release` workflow finishes:

```bash
bun run release:upload:macos -- vX.Y.Z
```

This upload command will refuse to publish macOS artifacts if:

- the packaged app does not contain an updater release feed URL
- `syspolicy_check distribution` fails for the updater bundle
- `syspolicy_check distribution` fails for the app mounted from the DMG

### 6. Verify the final GitHub release

```bash
gh release view vX.Y.Z --json assets,body,url
```

Confirm that the release includes:

- Windows assets from GitHub Actions
- Linux assets from GitHub Actions
- macOS `.dmg`
- macOS `.app.tar.zst`
- macOS `update.json`
- macOS patch file, when one is generated
- `cloakenv-darwin-arm64`

## macOS Distribution Rules

- Direct GitHub installs use the macOS DMG and must pass Apple distribution checks.
- In-app updates use `stable-macos-arm64-CloakEnv.app.tar.zst` and `stable-macos-arm64-update.json`, not the DMG.
- A build that updates correctly from inside the app can still fail as a fresh GitHub DMG install if it is not signed, notarized, and stapled correctly.
- Never publish ad hoc signed or unstapled macOS artifacts to GitHub.
- Prefer a new patch release like `1.0.6` over silently replacing broken macOS assets in an already published version.
