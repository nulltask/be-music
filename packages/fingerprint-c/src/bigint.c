#include "bigint.h"

#define LIMB_BITS 32u
/* Limb counts above this would overflow a size computation; no fingerprint value comes anywhere near it. */
#define MAX_LIMBS (((size_t)-1) / 8u)

static void trim(bn *a) {
  while (a->len > 0 && a->limb[a->len - 1] == 0) a->len--;
  if (a->len == 0) a->neg = 0;
}

static int reserve(bmfp_ctx *ctx, bn *a, size_t cap) {
  uint32_t *limbs;
  size_t new_cap;
  if (a->cap >= cap) return 1;
  if (cap > MAX_LIMBS) return bmfp_fail(ctx, BMFP_E_LIMIT);
  new_cap = cap < 4 ? 4 : cap;
  limbs = (uint32_t *)bmfp_alloc(ctx, new_cap * sizeof(uint32_t));
  if (limbs == NULL) return 0;
  if (a->len > 0) bmfp_copy_bytes(limbs, a->limb, a->len * sizeof(uint32_t));
  bmfp_release(ctx, a->limb, a->cap * sizeof(uint32_t));
  a->limb = limbs;
  a->cap = new_cap;
  return 1;
}

void bn_init(bn *a) {
  a->limb = NULL;
  a->len = 0;
  a->cap = 0;
  a->neg = 0;
}

void bn_free(bmfp_ctx *ctx, bn *a) {
  bmfp_release(ctx, a->limb, a->cap * sizeof(uint32_t));
  bn_init(a);
}

void bn_swap(bn *a, bn *b) {
  bn t = *a;
  *a = *b;
  *b = t;
}

/* Replaces `r` with `t` (both owned) and frees what `r` held. */
static void take(bmfp_ctx *ctx, bn *r, bn *t) {
  bn_swap(r, t);
  bn_free(ctx, t);
}

int bn_set_u64(bmfp_ctx *ctx, bn *a, uint64_t value) {
  if (!reserve(ctx, a, 2)) return 0;
  a->limb[0] = (uint32_t)(value & 0xffffffffu);
  a->limb[1] = (uint32_t)(value >> 32);
  a->len = 2;
  a->neg = 0;
  trim(a);
  return 1;
}

int bn_set_i64(bmfp_ctx *ctx, bn *a, int64_t value) {
  /* Negating through unsigned arithmetic keeps INT64_MIN defined. */
  uint64_t magnitude = value < 0 ? (uint64_t)0 - (uint64_t)value : (uint64_t)value;
  if (!bn_set_u64(ctx, a, magnitude)) return 0;
  if (value < 0 && a->len > 0) a->neg = 1;
  return 1;
}

int bn_copy(bmfp_ctx *ctx, bn *target, const bn *source) {
  if (target == source) return 1;
  if (!reserve(ctx, target, source->len)) return 0;
  if (source->len > 0) bmfp_copy_bytes(target->limb, source->limb, source->len * sizeof(uint32_t));
  target->len = source->len;
  target->neg = source->neg;
  return 1;
}

int bn_is_zero(const bn *a) { return a->len == 0; }

int bn_is_odd(const bn *a) { return a->len > 0 && (a->limb[0] & 1u) != 0; }

int bn_sign(const bn *a) { return a->len == 0 ? 0 : a->neg ? -1 : 1; }

int bn_cmp_abs(const bn *a, const bn *b) {
  size_t i;
  if (a->len != b->len) return a->len < b->len ? -1 : 1;
  for (i = a->len; i > 0; i--) {
    if (a->limb[i - 1] != b->limb[i - 1]) return a->limb[i - 1] < b->limb[i - 1] ? -1 : 1;
  }
  return 0;
}

int bn_cmp(const bn *a, const bn *b) {
  int sa = bn_sign(a);
  int sb = bn_sign(b);
  if (sa != sb) return sa < sb ? -1 : 1;
  if (sa == 0) return 0;
  return sa > 0 ? bn_cmp_abs(a, b) : -bn_cmp_abs(a, b);
}

