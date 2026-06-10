/**
 * Pre-paint theme initialization.
 *
 * Runs before the React bundle so the initial paint isn't a light-mode
 * flash when the user prefers dark. Loaded from `index.html` via a
 * dedicated <script type="module"> tag rather than the inline `<script>`
 * it used to live in — the inline form blocks a strict
 * Content-Security-Policy (no 'unsafe-inline' in production). See
 * AUDIT-CODEX.md finding #3 + the audit's CSP follow-up.
 */
try {
  const stored = localStorage.getItem("perspectives:theme");
  const theme =
    stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {
  // localStorage unavailable — fall back to light. No-op.
}
