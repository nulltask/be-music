/*
 * bmfp: command-line front end of the library. File input and output happen only here; the library itself does none.
 *
 *   bmfp --version
 *   bmfp sha256 [FILE]   SHA-256 of FILE (or standard input), as a chart file hash
 *
 * Fingerprint commands follow once the chart reader is ported.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bmfp.h"

static void usage(FILE *stream) {
  fputs("usage: bmfp --version\n"
        "       bmfp sha256 [FILE]\n",
        stream);
}

/* Reads a whole stream into a malloc'd buffer. Returns 0 on failure. */
static int read_all(FILE *stream, unsigned char **data, size_t *size) {
  size_t capacity = 65536;
  size_t length = 0;
  unsigned char *buffer = (unsigned char *)malloc(capacity);
  if (buffer == NULL) return 0;
  for (;;) {
    size_t got = fread(buffer + length, 1, capacity - length, stream);
    length += got;
    if (got == 0) break;
    if (length == capacity) {
      unsigned char *grown;
      if (capacity > ((size_t)-1) / 2) break;
      grown = (unsigned char *)realloc(buffer, capacity * 2);
      if (grown == NULL) {
        free(buffer);
        return 0;
      }
      buffer = grown;
      capacity *= 2;
    }
  }
  if (ferror(stream)) {
    free(buffer);
    return 0;
  }
  *data = buffer;
  *size = length;
  return 1;
}

static int command_sha256(const char *path) {
  FILE *stream = stdin;
  unsigned char *data = NULL;
  size_t size = 0;
  char hex[BMFP_SHA256_HEX_SIZE];
  bmfp_status status;
  if (path != NULL && strcmp(path, "-") != 0) {
    stream = fopen(path, "rb");
    if (stream == NULL) {
      fprintf(stderr, "bmfp: cannot open %s\n", path);
      return 1;
    }
  }
  if (!read_all(stream, &data, &size)) {
    fprintf(stderr, "bmfp: cannot read %s\n", path != NULL ? path : "standard input");
    if (stream != stdin) fclose(stream);
    return 1;
  }
  if (stream != stdin) fclose(stream);
  status = bmfp_sha256_hex(data, size, hex, sizeof hex);
  free(data);
  if (status != BMFP_OK) {
    fprintf(stderr, "bmfp: %s\n", bmfp_status_text(status));
    return 1;
  }
  printf("%s\n", hex);
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "--version") == 0) {
    printf("bmfp %s (%s)\n", bmfp_version(), bmfp_algorithm());
    return 0;
  }
  if (argc >= 2 && (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0)) {
    usage(stdout);
    return 0;
  }
  if (argc >= 2 && strcmp(argv[1], "sha256") == 0 && argc <= 3) {
    return command_sha256(argc == 3 ? argv[2] : NULL);
  }
  usage(stderr);
  return 2;
}
