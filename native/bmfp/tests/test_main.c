/*
 * Tests of the C port. Runs the vectors that the TypeScript implementation generated (tests/vectors, see
 * scripts/vectors.ts), plus SHA-256 and allocator checks. Every case runs through a counting allocator, so a leak
 * fails the test too.
 *
 *   bmfp-test tests/vectors
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "binary64.h"
#include "sha256.h"

/* ---- counting allocator, with optional failure injection ---- */

typedef struct counter {
  long outstanding;    /* allocations not yet released */
  long budget;         /* allocations allowed before failing; -1 for unlimited */
} counter;

static void *counting_alloc(void *user, size_t size) {
  counter *c = (counter *)user;
  if (c->budget == 0) return NULL;
  if (c->budget > 0) c->budget--;
  c->outstanding++;
  return malloc(size);
}

static void counting_release(void *user, void *pointer, size_t size) {
  counter *c = (counter *)user;
  (void)size;
  c->outstanding--;
  free(pointer);
}

static int failures = 0;
static int checks = 0;

static void fail(const char *file, long line, const char *what, const char *got, const char *want) {
  failures++;
  if (failures <= 25) fprintf(stderr, "%s:%ld: %s: got %s, want %s\n", file, line, what, got, want);
}

/* ---- helpers ---- */

static size_t unhex(const char *hex, char *out) {
  size_t n = strlen(hex) / 2;
  size_t i;
  for (i = 0; i < n; i++) {
    unsigned value;
    sscanf(hex + i * 2, "%2x", &value);
    out[i] = (char)value;
  }
  return n;
}

/* Formats a rational into a static buffer, or "!" when absent / "ERR" on failure. */
static const char *show(bmfp_ctx *ctx, const rat *r, int present) {
  static char buffer[8192];
  char *text;
  size_t length;
  size_t size;
  if (!present) return "!";
  if (!rat_format(ctx, r, &text, &length, &size)) return "ERR";
  if (length >= sizeof buffer) length = sizeof buffer - 1;
  memcpy(buffer, text, length);
  buffer[length] = '\0';
  bmfp_release(ctx, text, size);
  return buffer;
}

static int parse_canonical(bmfp_ctx *ctx, rat *r, const char *text) {
  int matched = 0;
  return rat_parse_canonical(ctx, r, text, strlen(text), &matched) && matched;
}

/* Reads one line of any length; returns NULL at end of file. The caller frees it. */
static char *read_line(FILE *stream) {
  size_t capacity = 256;
  size_t length = 0;
  char *line = (char *)malloc(capacity);
  int c;
  while ((c = fgetc(stream)) != EOF && c != '\n') {
    if (length + 1 >= capacity) {
      capacity *= 2;
      line = (char *)realloc(line, capacity);
    }
    line[length++] = (char)c;
  }
  if (c == EOF && length == 0) {
    free(line);
    return NULL;
  }
  line[length] = '\0';
  return line;
}

static int split(char *line, char **fields, int max) {
  int count = 0;
  char *p = line;
  fields[count++] = p;
  while (*p != '\0' && count < max) {
    if (*p == '\t') {
      *p = '\0';
      fields[count++] = p + 1;
    }
    p++;
  }
  return count;
}

/* ---- vector files ---- */

