/**
 * Content-Security-Policy applied to every renderer response. See
 * AUDIT-CODEX.md finding #3 + the "Add a production Content Security
 * Policy" item from the audit's long-term roadmap.
 *
 * Two policies — one tight (production, `file://` loads), one loose enough
 * for Vite's HMR socket and any inline styles the dev server injects. The
 * dev policy is still narrow enough that an XSS in the renderer can't
 * reach a remote origin or load eval'd code, but it has to tolerate the
 * loopback dev server's WebSocket and Vite's pre-bundling style injection.
 *
 * The policy is installed via `session.webRequest.onHeadersReceived` so it
 * applies to both `loadURL` (dev) and `loadFile` (prod). Doing it via a
 * `<meta http-equiv>` tag in `index.html` would skip on `file://` loads in
 * some Electron versions; the response-header path is reliable.
 */

export interface CspContext {
  /** True when the running app was packaged via electron-builder (prod). */
  isPackaged: boolean;
  /** The dev origin Vite is serving from, if any. Lets us scope the
   *  WebSocket allowance to the actual dev port rather than `ws:` at large. */
  devOrigin?: string;
}

export function buildContentSecurityPolicy(ctx: CspContext): string {
  // Common directives — locked in for both dev and prod.
  const directives: string[] = [
    "default-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ];

  if (ctx.isPackaged) {
    // Production: everything is `file://`. No inline scripts (the FOUC
    // helper now ships as a bundled module), no remote origins, no eval.
    //
    // Tailwind/shadcn emits styles via `<style>` blocks and inline `style`
    // attributes at build time — `'unsafe-inline'` on `style-src` is the
    // pragmatic price; Tailwind compiles to a single .css under the
    // bundle and we don't load remote CSS. Scripts stay `'self'` only.
    directives.push("script-src 'self'");
    directives.push("style-src 'self' 'unsafe-inline'");
    directives.push("connect-src 'self'");
    directives.push("worker-src 'self'");
  } else {
    // Dev: Vite injects a HMR client that uses inline scripts for its
    // hot-update logic, opens a WebSocket back to the dev server, and
    // serves stylesheets through `<style>` injection. We accept those —
    // dev runs only on the developer's own machine and a hostile
    // renderer would already have local-machine reach.
    const wsOrigin = ctx.devOrigin
      ? ctx.devOrigin.replace(/^http/, "ws")
      : "ws://localhost:*";
    directives.push(
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ctx.devOrigin ?? "http://localhost:*"}`,
    );
    directives.push("style-src 'self' 'unsafe-inline'");
    directives.push(
      `connect-src 'self' ${ctx.devOrigin ?? "http://localhost:*"} ${wsOrigin}`,
    );
    directives.push(`worker-src 'self' blob:`);
  }

  return directives.join("; ");
}
