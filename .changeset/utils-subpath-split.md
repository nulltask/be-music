---
'@be-music/utils': minor
---

Split the Node-facing CLI / logging / PCM helpers out of the
`@be-music/utils` package root into narrow subpath exports so
browser bundles can import only the helpers they need without
routing through code that pulls in `node:fs/promises` /
`node:path` / etc.

New subpaths (each emits its own dist entry; `package.json`
`exports` map and `tsdown.config.ts` are updated accordingly):

- `@be-music/utils/cli-path` — `resolveCliPath` (CLI argument →
  absolute path resolution, with POSIX / Windows-drive absolute
  fast paths and a Node-only `node:path` slow path for parent
  traversal).
- `@be-music/utils/log` — file logger / no-op logger /
  `LogEntry` / `Logger` types.
- `@be-music/utils/pcm` — `writeStereoPcm16Le` and the
  surrounding PCM helpers.

The package root (`@be-music/utils`) still re-exports each subpath
for backward compatibility, so existing callers keep working. New
callers in CLI tools and TUI runtimes have been migrated to the
subpaths to keep their module graphs tight.
