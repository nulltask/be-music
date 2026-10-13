/*
 * Exact rationals and the fingerprint's snapping rules (docs/fingerprint-spec.md sections 3.1 and 3.2). A port of
 * packages/chart/src/fingerprint-rational.ts: every function here must give the same result as its TypeScript
 * counterpart, which the test vectors (tests/vectors/rational.txt, generated from the TypeScript code) check.
 *
 * Values are kept in lowest terms with a positive denominator, so equal rationals share one representation.
 */
#ifndef BMFP_RATIONAL_H
#define BMFP_RATIONAL_H

#include "bigint.h"

typedef struct rat {
  bn n;
  bn d;
} rat;

void rat_init(rat *r);
void rat_free(bmfp_ctx *ctx, rat *r);
int rat_copy(bmfp_ctx *ctx, rat *target, const rat *source);

/* n / d in lowest terms (createRational). `d` must not be zero. Inputs may alias `r`'s parts. */
int rat_set(bmfp_ctx *ctx, rat *r, const bn *n, const bn *d);
int rat_set_i64(bmfp_ctx *ctx, rat *r, int64_t n, int64_t d);

int rat_is_zero(const rat *r);
int rat_equal(const rat *a, const rat *b);
/* *order receives -1, 0 or 1. */
int rat_cmp(bmfp_ctx *ctx, const rat *a, const rat *b, int *order);

int rat_add(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b);
int rat_sub(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b);
int rat_mul(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b);
/* `b` must not be zero. */
int rat_div(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b);

/* Canonical text (formatRational): "n" for integers, "p/q" otherwise. Allocated like bn_to_decimal. */
int rat_format(bmfp_ctx *ctx, const rat *r, char **text, size_t *length, size_t *size);

/*
 * parseDecimalRational: the exact value of decimal text (`" -1.5e-3 "`), after trimming JavaScript white space.
 * `*matched` is 0 (and `r` untouched) when the text is not a plain decimal. Exponents beyond +-100000 fail with
 * BMFP_E_LIMIT.
 */
int rat_parse_decimal(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched);
/* parseLeadingDecimalRational: the leading decimal of free text (`"100 ; comment"` gives 100). */
int rat_parse_leading_decimal(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched);
/* Reads canonical text ("-7", "400/3"), as rat_format writes it. */
int rat_parse_canonical(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched);

/*
 * snapToSmallDenominator: the nearest a/q with 1 <= q <= max_denominator within `tolerance` of `value`, or `value`
 * itself. Ties go to the smaller q, then the smaller value; with `positive_only`, a >= 1.
 */
int rat_snap_small_denominator(bmfp_ctx *ctx, rat *r, const rat *value, unsigned max_denominator,
                               const rat *tolerance, int positive_only);
/* snapMeasureLength: a positive measure length, snapped on its beat count (denominator <= 48, 1/4608 beat). */
int rat_snap_measure_length(bmfp_ctx *ctx, rat *r, const rat *length);
/* snapValue: denominator <= 12 within a relative 1e-5; 0 stays 0. */
int rat_snap_value(bmfp_ctx *ctx, rat *r, const rat *value);

#endif /* BMFP_RATIONAL_H */
