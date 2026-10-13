/*
 * Bare WebAssembly support (wasm32-unknown-unknown, no libc and no WASI): the memory functions the compiler may call,
 * a heap for the default allocator, and buffers the host uses to pass bytes in and out.
 *
 * The heap is a free list over the module's linear memory, grown with memory.grow. Hosts call bmfp_wasm_alloc and
 * bmfp_wasm_free for the buffers they hand to the library; the library uses the same heap internally.
 */
#include "internal.h"

/* Exported to the host (see the Makefile's WASM_EXPORTS). */
void *bmfp_wasm_alloc(size_t size);
void bmfp_wasm_free(void *pointer);

void *memcpy(void *target, const void *source, size_t size);
void *memmove(void *target, const void *source, size_t size);
void *memset(void *target, int value, size_t size);
int memcmp(const void *left, const void *right, size_t size);

void *memcpy(void *target, const void *source, size_t size) {
  unsigned char *to = (unsigned char *)target;
  const unsigned char *from = (const unsigned char *)source;
  while (size-- > 0) *to++ = *from++;
  return target;
}

void *memmove(void *target, const void *source, size_t size) {
  unsigned char *to = (unsigned char *)target;
  const unsigned char *from = (const unsigned char *)source;
  if (to < from) {
    while (size-- > 0) *to++ = *from++;
  } else {
    to += size;
    from += size;
    while (size-- > 0) *--to = *--from;
  }
  return target;
}

void *memset(void *target, int value, size_t size) {
  unsigned char *to = (unsigned char *)target;
  while (size-- > 0) *to++ = (unsigned char)value;
  return target;
}

int memcmp(const void *left, const void *right, size_t size) {
  const unsigned char *a = (const unsigned char *)left;
  const unsigned char *b = (const unsigned char *)right;
  for (; size > 0; size--, a++, b++) {
    if (*a != *b) return *a < *b ? -1 : 1;
  }
  return 0;
}

/* Every block starts with its size; free blocks are linked in address order. */
typedef struct block {
  size_t size; /* bytes of the whole block, header included */
  struct block *next;
} block;

#define ALIGN 16u
#define HEADER ((sizeof(block) + ALIGN - 1) & ~(size_t)(ALIGN - 1))
#define PAGE 65536u

extern unsigned char __heap_base;
static unsigned char *heap_end = 0;
static block *free_list = 0;

static int grow(size_t bytes) {
  size_t pages = (bytes + PAGE - 1) / PAGE;
  unsigned char *start;
  block *fresh;
  if (heap_end == 0) heap_end = (unsigned char *)(((size_t)&__heap_base + ALIGN - 1) & ~(size_t)(ALIGN - 1));
  if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
  start = heap_end;
  /* Memory beyond the old end is now ours: the new pages, plus any tail of the previous last page. */
  heap_end = (unsigned char *)(__builtin_wasm_memory_size(0) * PAGE);
  fresh = (block *)start;
  fresh->size = (size_t)(heap_end - start);
  fresh->next = 0;
  /* Hand the new region to the free list (it is past every existing block). */
  {
    block **link = &free_list;
    while (*link != 0) link = &(*link)->next;
    *link = fresh;
  }
  return 1;
}

void *bmfp_wasm_alloc(size_t size) {
  size_t need = HEADER + ((size + ALIGN - 1) & ~(size_t)(ALIGN - 1));
  block **link;
  if (size == 0) need = HEADER + ALIGN;
  for (;;) {
    for (link = &free_list; *link != 0; link = &(*link)->next) {
      block *candidate = *link;
      if (candidate->size >= need) {
        if (candidate->size - need >= HEADER + ALIGN) {
          block *rest = (block *)((unsigned char *)candidate + need);
          rest->size = candidate->size - need;
          rest->next = candidate->next;
          *link = rest;
          candidate->size = need;
        } else {
          *link = candidate->next;
        }
        return (unsigned char *)candidate + HEADER;
      }
    }
    if (!grow(need)) return 0;
  }
}

void bmfp_wasm_free(void *pointer) {
  block *freed;
  block *previous = 0;
  block *current = free_list;
  if (pointer == 0) return;
  freed = (block *)((unsigned char *)pointer - HEADER);
  while (current != 0 && current < freed) {
    previous = current;
    current = current->next;
  }
  freed->next = current;
  if (previous != 0) previous->next = freed;
  else free_list = freed;
  /* Merge with the following block, then with the previous one. */
  if (current != 0 && (unsigned char *)freed + freed->size == (unsigned char *)current) {
    freed->size += current->size;
    freed->next = current->next;
  }
  if (previous != 0 && (unsigned char *)previous + previous->size == (unsigned char *)freed) {
    previous->size += freed->size;
    previous->next = freed->next;
  }
}

static void *wasm_alloc(void *user, size_t size) {
  (void)user;
  return bmfp_wasm_alloc(size);
}

static void wasm_release(void *user, void *pointer, size_t size) {
  (void)user;
  (void)size;
  bmfp_wasm_free(pointer);
}

static const bmfp_allocator WASM_ALLOCATOR = {0, wasm_alloc, wasm_release};

const bmfp_allocator *bmfp_default_allocator(void) { return &WASM_ALLOCATOR; }
