#include "rational.h"

/* Decimal exponents beyond this are refused; no chart writes them, and 10^100000 is already a 41 KB number. */
#define MAX_DECIMAL_EXPONENT 100000L

void rat_init(rat *r) {
  bn_init(&r->n);
  bn_init(&r->d);
}

void rat_free(bmfp_ctx *ctx, rat *r) {
  bn_free(ctx, &r->n);
  bn_free(ctx, &r->d);
}

int rat_copy(bmfp_ctx *ctx, rat *target, const rat *source) {
  return bn_copy(ctx, &target->n, &source->n) && bn_copy(ctx, &target->d, &source->d);
}

int rat_set(bmfp_ctx *ctx, rat *r, const bn *n, const bn *d) {
  bn nn;
  bn dd;
  bn g;
  int ok;
  if (bn_is_zero(d)) return bmfp_fail(ctx, BMFP_E_ARGUMENT);
  bn_init(&nn);
  bn_init(&dd);
  bn_init(&g);
  ok = bn_copy(ctx, &nn, n) && bn_copy(ctx, &dd, d);
  if (ok && dd.neg) {
    bn_negate(&nn);
    bn_negate(&dd);
  }
  ok = ok && bn_gcd(ctx, &g, &nn, &dd);
  if (ok && !(g.len == 1 && g.limb[0] == 1u)) {
    ok = bn_divmod(ctx, &nn, NULL, &nn, &g) && bn_divmod(ctx, &dd, NULL, &dd, &g);
  }
  if (ok) {
    bn_swap(&r->n, &nn);
    bn_swap(&r->d, &dd);
  }
  bn_free(ctx, &nn);
  bn_free(ctx, &dd);
  bn_free(ctx, &g);
  return ok;
}

int rat_set_i64(bmfp_ctx *ctx, rat *r, int64_t n, int64_t d) {
  bn nn;
  bn dd;
  int ok;
  bn_init(&nn);
  bn_init(&dd);
  ok = bn_set_i64(ctx, &nn, n) && bn_set_i64(ctx, &dd, d) && rat_set(ctx, r, &nn, &dd);
  bn_free(ctx, &nn);
  bn_free(ctx, &dd);
  return ok;
}

int rat_is_zero(const rat *r) { return bn_is_zero(&r->n); }

int rat_equal(const rat *a, const rat *b) { return bn_cmp(&a->n, &b->n) == 0 && bn_cmp(&a->d, &b->d) == 0; }

int rat_cmp(bmfp_ctx *ctx, const rat *a, const rat *b, int *order) {
  bn left;
  bn right;
  int ok;
  bn_init(&left);
  bn_init(&right);
  ok = bn_mul(ctx, &left, &a->n, &b->d) && bn_mul(ctx, &right, &b->n, &a->d);
  if (ok) *order = bn_cmp(&left, &right);
  bn_free(ctx, &left);
  bn_free(ctx, &right);
  return ok;
}

/* a/b op c/d over the common denominator b*d: n = a*d +- c*b. */
static int add_or_sub(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b, int subtract) {
  bn left;
  bn right;
  bn den;
  int ok;
  bn_init(&left);
  bn_init(&right);
  bn_init(&den);
  ok = bn_mul(ctx, &left, &a->n, &b->d) && bn_mul(ctx, &right, &b->n, &a->d) && bn_mul(ctx, &den, &a->d, &b->d);
  ok = ok && (subtract ? bn_sub(ctx, &left, &left, &right) : bn_add(ctx, &left, &left, &right));
  ok = ok && rat_set(ctx, r, &left, &den);
  bn_free(ctx, &left);
  bn_free(ctx, &right);
  bn_free(ctx, &den);
  return ok;
}

int rat_add(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b) { return add_or_sub(ctx, r, a, b, 0); }

int rat_sub(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b) { return add_or_sub(ctx, r, a, b, 1); }

