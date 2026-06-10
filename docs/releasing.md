# Releasing

This document covers what needs to be in place before we ship signed,
notarized installers to end users — see AUDIT-CODEX.md long-term #5
("Add release signing/notarization, SBOM generation, and dependency
provenance checks before public installers").

For day-to-day local builds, `pnpm --filter desktop package:dir`
produces an unsigned-but-fused application bundle under `apps/desktop/release/`.
This file is about the production pipeline.

## What's already wired

- **Electron fuses.** `apps/desktop/build/flip-fuses.cjs` runs as an
  electron-builder `afterPack` hook on every package. The packaged binary
  refuses `ELECTRON_RUN_AS_NODE`, refuses `--inspect[-brk]`, refuses
  `NODE_OPTIONS`, validates the ASAR integrity header, and asks
  safeStorage to encrypt cookies at rest.
- **CSP.** Production builds serve a strict Content-Security-Policy via
  `session.webRequest.onHeadersReceived` (`script-src 'self'`, no eval,
  no remote origins).
- **SBOM.** `pnpm sbom` writes `sbom.cdx.json` (CycloneDX 1.6, ~1,000
  components). CI uploads it as an artifact on every build; the release
  workflow attaches it to the GitHub Release.
- **Hardened runtime.** `apps/desktop/electron-builder.json`'s `mac`
  block sets `hardenedRuntime: true` with the minimal entitlements in
  `apps/desktop/build/entitlements.mac.plist`.

## What you still need to set up

These are external artifacts — Apple, Microsoft, or your CA — and can't
land via a code PR.

### macOS code signing + notarization

1. **Apple Developer ID Application certificate.** Get one from
   https://developer.apple.com/account/resources/certificates. Export
   the cert + private key from Keychain as a `.p12` and base64-encode
   it for GitHub Actions:
   ```
   base64 -i Certificates.p12 -o Certificates.b64
   ```
2. **App-specific password.** From https://appleid.apple.com → Sign-In
   and Security → App-Specific Passwords. Required for the
   notarytool API.
3. **Team ID.** A 10-character string from the Apple Developer membership
   page.

Drop these into the repo's GitHub Actions secrets:

| Secret | What it is |
|---|---|
| `APPLE_API_KEY_BASE64` | the base64'd `.p12` from step 1 |
| `APPLE_API_KEY_PASSWORD` | the password protecting that `.p12` |
| `APPLE_ID` | the email on your developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | the password from step 2 |
| `APPLE_TEAM_ID` | the team ID from step 3 |
| `PERSPECTIVES_NOTARIZE` | `1` (set as a regular env var, not a secret) |

The release workflow imports the `.p12` into the keychain, sets the
`CSC_*` env vars electron-builder expects, and runs
`pnpm --filter desktop package`. The `afterSign` hook in
[`build/notarize.cjs`](../apps/desktop/build/notarize.cjs) handles the
notarytool submission.

### Windows Authenticode

1. **EV or OV code-signing certificate.** From any of the usual CAs
   (DigiCert, Sectigo, SSL.com). EV certs avoid the SmartScreen
   reputation penalty.
2. **Cert + password as secrets**:

| Secret | What it is |
|---|---|
| `WINDOWS_CERT_BASE64` | the base64'd `.pfx` |
| `WINDOWS_CERT_PASSWORD` | the cert password |

The release workflow drops the cert to disk, sets `CSC_LINK` and
`CSC_KEY_PASSWORD`, and electron-builder picks them up.

### Linux

AppImage doesn't have a centralized signing model. We GPG-detach-sign
the file and publish the public key on the release page; users can
optionally verify via:

```
gpg --verify Perspectives-0.x.y.AppImage.sig Perspectives-0.x.y.AppImage
```

| Secret | What it is |
|---|---|
| `LINUX_GPG_PRIVATE_KEY` | ASCII-armored private key |
| `LINUX_GPG_PASSPHRASE` | passphrase |

## Release workflow (sketch)

A `release.yml` workflow doesn't exist yet — Phase 9 owns that. The
sketch:

```yaml
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      # Per-OS signing setup (decrypt cert from secrets, place on disk).
      - if: matrix.os == 'macos-latest'
        run: |
          echo "$APPLE_API_KEY_BASE64" | base64 -d > apple.p12
          security create-keychain -p ci build.keychain
          security import apple.p12 -k build.keychain -P "$APPLE_API_KEY_PASSWORD"
        env:
          APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
          APPLE_API_KEY_PASSWORD: ${{ secrets.APPLE_API_KEY_PASSWORD }}
      - run: pnpm --filter desktop package
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          PERSPECTIVES_NOTARIZE: "1"
      - run: pnpm sbom
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            apps/desktop/release/**/*.dmg
            apps/desktop/release/**/*.exe
            apps/desktop/release/**/*.AppImage
            sbom.cdx.json
```

The workflow doesn't live in the repo today because:
1. We have no certs to populate the secrets, so any release run would
   fail loud on the first matrix entry.
2. The release process needs human approval gates before the first
   public installer — adding the YAML and the protected environment
   together is Phase 9 work.

## Dependency provenance

- **Renovate / Dependabot** monitors npm + GitHub Actions for updates.
  We've already wired GHA action SHA pinning (`actions/checkout@v4`,
  etc.). Renovate is the preferred runner — broader ecosystem support
  than Dependabot and configurable conflict-resolution.
- **`pnpm audit --audit-level=high`** runs in CI on every PR. The
  long-term target is `--audit-level=moderate` after closing the
  short-term findings.
- **CycloneDX SBOM** ships with each release. Dependency-Track,
  GitHub's Dependency Submission API, and Trivy all consume the JSON
  format we emit.
- **Pinned action SHAs.** When we add the release workflow, every
  `uses:` line should reference a SHA, not a tag. The audit recommends
  this; tooling like `pin-github-action` automates the rewrite.

## Cross-references

- [docs/security.md](security.md) — broader threat model and trust
  boundaries
- [AUDIT-CODEX.md](../AUDIT-CODEX.md) — the security audit driving
  these requirements
- [apps/desktop/build/flip-fuses.cjs](../apps/desktop/build/flip-fuses.cjs)
  — Electron fuse configuration
- [apps/desktop/build/notarize.cjs](../apps/desktop/build/notarize.cjs)
  — macOS notarization hook
- [apps/desktop/build/entitlements.mac.plist](../apps/desktop/build/entitlements.mac.plist)
  — macOS entitlements
- [tools/generate-sbom.mjs](../tools/generate-sbom.mjs) — SBOM generator
