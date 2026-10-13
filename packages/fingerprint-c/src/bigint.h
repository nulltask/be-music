/*
 * Arbitrary-precision integers: sign and magnitude, 32-bit limbs, least significant first. Only what the fingerprint
 * needs (add, subtract, multiply, divide, shift, gcd, decimal text), written for correctness over speed: the numbers
 * the fingerprint meets are a few hundred bits.
 *
 * Every function that can allocate takes the call context and returns 1 on success, 0 on failure (the context holds
 * the status). Results may alias inputs. Division truncates toward zero, as JavaScript's BigInt does.
 */
#ifndef BMFP_BIGINT_H
#define BMFP_BIGINT_H

#include "internal.h"

typedef struct bn {
  uint32_t *limb;
  size_t len; /* limbs in use; 0 means zero */
  size_t cap;
  int neg; /* 1 for negative; always 0 for zero */
} bn;

void bn_init(bn *a);
void bn_free(bmfp_ctx *ctx, bn *a);
void bn_swap(bn *a, bn *b);

int bn_set_u64(bmfp_ctx *ctx, bn *a, uint64_t value);
int bn_set_i64(bmfp_ctx *ctx, bn *a, int64_t value);
int bn_copy(bmfp_ctx *ctx, bn *target, const bn *source);

int bn_is_zero(const bn *a);
int bn_is_odd(const bn *a);
/* -1, 0 or 1. */
int bn_sign(const bn *a);
int bn_cmp(const bn *a, const bn *b);
int bn_cmp_abs(const bn *a, const bn *b);
size_t bn_bit_length(const bn *a);
/* The low 64 bits of the magnitude. */
uint64_t bn_low_u64(const bn *a);
void bn_negate(bn *a);
void bn_abs(bn *a);

int bn_add(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b);
int bn_sub(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b);
int bn_mul(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b);
int bn_mul_u32(bmfp_ctx *ctx, bn *r, const bn *a, uint32_t m);
int bn_add_i64(bmfp_ctx *ctx, bn *r, const bn *a, int64_t value);
/* Quotient (toward zero) and remainder (sign of `a`); either output may be NULL. `b` must not be zero. */
int bn_divmod(bmfp_ctx *ctx, bn *q, bn *r, const bn *a, const bn *b);
/* Magnitude shifts; the sign is kept (a right shift truncates the magnitude). */
int bn_shl(bmfp_ctx *ctx, bn *r, const bn *a, size_t bits);
int bn_shr(bmfp_ctx *ctx, bn *r, const bn *a, size_t bits);
/* Non-negative greatest common divisor; gcd(0, 0) is 0. */
int bn_gcd(bmfp_ctx *ctx, bn *r, const bn *a, const bn *b);
int bn_pow10(bmfp_ctx *ctx, bn *r, unsigned long exponent);

/* Non-negative integer from ASCII digits (at least one, all '0'..'9'). */
int bn_from_digits(bmfp_ctx *ctx, bn *r, const char *digits, size_t count);
/*
 * Decimal text with a leading '-' when negative, allocated through the context and NUL-terminated. `*size` receives
 * the allocation size to release; `*length` the text length.
 */
int bn_to_decimal(bmfp_ctx *ctx, const bn *a, char **text, size_t *length, size_t *size);

#endif /* BMFP_BIGINT_H */
