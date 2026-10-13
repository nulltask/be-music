#include "binary64.h"

#define MANT_MIN ((uint64_t)1 << 52)
#define MANT_LIMIT ((uint64_t)1 << 53)
#define EXP2_MIN (-1074) /* exponent of the smallest subnormal, 2^-1074 */
#define EXP2_MAX 971     /* exponent of the largest finite: (2^53 - 1) * 2^971 */

/* r = mant * 2^exp2 as an exact rational. */
static int rat_from_parts(bmfp_ctx *ctx, rat *r, uint64_t mant, int exp2) {
  bn num;
  bn den;
  int ok;
  bn_init(&num);
  bn_init(&den);
  ok = bn_set_u64(ctx, &num, mant) && bn_set_u64(ctx, &den, 1);
  if (ok && exp2 >= 0) ok = bn_shl(ctx, &num, &num, (size_t)exp2);
  else if (ok) ok = bn_shl(ctx, &den, &den, (size_t)(-(long)exp2));
  ok = ok && rat_set(ctx, r, &num, &den);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  return ok;
}

/* floor(num * 2^-exp2 / den) into q and the remainder (scaled to `scaled_den`). */
static int scaled_quotient(bmfp_ctx *ctx, const bn *num, const bn *den, long exp2, bn *q, bn *rest, bn *scaled_den) {
  bn scaled_num;
  int ok;
  bn_init(&scaled_num);
  if (exp2 <= 0) {
    ok = bn_shl(ctx, &scaled_num, num, (size_t)(-exp2)) && bn_copy(ctx, scaled_den, den);
  } else {
    ok = bn_copy(ctx, &scaled_num, num) && bn_shl(ctx, scaled_den, den, (size_t)exp2);
  }
  ok = ok && bn_divmod(ctx, q, rest, &scaled_num, scaled_den);
  bn_free(ctx, &scaled_num);
  return ok;
}

int b64_from_rational(bmfp_ctx *ctx, const rat *value, b64 *out) {
  bn num;
  bn q;
  bn rest;
  bn scaled_den;
  bn twice;
  long exp2;
  long magnitude;
  int ok = 1;
  int guard;
  out->kind = B64_ZERO;
  out->neg = bn_sign(&value->n) < 0;
  out->mant = 0;
  out->exp2 = 0;
  if (rat_is_zero(value)) return 1;
  /* floor(log2 |value|) is magnitude or magnitude - 1. */
  magnitude = (long)bn_bit_length(&value->n) - (long)bn_bit_length(&value->d);
  if (magnitude > EXP2_MAX + 54) {
    out->kind = B64_INFINITE;
    return 1;
  }
  if (magnitude < EXP2_MIN - 2) return 1;
  bn_init(&num);
  bn_init(&q);
  bn_init(&rest);
  bn_init(&scaled_den);
  bn_init(&twice);
  ok = bn_copy(ctx, &num, &value->n);
  bn_abs(&num);
  exp2 = magnitude - 53;
  for (guard = 0; ok && guard < 8; guard++) {
    if (exp2 < EXP2_MIN) exp2 = EXP2_MIN;
    ok = scaled_quotient(ctx, &num, &value->d, exp2, &q, &rest, &scaled_den);
    if (!ok) break;
    if (bn_bit_length(&q) > 53) {
      exp2++;
      continue;
    }
    if (bn_bit_length(&q) < 53 && exp2 > EXP2_MIN) {
      exp2--;
      continue;
    }
    break;
  }
  if (ok) {
    uint64_t mant = bn_low_u64(&q);
    int order = 0;
    /* round half to even on the remainder: compare 2 * rest with the divisor */
    ok = bn_shl(ctx, &twice, &rest, 1);
    if (ok) {
      order = bn_cmp(&twice, &scaled_den);
      if (order > 0 || (order == 0 && (mant & 1u) != 0)) mant++;
      if (mant == MANT_LIMIT) {
        mant = MANT_MIN;
        exp2++;
      }
      if (mant == 0) {
        out->kind = B64_ZERO;
      } else if (exp2 > EXP2_MAX) {
        out->kind = B64_INFINITE;
      } else {
        out->kind = B64_FINITE;
        out->mant = mant;
        out->exp2 = (int)exp2;
      }
    }
  }
  bn_free(ctx, &num);
  bn_free(ctx, &q);
  bn_free(ctx, &rest);
  bn_free(ctx, &scaled_den);
  bn_free(ctx, &twice);
  return ok;
}