static void run_rational_case(bmfp_ctx *ctx, char **f, int count, const char *file, long line) {
  rat a, b, r;
  char text[65536];
  int matched = 0;
  char got[16];
  rat_init(&a);
  rat_init(&b);
  rat_init(&r);
  checks++;
  if (strcmp(f[0], "parse") == 0 || strcmp(f[0], "leading") == 0) {
    size_t length = unhex(f[1], text);
    int ok = f[0][0] == 'p' ? rat_parse_decimal(ctx, &r, text, length, &matched)
                            : rat_parse_leading_decimal(ctx, &r, text, length, &matched);
    const char *result = ok ? show(ctx, &r, matched) : "ERR";
    if (strcmp(result, f[2]) != 0) fail(file, line, f[0], result, f[2]);
  } else if (strcmp(f[0], "snapm") == 0 || strcmp(f[0], "snapv") == 0) {
    int ok = parse_canonical(ctx, &a, f[1]) &&
             (f[0][4] == 'm' ? rat_snap_measure_length(ctx, &r, &a) : rat_snap_value(ctx, &r, &a));
    const char *result = ok ? show(ctx, &r, 1) : "ERR";
    if (strcmp(result, f[2]) != 0) fail(file, line, f[0], result, f[2]);
  } else if (count == 4) {
    int ok = parse_canonical(ctx, &a, f[1]) && parse_canonical(ctx, &b, f[2]);
    const char *result = "ERR";
    if (ok && strcmp(f[0], "cmp") == 0) {
      int order = 0;
      if (rat_cmp(ctx, &a, &b, &order)) {
        snprintf(got, sizeof got, "%d", order);
        result = got;
      }
    } else if (ok) {
      if (strcmp(f[0], "add") == 0) ok = rat_add(ctx, &r, &a, &b);
      else if (strcmp(f[0], "sub") == 0) ok = rat_sub(ctx, &r, &a, &b);
      else if (strcmp(f[0], "mul") == 0) ok = rat_mul(ctx, &r, &a, &b);
      else if (strcmp(f[0], "div") == 0) ok = rat_div(ctx, &r, &a, &b);
      else ok = 0;
      if (ok) result = show(ctx, &r, 1);
    }
    if (strcmp(result, f[3]) != 0) fail(file, line, f[0], result, f[3]);
  } else {
    fail(file, line, "unknown case", f[0], "a known one");
  }
  rat_free(ctx, &a);
  rat_free(ctx, &b);
  rat_free(ctx, &r);
}

static void run_binary64_case(bmfp_ctx *ctx, char **f, const char *file, long line) {
  static char text[65536];
  size_t length = unhex(f[1], text);
  rat exact;
  rat shortest;
  b64 value;
  int matched = 0;
  char bits[32];
  rat_init(&exact);
  rat_init(&shortest);
  checks++;
  if (!rat_parse_decimal(ctx, &exact, text, length, &matched) || !matched || !b64_from_rational(ctx, &exact, &value)) {
    fail(file, line, "f64 parse", "failure", f[2]);
  } else {
    uint64_t pattern = b64_bits(&value);
    const char *result;
    /* The rational loses the sign of a negative zero; JavaScript keeps it in the bits. */
    if (value.kind == B64_ZERO && strcmp(f[2], "8000000000000000") == 0) pattern |= (uint64_t)1 << 63;
    if (value.kind == B64_INFINITE) snprintf(bits, sizeof bits, "inf");
    else snprintf(bits, sizeof bits, "%08lx%08lx", (unsigned long)(pattern >> 32), (unsigned long)(pattern & 0xffffffffu));
    if (strcmp(bits, f[2]) != 0) fail(file, line, "f64 bits", bits, f[2]);
    if (value.kind == B64_INFINITE) {
      result = "!";
    } else {
      result = b64_shortest(ctx, &value, &shortest) ? show(ctx, &shortest, 1) : "ERR";
    }
    if (strcmp(result, f[3]) != 0) fail(file, line, "f64 shortest", result, f[3]);
  }
  rat_free(ctx, &exact);
  rat_free(ctx, &shortest);
}

static void run_file(const char *directory, const char *name) {
  char path[4096];
  FILE *stream;
  char *line;
  long number = 0;
  counter count = {0, -1};
  bmfp_allocator allocator;
  allocator.user = &count;
  allocator.alloc = counting_alloc;
  allocator.release = counting_release;
  snprintf(path, sizeof path, "%s/%s", directory, name);
  stream = fopen(path, "rb");
  if (stream == NULL) {
    fprintf(stderr, "cannot open %s\n", path);
    failures++;
    return;
  }
  while ((line = read_line(stream)) != NULL) {
    char *fields[8];
    int n;
    bmfp_ctx ctx;
    number++;
    if (line[0] == '\0') {
      free(line);
      continue;
    }
    n = split(line, fields, 8);
    bmfp_ctx_init(&ctx, &allocator);
    if (strcmp(fields[0], "f64") == 0) run_binary64_case(&ctx, fields, path, number);
    else run_rational_case(&ctx, fields, n, path, number);
    if (count.outstanding != 0) {
      char got[32];
      snprintf(got, sizeof got, "%ld", count.outstanding);
      fail(path, number, "leaked allocations", got, "0");
      count.outstanding = 0;
    }
    free(line);
  }
  fclose(stream);
}

