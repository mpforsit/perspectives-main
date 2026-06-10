/**
 * Content-Security-Policy unit tests — see AUDIT-CODEX.md long-term #2.
 *
 * Pure function tests: no Electron required. We exercise the threat-model
 * corners (no inline scripts in prod, no remote connect, no eval) by
 * inspecting the rendered policy string.
 */
import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "../src/main/csp";

describe("buildContentSecurityPolicy — production", () => {
  const prod = buildContentSecurityPolicy({ isPackaged: true });

  it("starts from a deny-by-default base", () => {
    expect(prod).toContain("default-src 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("base-uri 'none'");
    expect(prod).toContain("form-action 'none'");
  });

  it("forbids inline scripts and eval", () => {
    // Pull just the `script-src` directive and verify it's `'self'` only.
    // Lookaheads-across-the-string would hit `style-src`'s unsafe-inline.
    const scriptSrc = prod
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("forbids remote connect / worker origins", () => {
    expect(prod).toContain("connect-src 'self'");
    expect(prod).toContain("worker-src 'self'");
    expect(prod).not.toMatch(/connect-src[^;]+(http|ws)/);
  });

  it("permits inline styles because shadcn / Tailwind injects them at build time", () => {
    expect(prod).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows data: URIs for images and fonts (icon sprites + woff2)", () => {
    expect(prod).toContain("img-src 'self' data:");
    expect(prod).toContain("font-src 'self' data:");
  });
});

describe("buildContentSecurityPolicy — development", () => {
  const dev = buildContentSecurityPolicy({
    isPackaged: false,
    devOrigin: "http://localhost:5173",
  });

  it("allows Vite HMR's WebSocket back to the loopback dev origin", () => {
    expect(dev).toContain("ws://localhost:5173");
    expect(dev).toContain("http://localhost:5173");
    expect(dev).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
  });

  it("allows the inline scripts Vite injects for HMR but stays scoped to local", () => {
    expect(dev).toContain("'unsafe-inline'");
    expect(dev).toContain("'unsafe-eval'");
    // Still no remote endpoint in script-src.
    expect(dev).not.toMatch(/script-src[^;]*\bhttps?:\/\/(?!localhost)/);
  });

  it("falls back to wildcard loopback when no dev origin is supplied", () => {
    const fallback = buildContentSecurityPolicy({ isPackaged: false });
    expect(fallback).toContain("http://localhost:*");
    expect(fallback).toContain("ws://localhost:*");
  });
});
