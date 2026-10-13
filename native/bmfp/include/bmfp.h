/*
 * bmfp: the Be-Music Fingerprint in portable C (docs/fingerprint-spec.md).
 *
 * Written in C99, and kept compiling as C11, C17, C23 and C++. The library core uses no libc beyond the freestanding
 * headers, reads no global state and is safe to call from several threads at once. Every call that allocates takes an
 * allocator (NULL selects the default one), and memory the library hands out is released through the library, so
 * callers in other languages never mix allocators.
 *
 * The API is a plain C ABI meant for bindings and FFI: integers, byte buffers and caller-provided output buffers.
 */
#ifndef BMFP_H
#define BMFP_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32) && defined(BMFP_SHARED)
#if defined(BMFP_BUILDING)
#define BMFP_API __declspec(dllexport)
#else
#define BMFP_API __declspec(dllimport)
#endif
#elif defined(__GNUC__) && defined(BMFP_SHARED)
#define BMFP_API __attribute__((visibility("default")))
#else
#define BMFP_API
#endif

#define BMFP_VERSION_MAJOR 0
#define BMFP_VERSION_MINOR 1
#define BMFP_VERSION_PATCH 0
#define BMFP_VERSION_STRING "0.1.0"

/* Status codes. An int rather than an enum, so the ABI does not depend on the compiler's enum size. */
typedef int bmfp_status;
#define BMFP_OK 0
#define BMFP_E_ARGUMENT 1        /* a null pointer or an out-of-range argument */
#define BMFP_E_NO_MEMORY 2       /* the allocator returned NULL */
#define BMFP_E_BUFFER_TOO_SMALL 3 /* the caller's output buffer is too small */
#define BMFP_E_LIMIT 4           /* the input exceeds a documented limit */
#define BMFP_E_SYNTAX 5          /* the input is not well formed */

/*
 * A caller-supplied allocator. `release` receives the size that was asked of `alloc`, so arena and pool allocators
 * need no bookkeeping. `alloc` returns NULL on failure; the library then fails with BMFP_E_NO_MEMORY.
 */
typedef struct bmfp_allocator {
  void *user;
  void *(*alloc)(void *user, size_t size);
  void (*release)(void *user, void *pointer, size_t size);
} bmfp_allocator;

/* The library version, "MAJOR.MINOR.PATCH". */
BMFP_API const char *bmfp_version(void);

/* The fingerprint algorithm this library computes, "bmfp0". */
BMFP_API const char *bmfp_algorithm(void);

/* A short English description of a status code. Never NULL. */
BMFP_API const char *bmfp_status_text(bmfp_status status);

/* Size of the buffer bmfp_sha256_hex writes: 64 hex digits and a terminating NUL. */
#define BMFP_SHA256_HEX_SIZE 65

/* SHA-256 of `size` bytes at `data`, as 64 lowercase hex digits and a NUL into `out` (BMFP_SHA256_HEX_SIZE bytes). */
BMFP_API bmfp_status bmfp_sha256_hex(const void *data, size_t size, char *out, size_t out_size);

#ifdef __cplusplus
}
#endif

#endif /* BMFP_H */
