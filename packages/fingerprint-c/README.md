[Japanese version](./README.ja.md)

# @be-music/fingerprint-c

The Be-Music Fingerprint ([spec](../../docs/fingerprint-spec.md)) in portable C: a library, a command-line tool, and a
WebAssembly module, for programs that are not written in TypeScript. Other languages call the library through
bindings or FFI.

It ports the TypeScript implementation in `@be-music/chart` (`packages/chart/src/fingerprint*.ts`). The library, its
header and the command keep the short name `bmfp` (`bmfp.h`, `libbmfp.a`, `bmfp`).

**Status: foundation.** The numeric core is ported and matches the TypeScript implementation, and the API, the build
and the tests are in place. Reading BMS / bmson charts and the fingerprint itself come next (see [Roadmap](#roadmap)).

## Design

- **C99**, and compiling unchanged as C11, C17, C23 and C++. These all build with warnings as errors on GCC, Clang and
  MSVC. No VLAs, no compiler extensions, and no `__int128`.
- **No dependencies.** SHA-256, arbitrary-precision integers and exact rationals are part of the library. The library
  core includes only the freestanding headers (`stddef.h`, `stdint.h`), so it also builds for bare WebAssembly.
- **No floating point.** Where the TypeScript code goes through JavaScript numbers, the C code reproduces
  `Number(text)` (nearest double, ties to even) and `String(number)` (the shortest round-trip decimal) with integer
  arithmetic. The result is the same on every platform, without depending on `strtod` or x87 precision.
- **An FFI-friendly ABI.** The API uses plain functions, integers, byte buffers and caller-provided output buffers.
  Status codes are `int`s, not enums. There is no global state, so the library is thread-safe. Callers can pass their
  own allocator, and memory the library hands out is released through the library.

## Layout

| Path                 | What                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `include/bmfp.h`     | the public API                                                             |
| `src/bigint.*`       | arbitrary-precision integers                                               |
| `src/rational.*`     | exact rationals and snapping (port of `fingerprint-rational.ts`)           |
| `src/binary64.*`     | decimal ↔ double, as JavaScript does it                                    |
| `src/sha256.*`       | SHA-256                                                                    |
| `src/alloc_libc.c`   | the default allocator of hosted builds (`malloc` / `free`)                 |
| `src/wasm.c`         | bare WebAssembly: memory functions and a heap (`bmfp_wasm_alloc` / `free`) |
| `cli/main.c`         | the `bmfp` command                                                         |
| `tests/`             | the C test runner, vectors, and the WebAssembly smoke test                 |
| `scripts/vectors.ts` | generates the vectors from the TypeScript implementation                   |

## Build

```bash
pnpm --filter @be-music/fingerprint-c run build:c
```

```bash
pnpm --filter @be-music/fingerprint-c run check:c
```

`check` runs four groups:

- `test`: the vectors and the CLI.
- `std`: C99 / C11 / C17 / C23 / C++.
- `sanitize`: AddressSanitizer and UndefinedBehaviorSanitizer.
- `wasm`: the bare module and its Node smoke test.

The WebAssembly build needs a Clang with the wasm32 target and `wasm-ld`. Apple's Clang has the target but no
`wasm-ld`; with Homebrew's LLVM and LLD:

```bash
make -C packages/fingerprint-c wasm WASM_CC=/opt/homebrew/opt/llvm/bin/clang WASM_LDFLAGS=-fuse-ld=/opt/homebrew/opt/lld/bin/wasm-ld
```

The module imports nothing and exports `memory` and the API, plus `bmfp_wasm_alloc` / `bmfp_wasm_free` for the
buffers a host passes in.

CI builds on Linux (GCC, Clang with WebAssembly, 32-bit), macOS and Windows (MSVC).

## Conformance

The C code must give the TypeScript implementation's results bit for bit. `scripts/vectors.ts` computes test vectors
with the TypeScript code and JavaScript itself, and writes them to `tests/vectors/`:

- parsing, arithmetic, comparison and snapping of rationals;
- `Number()` / `String()` round trips over random doubles, exact midpoints (ties) and long decimals.

`vectors.test.ts` (Vitest) fails when the committed vectors no longer match the TypeScript code. After a deliberate
change there, regenerate them and run the C tests:

```bash
pnpm vp test run -u packages/fingerprint-c
```

The C runner checks every vector through a counting allocator, so leaks fail too. It also fails every allocation in
turn, and expects `BMFP_E_NO_MEMORY` with nothing leaked.

## Roadmap

1. The chart reader: the parts of `@be-music/parser` the fingerprint reads, for BMS and bmson, with `#RANDOM` /
   `#SWITCH` evaluated like the parser.
2. The fingerprint documents (`fingerprint-items.ts`, `fingerprint-control-flow.ts`) and canonical JSON, checked
   against the golden corpus and against the TypeScript implementation on random charts.
3. `bmfp_chart_fingerprint` / `bmfp_play_fingerprint` in the API, `bmfp chart FILE` in the CLI, and their WebAssembly
   exports.
4. Releases: a single-file amalgamation (`bmfp.c` + `bmfp.h`) and an stb-style single header.