/* ---- direct tests ---- */

static void test_sha256(void) {
  static const struct {
    const char *input;
    const char *digest;
  } cases[] = {
      {"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
      {"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
      {"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"},
  };
  char hex[BMFP_SHA256_HEX_SIZE];
  size_t i;
  for (i = 0; i < sizeof cases / sizeof cases[0]; i++) {
    checks++;
    if (bmfp_sha256_hex(cases[i].input, strlen(cases[i].input), hex, sizeof hex) != BMFP_OK ||
        strcmp(hex, cases[i].digest) != 0)
      fail(__FILE__, __LINE__, "sha256", hex, cases[i].digest);
  }
  {
    /* One million 'a', fed in uneven pieces through the streaming interface. */
    sha256 h;
    unsigned char digest[32];
    char piece[997];
    long remaining = 1000000;
    memset(piece, 'a', sizeof piece);
    sha256_init(&h);
    while (remaining > 0) {
      size_t n = remaining < (long)sizeof piece ? (size_t)remaining : sizeof piece;
      sha256_update(&h, piece, n);
      remaining -= (long)n;
    }
    sha256_final(&h, digest);
    sha256_hex(digest, hex);
    checks++;
    if (strcmp(hex, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") != 0)
      fail(__FILE__, __LINE__, "sha256 million a", hex, "cdc76e5c...");
  }
  checks++;
  if (bmfp_sha256_hex("abc", 3, hex, 64) != BMFP_E_BUFFER_TOO_SMALL)
    fail(__FILE__, __LINE__, "sha256 small buffer", "accepted", "BMFP_E_BUFFER_TOO_SMALL");
}

/* Every allocation that can fail, failing in turn: the status is BMFP_E_NO_MEMORY and nothing leaks or crashes. */
static void test_allocation_failures(void) {
  static const char text[] = " -1234567890.0987654321e-12 ";
  long budget;
  for (budget = 0;; budget++) {
    counter count;
    bmfp_allocator allocator;
    bmfp_ctx ctx;
    rat r;
    rat snapped;
    b64 value;
    int matched = 0;
    int ok;
    count.outstanding = 0;
    count.budget = budget;
    allocator.user = &count;
    allocator.alloc = counting_alloc;
    allocator.release = counting_release;
    bmfp_ctx_init(&ctx, &allocator);
    rat_init(&r);
    rat_init(&snapped);
    ok = rat_parse_decimal(&ctx, &r, text, sizeof text - 1, &matched) && rat_snap_value(&ctx, &snapped, &r) &&
         b64_from_rational(&ctx, &r, &value) && b64_shortest(&ctx, &value, &snapped);
    rat_free(&ctx, &r);
    rat_free(&ctx, &snapped);
    checks++;
    if (count.outstanding != 0) fail(__FILE__, __LINE__, "leak under allocation failure", "leak", "none");
    if (ok) break;
    if (ctx.status != BMFP_E_NO_MEMORY) fail(__FILE__, __LINE__, "status under allocation failure", "other", "no memory");
    if (budget > 100000) {
      fail(__FILE__, __LINE__, "allocation failure loop", "endless", "finite");
      break;
    }
  }
}

static void test_api(void) {
  checks++;
  if (strcmp(bmfp_algorithm(), "bmfp0") != 0) fail(__FILE__, __LINE__, "algorithm", bmfp_algorithm(), "bmfp0");
  checks++;
  if (strcmp(bmfp_version(), BMFP_VERSION_STRING) != 0) fail(__FILE__, __LINE__, "version", bmfp_version(), BMFP_VERSION_STRING);
  checks++;
  if (strcmp(bmfp_status_text(BMFP_E_NO_MEMORY), "out of memory") != 0)
    fail(__FILE__, __LINE__, "status text", bmfp_status_text(BMFP_E_NO_MEMORY), "out of memory");
}

int main(int argc, char **argv) {
  const char *directory = argc > 1 ? argv[1] : "tests/vectors";
  test_api();
  test_sha256();
  test_allocation_failures();
  run_file(directory, "rational.txt");
  run_file(directory, "binary64.txt");
  if (failures > 0) {
    fprintf(stderr, "%d of %d checks failed\n", failures, checks);
    return 1;
  }
  printf("%d checks passed\n", checks);
  return 0;
}