uint64_t b64_bits(const b64 *value) {
  uint64_t sign = value->neg ? (uint64_t)1 << 63 : 0;
  if (value->kind == B64_ZERO) return sign;
  if (value->kind == B64_INFINITE) return sign | ((uint64_t)0x7ff << 52);
  if (value->mant >= MANT_MIN) {
    uint64_t biased = (uint64_t)(value->exp2 + 1075);
    return sign | (biased << 52) | (value->mant - MANT_MIN);
  }
  return sign | value->mant; /* subnormal: exponent field 0, exp2 == -1074 */
}

/* r = 10^power as an exact rational (power may be negative). */
static int rat_pow10(bmfp_ctx *ctx, rat *r, long power) {
  bn p;
  bn one;
  int ok;
  bn_init(&p);
  bn_init(&one);
  ok = bn_pow10(ctx, &p, (unsigned long)(power < 0 ? -power : power)) && bn_set_u64(ctx, &one, 1);
  ok = ok && (power >= 0 ? rat_set(ctx, r, &p, &one) : rat_set(ctx, r, &one, &p));
  bn_free(ctx, &p);
  bn_free(ctx, &one);
  return ok;
}

/* Whether `candidate` lies in the rounding interval (low, high), the ends included when `inclusive`. */
static int in_interval(bmfp_ctx *ctx, const rat *candidate, const rat *low, const rat *high, int inclusive,
                       int *inside) {
  int lo = 0;
  int hi = 0;
  if (!rat_cmp(ctx, candidate, low, &lo) || !rat_cmp(ctx, candidate, high, &hi)) return 0;
  *inside = inclusive ? (lo >= 0 && hi <= 0) : (lo > 0 && hi < 0);
  return 1;
}

