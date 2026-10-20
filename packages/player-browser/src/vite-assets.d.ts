/**
 * Module declarations for Vite's `?url` suffix imports. The host runtime (Vite) resolves these to dev-server /
 * built-asset URLs; at typecheck time we only need them to be strings so the importing code compiles.
 *
 * Kept as a side `.d.ts` rather than inline `declare module` blocks because TypeScript rejects module-augmentation
 * names that contain `?` when the file also has top-level imports (TS2664). A standalone declaration file sidesteps
 * that.
 */

declare module '*?url' {
  const url: string;
  export default url;
}