size_t bn_bit_length(const bn *a) {
  uint32_t top;
  size_t bits;
  if (a->len == 0) return 0;
  top = a->limb[a->len - 1];
  bits = (a->len - 1) * LIMB_BITS;
  while (top != 0) {
    bits++;
    top >>= 1;
  }
  return bits;
}

uint64_t bn_low_u64(const bn *a) {
  uint64_t value = 0;
  if (a->len > 0) value = a->limb[0];
  if (a->len > 1) value |= (uint64_t)a->limb[1] << 32;
  return value;
}

void bn_negate(bn *a) {
  if (a->len > 0) a->neg = !a->neg;
}

void bn_abs(bn *a) { a->neg = 0; }

/* |a| + |b| into a fresh `t`. */
static int add_abs(bmfp_ctx *ctx, bn *t, const bn *a, const bn *b) {
  size_t n = a->len > b->len ? a->len : b->len;
  size_t i;
  uint64_t carry = 0;
  if (!reserve(ctx, t, n + 1)) return 0;
  for (i = 0; i < n; i++) {
    uint64_t sum = carry;
    if (i < a->len) sum += a->limb[i];
    if (i < b->len) sum += b->limb[i];
    t->limb[i] = (uint32_t)(sum & 0xffffffffu);
    carry = sum >> 32;
  }
  t->limb[n] = (uint32_t)carry;
  t->len = n + 1;
  t->neg = 0;
  trim(t);
  return 1;
}

/* |a| - |b| into a fresh `t`, with |a| >= |b|. */
static int sub_abs(bmfp_ctx *ctx, bn *t, const bn *a, const bn *b) {
  size_t i;
  uint64_t borrow = 0;
  if (!reserve(ctx, t, a->len)) return 0;
  for (i = 0; i < a->len; i++) {
    uint64_t subtrahend = borrow + (i < b->len ? b->limb[i] : 0u);
    uint64_t minuend = a->limb[i];
    if (minuend >= subtrahend) {
      t->limb[i] = (uint32_t)(minuend - subtrahend);
      borrow = 0;
    } else {
      t->limb[i] = (uint32_t)((minuend + ((uint64_t)1 << 32)) - subtrahend);
      borrow = 1;
    }
  }
  t->len = a->len;
  t->neg = 0;
  trim(t);
  return 1;
}

/* a + (negate_b ? -b : b) */
static int add_signed(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b, int negate_b) {
  bn t;
  int a_neg = a->neg;
  int b_neg = b->len > 0 ? (negate_b ? !b->neg : b->neg) : 0;
  int ok;
  bn_init(&t);
  if (a_neg == b_neg || a->len == 0 || b->len == 0) {
    ok = add_abs(ctx, &t, a, b);
    if (ok && t.len > 0) t.neg = a->len > 0 ? a_neg : b_neg;
  } else {
    int order = bn_cmp_abs(a, b);
    if (order == 0) {
      ok = 1;
    } else if (order > 0) {
      ok = sub_abs(ctx, &t, a, b);
      if (ok && t.len > 0) t.neg = a_neg;
    } else {
      ok = sub_abs(ctx, &t, b, a);
      if (ok && t.len > 0) t.neg = b_neg;
    }
  }
  if (!ok) {
    bn_free(ctx, &t);
    return 0;
  }
  take(ctx, r, &t);
  return 1;
}

int bn_add(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b) { return add_signed(ctx, r, a, b, 0); }

int bn_sub(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b) { return add_signed(ctx, r, a, b, 1); }

int bn_mul(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b) {
  bn t;
  size_t i;
  size_t j;
  bn_init(&t);
  if (a->len == 0 || b->len == 0) {
    take(ctx, r, &t);
    return 1;
  }
  if (a->len > MAX_LIMBS - b->len) return bmfp_fail(ctx, BMFP_E_LIMIT);
  if (!reserve(ctx, &t, a->len + b->len)) return 0;
  bmfp_zero_bytes(t.limb, (a->len + b->len) * sizeof(uint32_t));
  for (i = 0; i < a->len; i++) {
    uint64_t carry = 0;
    uint64_t ai = a->limb[i];
    for (j = 0; j < b->len; j++) {
      uint64_t cur = ai * b->limb[j] + t.limb[i + j] + carry;
      t.limb[i + j] = (uint32_t)(cur & 0xffffffffu);
      carry = cur >> 32;
    }
    t.limb[i + b->len] = (uint32_t)carry;
  }
  t.len = a->len + b->len;
  t.neg = a->neg != b->neg;
  trim(&t);
  take(ctx, r, &t);
  return 1;
}