int rat_mul(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b) {
  bn num;
  bn den;
  int ok;
  bn_init(&num);
  bn_init(&den);
  ok = bn_mul(ctx, &num, &a->n, &b->n) && bn_mul(ctx, &den, &a->d, &b->d) && rat_set(ctx, r, &num, &den);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  return ok;
}

int rat_div(bmfp_ctx *ctx, rat *r, const rat *a, const rat *b) {
  bn num;
  bn den;
  int ok;
  if (bn_is_zero(&b->n)) return bmfp_fail(ctx, BMFP_E_ARGUMENT);
  bn_init(&num);
  bn_init(&den);
  ok = bn_mul(ctx, &num, &a->n, &b->d) && bn_mul(ctx, &den, &a->d, &b->n) && rat_set(ctx, r, &num, &den);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  return ok;
}

int rat_format(bmfp_ctx *ctx, const rat *r, char **text, size_t *length, size_t *size) {
  char *num_text;
  char *den_text;
  size_t num_length;
  size_t den_length;
  size_t num_size;
  size_t den_size;
  char *out;
  size_t capacity;
  if (!bn_to_decimal(ctx, &r->n, &num_text, &num_length, &num_size)) return 0;
  if (r->d.len == 1 && r->d.limb[0] == 1u) {
    *text = num_text;
    *length = num_length;
    *size = num_size;
    return 1;
  }
  if (!bn_to_decimal(ctx, &r->d, &den_text, &den_length, &den_size)) {
    bmfp_release(ctx, num_text, num_size);
    return 0;
  }
  capacity = num_length + den_length + 2;
  out = (char *)bmfp_alloc(ctx, capacity);
  if (out != NULL) {
    bmfp_copy_bytes(out, num_text, num_length);
    out[num_length] = '/';
    bmfp_copy_bytes(out + num_length + 1, den_text, den_length);
    out[num_length + 1 + den_length] = '\0';
  }
  bmfp_release(ctx, num_text, num_size);
  bmfp_release(ctx, den_text, den_size);
  if (out == NULL) return 0;
  *text = out;
  *length = num_length + 1 + den_length;
  *size = capacity;
  return 1;
}

/*
 * Bytes of the JavaScript white space or line terminator starting at `s` (what String.prototype.trim and the regular
 * expression class \s remove), or 0. ASCII: TAB, LF, VT, FF, CR, SPACE. UTF-8: U+00A0, U+1680, U+2000..U+200A,
 * U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
 */
static size_t js_space(const unsigned char *s, size_t available) {
  if (available >= 1 && (s[0] == 0x09 || s[0] == 0x0a || s[0] == 0x0b || s[0] == 0x0c || s[0] == 0x0d || s[0] == 0x20))
    return 1;
  if (available >= 2 && s[0] == 0xc2 && s[1] == 0xa0) return 2;
  if (available >= 3) {
    if (s[0] == 0xe1 && s[1] == 0x9a && s[2] == 0x80) return 3;
    if (s[0] == 0xe2 && s[1] == 0x80 && ((s[2] >= 0x80 && s[2] <= 0x8a) || s[2] == 0xa8 || s[2] == 0xa9 || s[2] == 0xaf))
      return 3;
    if (s[0] == 0xe2 && s[1] == 0x81 && s[2] == 0x9f) return 3;
    if (s[0] == 0xe3 && s[1] == 0x80 && s[2] == 0x80) return 3;
    if (s[0] == 0xef && s[1] == 0xbb && s[2] == 0xbf) return 3;
  }
  return 0;
}

/* Bytes of the JavaScript white space ending at `end` (exclusive), or 0. */
static size_t js_space_before(const unsigned char *start, const unsigned char *end) {
  size_t available = (size_t)(end - start);
  size_t width;
  for (width = 1; width <= 3 && width <= available; width++) {
    if (js_space(end - width, width) == width) return width;
  }
  return 0;
}

static int is_digit(unsigned char c) { return c >= '0' && c <= '9'; }

