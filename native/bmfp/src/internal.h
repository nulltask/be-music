/*
 * Internal plumbing shared by the library's modules: the call context (allocator and sticky status) and the few memory
 * helpers the core needs. The core includes only freestanding headers, so it builds for bare WebAssembly.
 */
#ifndef BMFP_INTERNAL_H
#define BMFP_INTERNAL_H

#include "bmfp.h"

/*
 * One per public call. The first failure is kept in `status`; later steps see it and stop, so a sequence of
 * operations needs a single check at the end.
 */
typedef struct bmfp_ctx {
  const bmfp_allocator *allocator;
  bmfp_status status;
} bmfp_ctx;

/* The allocator a NULL argument selects: the C library's malloc / free, or the WebAssembly heap. */
const bmfp_allocator *bmfp_default_allocator(void);

void bmfp_ctx_init(bmfp_ctx *ctx, const bmfp_allocator *allocator);

/* Records a failure, keeping the first one. Returns 0 so callers can `return bmfp_fail(ctx, ...)`. */
int bmfp_fail(bmfp_ctx *ctx, bmfp_status status);

/* Allocates `size` bytes, or records BMFP_E_NO_MEMORY / BMFP_E_LIMIT and returns NULL. */
void *bmfp_alloc(bmfp_ctx *ctx, size_t size);

/* Releases memory from bmfp_alloc; `size` is what was asked for. NULL is ignored. */
void bmfp_release(bmfp_ctx *ctx, void *pointer, size_t size);

void bmfp_copy_bytes(void *target, const void *source, size_t size);
void bmfp_zero_bytes(void *target, size_t size);

#endif /* BMFP_INTERNAL_H */
