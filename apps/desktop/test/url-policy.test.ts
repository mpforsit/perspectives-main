/**
 * Electron URL-policy unit tests — see AUDIT-CODEX.md finding #3.
 *
 * The functions under test are pure (no Electron / no fs), so we can exercise
 * the threat-model corner cases — packaged launches with a malicious env var,
 * non-loopback dev origins, and exotic protocols in `setWindowOpenHandler`
 * targets — without spinning up a renderer.
 */
import { describe, expect, it } from "vitest";

import { isAllowedExternalUrl, resolveDevServerUrl } from "../src/main/url-policy";

describe("resolveDevServerUrl", () => {
  it("returns null when the app is packaged, regardless of the env var", () => {
    expect(
      resolveDevServerUrl({
        isPackaged: true,
        rendererUrl: "http://localhost:5173",
      }),
    ).toBeNull();
    expect(
      resolveDevServerUrl({
        isPackaged: true,
        rendererUrl: "https://evil.example.com",
      }),
    ).toBeNull();
  });

  it("returns null when the env var is absent or empty", () => {
    expect(
      resolveDevServerUrl({ isPackaged: false, rendererUrl: undefined }),
    ).toBeNull();
    expect(
      resolveDevServerUrl({ isPackaged: false, rendererUrl: "" }),
    ).toBeNull();
  });

  it("returns null when the env var is not a valid URL", () => {
    expect(
      resolveDevServerUrl({ isPackaged: false, rendererUrl: "not-a-url" }),
    ).toBeNull();
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "ws://localhost:5173",
  ])("returns null for non-http(s) protocol %s", (url) => {
    expect(
      resolveDevServerUrl({ isPackaged: false, rendererUrl: url }),
    ).toBeNull();
  });

  it.each([
    "http://evil.example.com:5173",
    "https://attacker.test",
    "http://192.168.1.1",
    "http://10.0.0.1",
  ])("returns null for non-loopback host %s", (url) => {
    expect(
      resolveDevServerUrl({ isPackaged: false, rendererUrl: url }),
    ).toBeNull();
  });

  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("accepts loopback dev URL %s when unpackaged", (url) => {
    const result = resolveDevServerUrl({
      isPackaged: false,
      rendererUrl: url,
    });
    expect(result).not.toBeNull();
    expect(result?.href).toBe(new URL(url).href);
  });
});

describe("isAllowedExternalUrl", () => {
  it.each(["https://example.com", "http://example.com/page?x=1"])(
    "allows %s",
    (url) => {
      expect(isAllowedExternalUrl(url)).toBe(true);
    },
  );

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "ws://example.com",
    "perspectives://internal",
    "",
    "not-a-url",
  ])("rejects %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});