/* Exact value of sign, digits "<int><frac>" scaled by 10^(exponent - frac_count). */
static int build_decimal(bmfp_ctx *ctx, rat *r, int negative, const char *int_digits, size_t int_count,
                         const char *frac_digits, size_t frac_count, long exponent) {
  bn num;
  bn den;
  bn scale;
  bn frac;
  int ok = 1;
  long den_power;
  bn_init(&num);
  bn_init(&den);
  bn_init(&scale);
  bn_init(&frac);
  /* BigInt(`${integerDigits}${fractionDigits}` || '0'): the integer digits, then the fraction digits appended. */
  if (int_count > 0) ok = bn_from_digits(ctx, &num, int_digits, int_count);
  if (ok && frac_count > 0) {
    ok = bn_pow10(ctx, &scale, (unsigned long)frac_count) && bn_mul(ctx, &num, &num, &scale) &&
         bn_from_digits(ctx, &frac, frac_digits, frac_count) && bn_add(ctx, &num, &num, &frac);
  }
  den_power = (long)frac_count;
  if (ok && exponent > 0) {
    ok = bn_pow10(ctx, &scale, (unsigned long)exponent) && bn_mul(ctx, &num, &num, &scale);
  } else if (exponent < 0) {
    den_power += -exponent;
  }
  ok = ok && bn_pow10(ctx, &den, (unsigned long)den_power);
  if (ok && negative) bn_negate(&num);
  ok = ok && rat_set(ctx, r, &num, &den);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  bn_free(ctx, &scale);
  bn_free(ctx, &frac);
  return ok;
}

/* Parses an exponent's digits as Number.parseInt does, refusing magnitudes beyond MAX_DECIMAL_EXPONENT. */
static int read_exponent(bmfp_ctx *ctx, const unsigned char *s, size_t count, int negative, long *exponent) {
  long value = 0;
  size_t i;
  for (i = 0; i < count; i++) {
    value = value * 10 + (long)(s[i] - '0');
    if (value > MAX_DECIMAL_EXPONENT) return bmfp_fail(ctx, BMFP_E_LIMIT);
  }
  *exponent = negative ? -value : value;
  return 1;
}

int rat_parse_decimal(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched) {
  const unsigned char *s = (const unsigned char *)text;
  const unsigned char *end = s + length;
  const unsigned char *int_start;
  const unsigned char *frac_start = NULL;
  size_t int_count;
  size_t frac_count = 0;
  int negative = 0;
  long exponent = 0;
  size_t width;
  *matched = 0;
  /* text.trim() */
  while (s < end && (width = js_space(s, (size_t)(end - s))) > 0) s += width;
  while (end > s && (width = js_space_before(s, end)) > 0) end -= width;
  /* ^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$ */
  if (s < end && (*s == '+' || *s == '-')) {
    negative = *s == '-';
    s++;
  }
  int_start = s;
  while (s < end && is_digit(*s)) s++;
  int_count = (size_t)(s - int_start);
  if (s < end && *s == '.') {
    s++;
    frac_start = s;
    while (s < end && is_digit(*s)) s++;
    frac_count = (size_t)(s - frac_start);
  }
  if (s < end && (*s == 'e' || *s == 'E')) {
    int exponent_negative = 0;
    const unsigned char *digits;
    s++;
    if (s < end && (*s == '+' || *s == '-')) {
      exponent_negative = *s == '-';
      s++;
    }
    digits = s;
    while (s < end && is_digit(*s)) s++;
    if (s == digits) return 1;
    if (!read_exponent(ctx, digits, (size_t)(s - digits), exponent_negative, &exponent)) return 0;
  }
  if (s != end || (int_count == 0 && frac_count == 0)) return 1;
  if (!build_decimal(ctx, r, negative, (const char *)int_start, int_count, (const char *)frac_start, frac_count,
                     exponent))
    return 0;
  *matched = 1;
  return 1;
}

