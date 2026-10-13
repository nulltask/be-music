#include "sha256.h"

static const uint32_t ROUND_CONSTANTS[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

static uint32_t rotr(uint32_t x, unsigned n) { return (x >> n) | (x << (32u - n)); }

static void compress(sha256 *h, const unsigned char *block) {
  uint32_t w[64];
  uint32_t a, b, c, d, e, f, g, k;
  unsigned i;
  for (i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) | ((uint32_t)block[i * 4 + 2] << 8) |
           (uint32_t)block[i * 4 + 3];
  }
  for (i = 16; i < 64; i++) {
    uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  a = h->state[0];
  b = h->state[1];
  c = h->state[2];
  d = h->state[3];
  e = h->state[4];
  f = h->state[5];
  g = h->state[6];
  k = h->state[7];
  for (i = 0; i < 64; i++) {
    uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    uint32_t choose = (e & f) ^ (~e & g);
    uint32_t t1 = k + s1 + choose + ROUND_CONSTANTS[i] + w[i];
    uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + majority;
    k = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  h->state[0] += a;
  h->state[1] += b;
  h->state[2] += c;
  h->state[3] += d;
  h->state[4] += e;
  h->state[5] += f;
  h->state[6] += g;
  h->state[7] += k;
}

void sha256_init(sha256 *h) {
  h->state[0] = 0x6a09e667u;
  h->state[1] = 0xbb67ae85u;
  h->state[2] = 0x3c6ef372u;
  h->state[3] = 0xa54ff53au;
  h->state[4] = 0x510e527fu;
  h->state[5] = 0x9b05688cu;
  h->state[6] = 0x1f83d9abu;
  h->state[7] = 0x5be0cd19u;
  h->length = 0;
  h->used = 0;
}

void sha256_update(sha256 *h, const void *data, size_t size) {
  const unsigned char *bytes = (const unsigned char *)data;
  size_t i;
  h->length += size;
  for (i = 0; i < size; i++) {
    h->block[h->used++] = bytes[i];
    if (h->used == 64) {
      compress(h, h->block);
      h->used = 0;
    }
  }
}

void sha256_final(sha256 *h, unsigned char digest[32]) {
  uint64_t bit_length = h->length * 8u;
  unsigned i;
  h->block[h->used++] = 0x80;
  if (h->used > 56) {
    while (h->used < 64) h->block[h->used++] = 0;
    compress(h, h->block);
    h->used = 0;
  }
  while (h->used < 56) h->block[h->used++] = 0;
  for (i = 0; i < 8; i++) h->block[56 + i] = (unsigned char)(bit_length >> (56 - 8 * i));
  compress(h, h->block);
  for (i = 0; i < 8; i++) {
    digest[i * 4] = (unsigned char)(h->state[i] >> 24);
    digest[i * 4 + 1] = (unsigned char)(h->state[i] >> 16);
    digest[i * 4 + 2] = (unsigned char)(h->state[i] >> 8);
    digest[i * 4 + 3] = (unsigned char)h->state[i];
  }
}

void sha256_hex(const unsigned char digest[32], char out[65]) {
  static const char HEX[] = "0123456789abcdef";
  unsigned i;
  for (i = 0; i < 32; i++) {
    out[i * 2] = HEX[digest[i] >> 4];
    out[i * 2 + 1] = HEX[digest[i] & 0x0f];
  }
  out[64] = '\0';
}
