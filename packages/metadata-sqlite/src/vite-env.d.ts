/**
 * Vite-style `?raw` suffix on `.sql` imports — reads the file contents as a
 * string at bundle / vite-node load time. Used by `migrations-index.ts` to
 * bake every migration's SQL into the bundle so we don't need filesystem
 * access at runtime.
 */
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