int rat_parse_leading_decimal(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched) {
  const unsigned char *s = (const unsigned char *)text;
  const unsigned char *end = s + length;
  const unsigned char *start;
  const unsigned char *p;
  size_t width;
  *matched = 0;
  /* ^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?) */
  while (s < end && (width = js_space(s, (size_t)(end - s))) > 0) s += width;
  start = s;
  p = s;
  if (p < end && (*p == '+' || *p == '-')) p++;
  if (p < end && is_digit(*p)) {
    while (p < end && is_digit(*p)) p++;
    if (p < end && *p == '.') {
      p++;
      while (p < end && is_digit(*p)) p++;
    }
  } else if (p + 1 < end && *p == '.' && is_digit(p[1])) {
    p++;
    while (p < end && is_digit(*p)) p++;
  } else {
    return 1;
  }
  if (p < end && (*p == 'e' || *p == 'E')) {
    const unsigned char *q = p + 1;
    if (q < end && (*q == '+' || *q == '-')) q++;
    if (q < end && is_digit(*q)) {
      while (q < end && is_digit(*q)) q++;
      p = q;
    }
  }
  return rat_parse_decimal(ctx, r, (const char *)start, (size_t)(p - start), matched);
}

int rat_parse_canonical(bmfp_ctx *ctx, rat *r, const char *text, size_t length, int *matched) {
  size_t i = 0;
  size_t num_start;
  size_t slash = length;
  bn num;
  bn den;
  int ok;
  *matched = 0;
  if (i < length && text[i] == '-') i++;
  num_start = i;
  while (i < length && is_digit((unsigned char)text[i])) i++;
  if (i == num_start) return 1;
  if (i < length) {
    size_t den_start;
    if (text[i] != '/') return 1;
    slash = i++;
    den_start = i;
    while (i < length && is_digit((unsigned char)text[i])) i++;
    if (i == den_start || i != length) return 1;
  }
  bn_init(&num);
  bn_init(&den);
  ok = bn_from_digits(ctx, &num, text + num_start, slash - num_start);
  if (ok && slash < length) ok = bn_from_digits(ctx, &den, text + slash + 1, length - slash - 1);
  else if (ok) ok = bn_set_u64(ctx, &den, 1);
  if (ok && text[0] == '-') bn_negate(&num);
  if (ok && bn_is_zero(&den)) {
    bn_free(ctx, &num);
    bn_free(ctx, &den);
    return 1;
  }
  ok = ok && rat_set(ctx, r, &num, &den);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  if (ok) *matched = 1;
  return ok;
}

/* roundHalfDown: round(n / d) with halves toward negative infinity, d > 0: -floor((d - 2n) / 2d). */
static int round_half_down(bmfp_ctx *ctx, bn *result, const bn *n, const bn *d) {
  bn twice;
  bn shifted;
  bn quotient;
  bn rest;
  int ok;
  bn_init(&twice);
  bn_init(&shifted);
  bn_init(&quotient);
  bn_init(&rest);
  ok = bn_shl(ctx, &twice, d, 1) && bn_shl(ctx, &shifted, n, 1) && bn_sub(ctx, &shifted, d, &shifted) &&
       bn_divmod(ctx, &quotient, &rest, &shifted, &twice);
  if (ok && !bn_is_zero(&rest) && bn_sign(&shifted) < 0) ok = bn_add_i64(ctx, &quotient, &quotient, -1);
  if (ok) {
    bn_negate(&quotient);
    bn_swap(result, &quotient);
  }
  bn_free(ctx, &twice);
  bn_free(ctx, &shifted);
  bn_free(ctx, &quotient);
  bn_free(ctx, &rest);
  return ok;
}