int bn_mul_u32(bmfp_ctx *ctx, bn *r, const bn *a, uint32_t m) {
  bn t;
  size_t i;
  uint64_t carry = 0;
  bn_init(&t);
  if (a->len == 0 || m == 0) {
    take(ctx, r, &t);
    return 1;
  }
  if (!reserve(ctx, &t, a->len + 1)) return 0;
  for (i = 0; i < a->len; i++) {
    uint64_t cur = (uint64_t)a->limb[i] * m + carry;
    t.limb[i] = (uint32_t)(cur & 0xffffffffu);
    carry = cur >> 32;
  }
  t.limb[a->len] = (uint32_t)carry;
  t.len = a->len + 1;
  t.neg = a->neg;
  trim(&t);
  take(ctx, r, &t);
  return 1;
}

int bn_add_i64(bmfp_ctx *ctx, bn *r, const bn *a, int64_t value) {
  bn v;
  int ok;
  bn_init(&v);
  ok = bn_set_i64(ctx, &v, value) && bn_add(ctx, r, a, &v);
  bn_free(ctx, &v);
  return ok;
}

int bn_shl(bmfp_ctx *ctx, bn *r, const bn *a, size_t bits) {
  bn t;
  size_t words = bits / LIMB_BITS;
  unsigned shift = (unsigned)(bits % LIMB_BITS);
  size_t i;
  bn_init(&t);
  if (a->len == 0) {
    take(ctx, r, &t);
    return 1;
  }
  if (words > MAX_LIMBS - a->len - 1) return bmfp_fail(ctx, BMFP_E_LIMIT);
  if (!reserve(ctx, &t, a->len + words + 1)) return 0;
  bmfp_zero_bytes(t.limb, (a->len + words + 1) * sizeof(uint32_t));
  for (i = 0; i < a->len; i++) {
    uint64_t cur = (uint64_t)a->limb[i] << shift;
    t.limb[i + words] |= (uint32_t)(cur & 0xffffffffu);
    t.limb[i + words + 1] |= (uint32_t)(cur >> 32);
  }
  t.len = a->len + words + 1;
  t.neg = a->neg;
  trim(&t);
  take(ctx, r, &t);
  return 1;
}

int bn_shr(bmfp_ctx *ctx, bn *r, const bn *a, size_t bits) {
  bn t;
  size_t words = bits / LIMB_BITS;
  unsigned shift = (unsigned)(bits % LIMB_BITS);
  size_t i;
  size_t n;
  bn_init(&t);
  if (words >= a->len) {
    take(ctx, r, &t);
    return 1;
  }
  n = a->len - words;
  if (!reserve(ctx, &t, n)) return 0;
  for (i = 0; i < n; i++) {
    uint64_t cur = a->limb[i + words];
    if (i + words + 1 < a->len) cur |= (uint64_t)a->limb[i + words + 1] << 32;
    t.limb[i] = (uint32_t)((cur >> shift) & 0xffffffffu);
  }
  t.len = n;
  t.neg = a->neg;
  trim(&t);
  take(ctx, r, &t);
  return 1;
}

/* In place: x = |x| - |y|, with |x| >= |y|. */
static void sub_abs_in_place(bn *x, const bn *y) {
  size_t i;
  uint64_t borrow = 0;
  for (i = 0; i < x->len; i++) {
    uint64_t subtrahend = borrow + (i < y->len ? y->limb[i] : 0u);
    uint64_t minuend = x->limb[i];
    if (minuend >= subtrahend) {
      x->limb[i] = (uint32_t)(minuend - subtrahend);
      borrow = 0;
    } else {
      x->limb[i] = (uint32_t)((minuend + ((uint64_t)1 << 32)) - subtrahend);
      borrow = 1;
    }
  }
  trim(x);
}

