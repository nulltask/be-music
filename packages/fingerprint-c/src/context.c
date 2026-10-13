#include "internal.h"

void bmfp_ctx_init(bmfp_ctx *ctx, const bmfp_allocator *allocator) {
  ctx->allocator = allocator != NULL ? allocator : bmfp_default_allocator();
  ctx->status = BMFP_OK;
}

int bmfp_fail(bmfp_ctx *ctx, bmfp_status status) {
  if (ctx->status == BMFP_OK) ctx->status = status;
  return 0;
}

void *bmfp_alloc(bmfp_ctx *ctx, size_t size) {
  void *pointer;
  if (ctx->status != BMFP_OK) return NULL;
  if (size == 0) size = 1;
  pointer = ctx->allocator->alloc(ctx->allocator->user, size);
  if (pointer == NULL) bmfp_fail(ctx, BMFP_E_NO_MEMORY);
  return pointer;
}

void bmfp_release(bmfp_ctx *ctx, void *pointer, size_t size) {
  if (pointer == NULL) return;
  if (size == 0) size = 1;
  ctx->allocator->release(ctx->allocator->user, pointer, size);
}

void bmfp_copy_bytes(void *target, const void *source, size_t size) {
  unsigned char *to = (unsigned char *)target;
  const unsigned char *from = (const unsigned char *)source;
  size_t i;
  for (i = 0; i < size; i++) to[i] = from[i];
}

void bmfp_zero_bytes(void *target, size_t size) {
  unsigned char *to = (unsigned char *)target;
  size_t i;
  for (i = 0; i < size; i++) to[i] = 0;
}
