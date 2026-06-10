#!/usr/bin/env node
// @ts-check
/**
 * Generate a CycloneDX SBOM for the workspace.
 *
 * Why this exists: see AUDIT-CODEX.md long-term #5 — every release needs
 * a dependency manifest the user (and the ecosystem's supply-chain tools)
 * can read. CycloneDX is the most widely-supported format.
 *
 * Tooling choice: `@cyclonedx/cdxgen`. We previously tried
 * `@cyclonedx/cyclonedx-npm` but it shells out to npm/pnpm commands that
 * don't exist on pnpm 10. cdxgen walks the workspace itself.
 *
 * Output: `sbom.cdx.json` at the repo root. cdxgen v12 emits JSON
 * regardless of the requested extension — the JSON format is what
 * Dependency-Track, Trivy, Grype, Syft, and GitHub Dependency Submission
 * all accept. The XML variant a few legacy tools still need is a
 * 30-second `cyclonedx convert` away from the JSON.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const OUTPUT = "sbom.cdx.json";

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "cdxgen",
    "--output",
    OUTPUT,
    "--type",
    "javascript",
    // Walk the whole monorepo so the SBOM includes every workspace
    // package's resolved tree, not just the root manifest.
    "--recurse",
    // CycloneDX 1.6 — current spec, accepted by all the SCA scanners
    // we'd realistically hand this to.
    "--spec-version",
    "1.6",
    "--project-name",
    "perspectives",
    "--project-version",
    // No fixed version yet (the root package.json is "0.0.0"). cdxgen
    // will read package.json itself once we tag releases.
    "0.0.0",
    // Walk the repo at the root.
    ".",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      // Disable cdxgen's call-home telemetry — generation must stay
      // hermetic for CI.
      DISABLE_DATAFLOW_USAGE: "true",
    },
  },
);
if (result.status !== 0) {
  console.error(`[sbom] cdxgen exited with status ${result.status}`);
  process.exit(1);
}
if (!existsSync(resolve(repoRoot, OUTPUT))) {
  console.error(`[sbom] expected ${OUTPUT} to exist after generation`);
  process.exit(1);
}

console.log(`[sbom] wrote ${OUTPUT}`);