/* In place: x = 2|x| + bit. `x` must have room for one more limb. */
static void shl1_or_in_place(bn *x, unsigned bit) {
  size_t i;
  uint32_t carry = bit;
  for (i = 0; i < x->len; i++) {
    uint32_t next = x->limb[i] >> 31;
    x->limb[i] = (x->limb[i] << 1) | carry;
    carry = next;
  }
  if (carry != 0) x->limb[x->len++] = carry;
}

int bn_divmod(bmfp_ctx *ctx, bn *q, bn *r, const bn *a, const bn *b) {
  bn quotient;
  bn remainder;
  int q_neg = a->neg != b->neg;
  int r_neg = a->neg;
  bn_init(&quotient);
  bn_init(&remainder);
  if (b->len == 0) return bmfp_fail(ctx, BMFP_E_ARGUMENT);
  if (bn_cmp_abs(a, b) < 0) {
    if (!bn_copy(ctx, &remainder, a)) return 0;
  } else if (b->len == 1) {
    uint64_t divisor = b->limb[0];
    uint64_t rest = 0;
    size_t i;
    if (!reserve(ctx, &quotient, a->len)) return 0;
    for (i = a->len; i > 0; i--) {
      uint64_t cur = (rest << 32) | a->limb[i - 1];
      quotient.limb[i - 1] = (uint32_t)(cur / divisor);
      rest = cur % divisor;
    }
    quotient.len = a->len;
    trim(&quotient);
    if (!bn_set_u64(ctx, &remainder, rest)) {
      bn_free(ctx, &quotient);
      return 0;
    }
  } else {
    size_t bits = bn_bit_length(a);
    size_t bit;
    if (!reserve(ctx, &quotient, a->len) || !reserve(ctx, &remainder, b->len + 2)) {
      bn_free(ctx, &quotient);
      bn_free(ctx, &remainder);
      return 0;
    }
    bmfp_zero_bytes(quotient.limb, a->len * sizeof(uint32_t));
    quotient.len = a->len;
    for (bit = bits; bit > 0; bit--) {
      size_t index = bit - 1;
      unsigned value = (unsigned)((a->limb[index / LIMB_BITS] >> (index % LIMB_BITS)) & 1u);
      shl1_or_in_place(&remainder, value);
      if (bn_cmp_abs(&remainder, b) >= 0) {
        sub_abs_in_place(&remainder, b);
        quotient.limb[index / LIMB_BITS] |= (uint32_t)1u << (index % LIMB_BITS);
      }
    }
    trim(&quotient);
  }
  remainder.neg = remainder.len > 0 ? r_neg : 0;
  quotient.neg = quotient.len > 0 ? q_neg : 0;
  if (q != NULL) take(ctx, q, &quotient);
  else bn_free(ctx, &quotient);
  if (r != NULL) take(ctx, r, &remainder);
  else bn_free(ctx, &remainder);
  return 1;
}

int bn_gcd(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b) {
  bn x;
  bn y;
  bn rest;
  int ok;
  bn_init(&x);
  bn_init(&y);
  bn_init(&rest);
  ok = bn_copy(ctx, &x, a) && bn_copy(ctx, &y, b);
  x.neg = 0;
  y.neg = 0;
  while (ok && y.len > 0) {
    ok = bn_divmod(ctx, NULL, &rest, &x, &y);
    bn_swap(&x, &y);
    bn_swap(&y, &rest);
  }
  if (ok) take(ctx, r, &x);
  else bn_free(ctx, &x);
  bn_free(ctx, &y);
  bn_free(ctx, &rest);
  return ok;
}

int bn_pow10(bmfp_ctx *ctx, bn *r, unsigned long exponent) {
  static const uint32_t small[10] = {1u, 10u, 100u, 1000u, 10000u, 100000u, 1000000u, 10000000u, 100000000u,
                                     1000000000u};
  bn t;
  int ok;
  bn_init(&t);
  ok = bn_set_u64(ctx, &t, 1);
  while (ok && exponent >= 9) {
    ok = bn_mul_u32(ctx, &t, &t, small[9]);
    exponent -= 9;
  }
  if (ok) ok = bn_mul_u32(ctx, &t, &t, small[exponent]);
  if (ok) take(ctx, r, &t);
  else bn_free(ctx, &t);
  return ok;
}