int rat_snap_small_denominator(bmfp_ctx *ctx, rat *r, const rat *value, unsigned max_denominator,
                               const rat *tolerance, int positive_only) {
  bn q;
  bn nq;
  bn a;
  bn dist_n;
  bn dist_d;
  bn left;
  bn right;
  bn best_a;
  bn best_q;
  bn best_dist_n;
  bn best_dist_d;
  int have_best = 0;
  int ok = 1;
  unsigned qi;
  bn_init(&q);
  bn_init(&nq);
  bn_init(&a);
  bn_init(&dist_n);
  bn_init(&dist_d);
  bn_init(&left);
  bn_init(&right);
  bn_init(&best_a);
  bn_init(&best_q);
  bn_init(&best_dist_n);
  bn_init(&best_dist_d);
  for (qi = 1; ok && qi <= max_denominator; qi++) {
    ok = bn_set_u64(ctx, &q, qi) && bn_mul(ctx, &nq, &value->n, &q) && round_half_down(ctx, &a, &nq, &value->d);
    if (!ok) break;
    if (positive_only && bn_sign(&a) < 1) ok = bn_set_u64(ctx, &a, 1);
    /* distN = |a*d - n*q|, distD = q*d */
    ok = ok && bn_mul(ctx, &dist_n, &a, &value->d) && bn_sub(ctx, &dist_n, &dist_n, &nq) &&
         bn_mul(ctx, &dist_d, &q, &value->d);
    if (!ok) break;
    bn_abs(&dist_n);
    /* skip when distN * tol.d > tol.n * distD */
    ok = bn_mul(ctx, &left, &dist_n, &tolerance->d) && bn_mul(ctx, &right, &tolerance->n, &dist_d);
    if (!ok) break;
    if (bn_cmp(&left, &right) > 0) continue;
    if (have_best) {
      /* better when distN * bestDistD < bestDistN * distD */
      ok = bn_mul(ctx, &left, &dist_n, &best_dist_d) && bn_mul(ctx, &right, &best_dist_n, &dist_d);
      if (!ok) break;
      if (bn_cmp(&left, &right) >= 0) continue;
    }
    ok = bn_copy(ctx, &best_a, &a) && bn_copy(ctx, &best_q, &q) && bn_copy(ctx, &best_dist_n, &dist_n) &&
         bn_copy(ctx, &best_dist_d, &dist_d);
    have_best = 1;
  }
  if (ok) ok = have_best ? rat_set(ctx, r, &best_a, &best_q) : rat_copy(ctx, r, value);
  bn_free(ctx, &q);
  bn_free(ctx, &nq);
  bn_free(ctx, &a);
  bn_free(ctx, &dist_n);
  bn_free(ctx, &dist_d);
  bn_free(ctx, &left);
  bn_free(ctx, &right);
  bn_free(ctx, &best_a);
  bn_free(ctx, &best_q);
  bn_free(ctx, &best_dist_n);
  bn_free(ctx, &best_dist_d);
  return ok;
}

int rat_snap_measure_length(bmfp_ctx *ctx, rat *r, const rat *length) {
  rat four;
  rat beats;
  rat tolerance;
  int ok;
  rat_init(&four);
  rat_init(&beats);
  rat_init(&tolerance);
  ok = rat_set_i64(ctx, &four, 4, 1) && rat_set_i64(ctx, &tolerance, 1, 4608) && rat_mul(ctx, &beats, length, &four) &&
       rat_snap_small_denominator(ctx, &beats, &beats, 48, &tolerance, 1) && rat_div(ctx, r, &beats, &four);
  rat_free(ctx, &four);
  rat_free(ctx, &beats);
  rat_free(ctx, &tolerance);
  return ok;
}

int rat_snap_value(bmfp_ctx *ctx, rat *r, const rat *value) {
  rat tolerance;
  bn num;
  bn den;
  int ok;
  if (rat_is_zero(value)) return rat_set_i64(ctx, r, 0, 1);
  rat_init(&tolerance);
  bn_init(&num);
  bn_init(&den);
  /* |n| * 1 / (d * 100000) */
  ok = bn_copy(ctx, &num, &value->n) && bn_mul_u32(ctx, &den, &value->d, 100000u);
  bn_abs(&num);
  ok = ok && rat_set(ctx, &tolerance, &num, &den) && rat_snap_small_denominator(ctx, r, value, 12, &tolerance, 0);
  rat_free(ctx, &tolerance);
  bn_free(ctx, &num);
  bn_free(ctx, &den);
  return ok;
}
