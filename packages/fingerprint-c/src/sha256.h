/* SHA-256 (FIPS 180-4), streaming. Fingerprints are `bmfp0:` plus the SHA-256 of the canonical document. */
#ifndef BMFP_SHA256_H
#define BMFP_SHA256_H

#include "internal.h"

typedef struct sha256 {
  uint32_t state[8];
  uint64_t length; /* bytes hashed so far */
  unsigned char block[64];
  size_t used;
} sha256;

void sha256_init(sha256 *h);
void sha256_update(sha256 *h, const void *data, size_t size);
void sha256_final(sha256 *h, unsigned char digest[32]);
/* 64 lowercase hex digits and a NUL. */
void sha256_hex(const unsigned char digest[32], char out[65]);

#endif /* BMFP_SHA256_H */
