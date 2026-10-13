/* The public API (include/bmfp.h). */
#include "sha256.h"

const char *bmfp_version(void) { return BMFP_VERSION_STRING; }

const char *bmfp_algorithm(void) { return "bmfp0"; }

const char *bmfp_status_text(bmfp_status status) {
  switch (status) {
  case BMFP_OK:
    return "ok";
  case BMFP_E_ARGUMENT:
    return "invalid argument";
  case BMFP_E_NO_MEMORY:
    return "out of memory";
  case BMFP_E_BUFFER_TOO_SMALL:
    return "output buffer too small";
  case BMFP_E_LIMIT:
    return "input exceeds a limit";
  case BMFP_E_SYNTAX:
    return "malformed input";
  default:
    return "unknown status";
  }
}

bmfp_status bmfp_sha256_hex(const void *data, size_t size, char *out, size_t out_size) {
  sha256 h;
  unsigned char digest[32];
  if ((data == NULL && size > 0) || out == NULL) return BMFP_E_ARGUMENT;
  if (out_size < BMFP_SHA256_HEX_SIZE) return BMFP_E_BUFFER_TOO_SMALL;
  sha256_init(&h);
  if (size > 0) sha256_update(&h, data, size);
  sha256_final(&h, digest);
  sha256_hex(digest, out);
  return BMFP_OK;
}