int bn_from_digits(bmfp_ctx *ctx, bn *r, const char *digits, size_t count) {
  static const uint32_t small[10] = {1u, 10u, 100u, 1000u, 10000u, 100000u, 1000000u, 10000000u, 100000000u,
                                     1000000000u};
  bn t;
  size_t i = 0;
  int ok;
  bn_init(&t);
  if (count == 0) return bmfp_fail(ctx, BMFP_E_SYNTAX);
  ok = 1;
  while (ok && i < count) {
    size_t chunk = count - i < 9 ? count - i : 9;
    uint32_t value = 0;
    size_t k;
    for (k = 0; k < chunk; k++) {
      char c = digits[i + k];
      if (c < '0' || c > '9') {
        bn_free(ctx, &t);
        return bmfp_fail(ctx, BMFP_E_SYNTAX);
      }
      value = value * 10u + (uint32_t)(c - '0');
    }
    ok = bn_mul_u32(ctx, &t, &t, small[chunk]) && bn_add_i64(ctx, &t, &t, (int64_t)value);
    i += chunk;
  }
  if (ok) take(ctx, r, &t);
  else bn_free(ctx, &t);
  return ok;
}

int bn_to_decimal(bmfp_ctx *ctx, const bn *a, char **text, size_t *length, size_t *size) {
  uint32_t *work;
  uint32_t *chunks;
  size_t work_len = a->len;
  size_t chunk_count = 0;
  size_t max_chunks;
  size_t capacity;
  size_t pos = 0;
  char *out;
  size_t i;
  *text = NULL;
  *length = 0;
  *size = 0;
  /* A 32-bit limb holds fewer than 10 decimal digits, so 10 * len digits, in chunks of 9, always suffice. */
  max_chunks = (a->len * 10u + 8u) / 9u + 1u;
  capacity = max_chunks * 9 + 2;
  out = (char *)bmfp_alloc(ctx, capacity);
  if (out == NULL) return 0;
  if (a->len == 0) {
    out[0] = '0';
    out[1] = '\0';
    *text = out;
    *length = 1;
    *size = capacity;
    return 1;
  }
  work = (uint32_t *)bmfp_alloc(ctx, a->len * sizeof(uint32_t));
  chunks = (uint32_t *)bmfp_alloc(ctx, max_chunks * sizeof(uint32_t));
  if (work == NULL || chunks == NULL) {
    bmfp_release(ctx, out, capacity);
    bmfp_release(ctx, work, a->len * sizeof(uint32_t));
    bmfp_release(ctx, chunks, max_chunks * sizeof(uint32_t));
    return 0;
  }
  bmfp_copy_bytes(work, a->limb, a->len * sizeof(uint32_t));
  while (work_len > 0) {
    uint64_t rest = 0;
    for (i = work_len; i > 0; i--) {
      uint64_t cur = (rest << 32) | work[i - 1];
      work[i - 1] = (uint32_t)(cur / 1000000000u);
      rest = cur % 1000000000u;
    }
    chunks[chunk_count++] = (uint32_t)rest;
    while (work_len > 0 && work[work_len - 1] == 0) work_len--;
  }
  if (a->neg) out[pos++] = '-';
  for (i = chunk_count; i > 0; i--) {
    uint32_t value = chunks[i - 1];
    char digits[9];
    int k;
    for (k = 8; k >= 0; k--) {
      digits[k] = (char)('0' + value % 10u);
      value /= 10u;
    }
    if (i == chunk_count) {
      int first = 0;
      while (first < 8 && digits[first] == '0') first++;
      for (k = first; k < 9; k++) out[pos++] = digits[k];
    } else {
      for (k = 0; k < 9; k++) out[pos++] = digits[k];
    }
  }
  out[pos] = '\0';
  bmfp_release(ctx, work, a->len * sizeof(uint32_t));
  bmfp_release(ctx, chunks, max_chunks * sizeof(uint32_t));
  *text = out;
  *length = pos;
  *size = capacity;
  return 1;
}
