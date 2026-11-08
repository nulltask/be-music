[Japanese version](./README.ja.md)

# @be-music/shared-utils

Generic utilities reused across all Be-Music packages. Browser-safe core helpers and Node-facing helpers are split into narrow subpath exports, so a browser bundle never pulls in Node code.

The subpath entries are `./core`, `./hash`, `./async`, `./cli`, `./cli-path`, `./log`, `./optional-node-module`, `./path`, `./pcm`, `./workerize` and `./png`. See [Shared utilities](../../docs/shared-utils.md) for what the main entries hold and which runtime each one targets.