int b64_shortest(bmfp_ctx *ctx, const b64 *value, rat *out) {
  rat v;
  rat up;
  rat down;
  rat low;
  rat high;
  rat half;
  rat scale;
  rat t;
  rat candidate;
  rat best;
  rat distance;
  rat best_distance;
  bn floor_t;
  bn rest;
  bn c;
  bn best_c;
  bn one;
  long e10;
  long bits;
  int inclusive;
  int ok;
  int found = 0;
  int k;
  if (value->kind != B64_FINITE) {
    if (value->kind == B64_ZERO) return rat_set_i64(ctx, out, 0, 1);
    return bmfp_fail(ctx, BMFP_E_ARGUMENT);
  }
  rat_init(&v);
  rat_init(&up);
  rat_init(&down);
  rat_init(&low);
  rat_init(&high);
  rat_init(&half);
  rat_init(&scale);
  rat_init(&t);
  rat_init(&candidate);
  rat_init(&best);
  rat_init(&distance);
  rat_init(&best_distance);
  bn_init(&floor_t);
  bn_init(&rest);
  bn_init(&c);
  bn_init(&best_c);
  bn_init(&one);
  /* The rounding interval: halfway to each neighbour; its ends round to `value` only when the mantissa is even. */
  ok = rat_from_parts(ctx, &v, value->mant, value->exp2) && rat_from_parts(ctx, &up, value->mant + 1, value->exp2);
  if (ok && value->mant == MANT_MIN && value->exp2 > EXP2_MIN) {
    ok = rat_from_parts(ctx, &down, 2 * value->mant - 1, value->exp2 - 1);
  } else if (ok) {
    ok = rat_from_parts(ctx, &down, value->mant - 1, value->exp2);
  }
  ok = ok && rat_set_i64(ctx, &half, 1, 2) && rat_add(ctx, &low, &v, &down) && rat_mul(ctx, &low, &low, &half) &&
       rat_add(ctx, &high, &v, &up) && rat_mul(ctx, &high, &high, &half) && bn_set_u64(ctx, &one, 1);
  inclusive = (value->mant & 1u) == 0;
  /* e10 = floor(log10 v): estimate from the binary exponent, then correct. 1233 / 4096 is just above log10(2). */
  {
    uint64_t m = value->mant;
    bits = value->exp2 - 1;
    while (m != 0) {
      bits++;
      m >>= 1;
    }
    e10 = bits >= 0 ? (bits * 1233) / 4096 : -(((-bits) * 1233 + 4095) / 4096);
  }
  while (ok) {
    int order = 0;
    ok = rat_pow10(ctx, &scale, e10) && rat_cmp(ctx, &scale, &v, &order);
    if (!ok || order <= 0) break;
    e10--;
  }
  while (ok) {
    int order = 0;
    ok = rat_pow10(ctx, &scale, e10 + 1) && rat_cmp(ctx, &scale, &v, &order);
    if (!ok || order > 0) break;
    e10++;
  }
  /* For each digit count k, the candidates c * 10^(e10 - k + 1) on either side of v. */
  for (k = 1; ok && !found && k <= 20; k++) {
    long power = e10 - k + 1;
    int pass;
    ok = rat_pow10(ctx, &scale, power) && rat_div(ctx, &t, &v, &scale) &&
         bn_divmod(ctx, &floor_t, &rest, &t.n, &t.d);
    for (pass = 0; ok && pass < 2; pass++) {
      int inside = 0;
      if (pass == 1 && bn_is_zero(&rest)) break;
      ok = (pass == 0 ? bn_copy(ctx, &c, &floor_t) : bn_add(ctx, &c, &floor_t, &one)) &&
           rat_set(ctx, &candidate, &c, &one) && rat_mul(ctx, &candidate, &candidate, &scale) &&
           in_interval(ctx, &candidate, &low, &high, inclusive, &inside);
      if (!ok || !inside) continue;
      ok = rat_sub(ctx, &distance, &candidate, &v);
      if (!ok) break;
      bn_abs(&distance.n);
      if (found) {
        int order = 0;
        ok = rat_cmp(ctx, &distance, &best_distance, &order);
        if (!ok) break;
        /* closest wins; on a tie, the even c */
        if (order > 0 || (order == 0 && !bn_is_odd(&best_c))) continue;
      }
      ok = rat_copy(ctx, &best, &candidate) && rat_copy(ctx, &best_distance, &distance) && bn_copy(ctx, &best_c, &c);
      found = 1;
    }
  }
  if (ok && !found) ok = bmfp_fail(ctx, BMFP_E_ARGUMENT);
  if (ok) {
    if (value->neg) bn_negate(&best.n);
    ok = rat_copy(ctx, out, &best);
  }
  rat_free(ctx, &v);
  rat_free(ctx, &up);
  rat_free(ctx, &down);
  rat_free(ctx, &low);
  rat_free(ctx, &high);
  rat_free(ctx, &half);
  rat_free(ctx, &scale);
  rat_free(ctx, &t);
  rat_free(ctx, &candidate);
  rat_free(ctx, &best);
  rat_free(ctx, &distance);
  rat_free(ctx, &best_distance);
  bn_free(ctx, &floor_t);
  bn_free(ctx, &rest);
  bn_free(ctx, &c);
  bn_free(ctx, &best_c);
  bn_free(ctx, &one);
  return ok;
}

int rat_from_decimal_via_double(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched) {
  rat exact;
  b64 value;
  int ok;
  *matched = 0;
  rat_init(&exact);
  ok = rat_parse_decimal(ctx, &exact, text, length, matched);
  if (ok && *matched) {
    ok = b64_from_rational(ctx, &exact, &value);
    if (ok && value.kind == B64_INFINITE) *matched = 0;
    else if (ok) ok = b64_shortest(ctx, &value, r);
  }
  rat_free(ctx, &exact);
  return ok;
}
