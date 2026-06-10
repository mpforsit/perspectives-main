/**
 * URL policy for the Electron main process. Two responsibilities:
 *
 *  1. `resolveDevServerUrl` — only honor `ELECTRON_RENDERER_URL` when the app
 *     is unpackaged AND the URL is a loopback HTTP(S) origin. Without this,
 *     a packaged launch with a malicious env var could load remote content
 *     into the same window that owns the privileged preload bridge.
 *
 *  2. `isAllowedExternalUrl` — restrict `shell.openExternal` and any external
 *     navigation target to plain http(s). `file:`, `javascript:`, and custom
 *     app protocols would otherwise become escape hatches.
 *
 * Both functions are pure so they can be unit-tested without an Electron
 * binary. See AUDIT-CODEX.md finding #3.
 */

export function resolveDevServerUrl(env: {
  isPackaged: boolean;
  rendererUrl: string | undefined;
}): URL | null {
  if (env.isPackaged) return null;
  const raw = env.rendererUrl;
  if (raw === undefined || raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  return isLoopback ? url : null;
}

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
