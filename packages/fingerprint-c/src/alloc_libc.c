/* The default allocator of hosted builds: the C library's malloc and free. The WebAssembly build uses wasm.c instead. */
#include <stdlib.h>

#include "internal.h"

static void *libc_alloc(void *user, size_t size) {
  (void)user;
  return malloc(size);
}

static void libc_release(void *user, void *pointer, size_t size) {
  (void)user;
  (void)size;
  free(pointer);
}

static const bmfp_allocator LIBC_ALLOCATOR = {NULL, libc_alloc, libc_release};

const bmfp_allocator *bmfp_default_allocator(void) { return &LIBC_ALLOCATOR; }
