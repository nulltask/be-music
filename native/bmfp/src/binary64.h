/*
 * IEEE 754 binary64 values, worked out with exact integer arithmetic instead of the host's floating point, so the
 * results are the same on every platform (no x87 excess precision, no libc strtod, nothing for freestanding WebAssembly
 * to lack).
 *
 * The fingerprint needs this because the TypeScript implementation reads some chart values as JavaScript numbers and
 * turns them back into decimals (rationalFromNumber, docs/fingerprint-spec.md section 3.1). To match it exactly, C does
 * the same two steps: round the written decimal to the nearest double (as Number() does), then take that double's
 * shortest round-trip decimal (as String() does).
 */
#ifndef BMFP_BINARY64_H
#define BMFP_BINARY64_H

#include "rational.h"

#define B64_ZERO 0
#define B64_FINITE 1
#define B64_INFINITE 2

/* value = (neg ? -1 : 1) * mant * 2^exp2, with mant < 2^53; normal values have mant >= 2^52. */
typedef struct b64 {
  int kind;
  int neg;
  uint64_t mant;
  int exp2;
} b64;

/* The double nearest to `value`, ties to even; overflow gives B64_INFINITE, underflow B64_ZERO. */
int b64_from_rational(bmfp_ctx *ctx, const rat *value, b64 *out);

/* The exact value of the shortest decimal that rounds back to `value` (ECMAScript Number::toString). Finite only. */
int b64_shortest(bmfp_ctx *ctx, const b64 *value, rat *out);

/* The IEEE 754 bit pattern, for tests and diagnostics. */
uint64_t b64_bits(const b64 *value);

/*
 * rationalFromNumber(Number(text)) for decimal text: `*matched` is 0 when the text is not a plain decimal or its
 * double is not finite (the TypeScript returns undefined for both).
 */
int rat_from_decimal_via_double(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched);

#endif /* BMFP_BINARY64_H */
