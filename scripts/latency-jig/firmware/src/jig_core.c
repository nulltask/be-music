#include "jig_core.h"

#include <ctype.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void jig_settings_default(jig_settings *settings) {
  settings->presses = JIG_DEFAULT_PRESSES;
  settings->min_gap_ms = JIG_DEFAULT_MIN_GAP_MS;
  settings->max_gap_ms = JIG_DEFAULT_MAX_GAP_MS;
  settings->threshold = JIG_DEFAULT_THRESHOLD;
  settings->timeout_ms = JIG_DEFAULT_TIMEOUT_MS;
  settings->hold_ms = JIG_DEFAULT_HOLD_MS;
  settings->quiet_limit = JIG_DEFAULT_QUIET_LIMIT;
  settings->key = JIG_DEFAULT_KEY;
}

#define JIG_MAX_WORDS 5

static void set_error(char *error, size_t error_size, const char *message) {
  if (error != NULL && error_size > 0) {
    snprintf(error, error_size, "%s", message);
  }
}

// Parses an unsigned decimal or 0x-prefixed hexadecimal number within `min`..`max`.
static bool parse_number(const char *word, uint32_t min, uint32_t max, uint32_t *out) {
  if (word == NULL || *word == '\0' || *word == '-' || *word == '+') return false;
  char *end = NULL;
  unsigned long value = strtoul(word, &end, 0);
  if (end == NULL || *end != '\0' || value < min || value > max) return false;
  *out = (uint32_t)value;
  return true;
}

jig_command jig_parse_command(const char *line, jig_settings *settings, char *error, size_t error_size) {
  char copy[96];
  snprintf(copy, sizeof copy, "%s", line);
  char *words[JIG_MAX_WORDS] = {0};
  size_t count = 0;
  for (char *word = strtok(copy, " \t\r\n"); word != NULL; word = strtok(NULL, " \t\r\n")) {
    if (count == JIG_MAX_WORDS) {
      set_error(error, error_size, "too many arguments");
      return JIG_CMD_INVALID;
    }
    for (char *c = word; *c != '\0'; c++) *c = (char)tolower((unsigned char)*c);
    words[count++] = word;
  }
  if (count == 0) return JIG_CMD_NONE;

  const char *name = words[0];
  if (strcmp(name, "help") == 0 || strcmp(name, "?") == 0) return count == 1 ? JIG_CMD_HELP : JIG_CMD_INVALID;
  if (strcmp(name, "status") == 0) return count == 1 ? JIG_CMD_STATUS : JIG_CMD_INVALID;
  if (strcmp(name, "stop") == 0) return count == 1 ? JIG_CMD_STOP : JIG_CMD_INVALID;
  if (strcmp(name, "level") == 0) return count == 1 ? JIG_CMD_LEVEL : JIG_CMD_INVALID;

  if (strcmp(name, "run") == 0) {
    jig_settings next = *settings;
    if (count > 4) {
      set_error(error, error_size, "usage: run [presses] [minGapMs] [maxGapMs]");
      return JIG_CMD_INVALID;
    }
    if (count > 1 && !parse_number(words[1], 1, 100000, &next.presses)) {
      set_error(error, error_size, "presses: 1 to 100000");
      return JIG_CMD_INVALID;
    }
    if (count > 2 && !parse_number(words[2], 50, 60000, &next.min_gap_ms)) {
      set_error(error, error_size, "minGapMs: 50 to 60000");
      return JIG_CMD_INVALID;
    }
    if (count > 3) {
      if (!parse_number(words[3], 50, 60000, &next.max_gap_ms)) {
        set_error(error, error_size, "maxGapMs: 50 to 60000");
        return JIG_CMD_INVALID;
      }
    } else if (next.max_gap_ms < next.min_gap_ms) {
      next.max_gap_ms = next.min_gap_ms;
    }
    if (next.max_gap_ms < next.min_gap_ms) {
      set_error(error, error_size, "maxGapMs must not be below minGapMs");
      return JIG_CMD_INVALID;
    }
    *settings = next;
    return JIG_CMD_RUN;
  }

  // `<setting> <value>`: one number for one setting.
  struct {
    const char *name;
    uint32_t min;
    uint32_t max;
  } const setters[] = {
      {"thr", 1, 4095}, {"timeout", 10, 10000}, {"hold", 1, 1000}, {"quiet", 1, 4095}, {"key", 0x04, 0xE7},
  };
  for (size_t i = 0; i < sizeof setters / sizeof setters[0]; i++) {
    if (strcmp(name, setters[i].name) != 0) continue;
    uint32_t value = 0;
    if (count != 2 || !parse_number(words[1], setters[i].min, setters[i].max, &value)) {
      char message[64];
      snprintf(message, sizeof message, "usage: %s <%" PRIu32 "..%" PRIu32 ">", setters[i].name, setters[i].min,
               setters[i].max);
      set_error(error, error_size, message);
      return JIG_CMD_INVALID;
    }
    switch (i) {
      case 0: settings->threshold = value; break;
      case 1: settings->timeout_ms = value; break;
      case 2: settings->hold_ms = value; break;
      case 3: settings->quiet_limit = value; break;
      default: settings->key = (uint8_t)value; break;
    }
    return JIG_CMD_SET;
  }

  set_error(error, error_size, "unknown command (help lists them)");
  return JIG_CMD_INVALID;
}

void jig_line_buffer_init(jig_line_buffer *buffer) {
  buffer->length = 0;
  buffer->overflow = false;
  buffer->text[0] = '\0';
}

bool jig_line_buffer_push(jig_line_buffer *buffer, char c) {
  if (c == '\r' || c == '\n') {
    bool complete = !buffer->overflow;
    buffer->text[complete ? buffer->length : 0] = '\0';
    buffer->length = 0;
    buffer->overflow = false;
    return complete;
  }
  if (buffer->overflow) return false;
  if (buffer->length + 1 >= sizeof buffer->text) {
    buffer->overflow = true;
    buffer->length = 0;
    return false;
  }
  buffer->text[buffer->length++] = c;
  return false;
}

void jig_level_init(jig_level *level) {
  level->count = 0;
  level->sum = 0;
  level->min = UINT16_MAX;
  level->max = 0;
}

void jig_level_add(jig_level *level, uint16_t sample) {
  level->count++;
  level->sum += sample;
  if (sample < level->min) level->min = sample;
  if (sample > level->max) level->max = sample;
}

uint16_t jig_level_mean(const jig_level *level) {
  return level->count == 0 ? 0 : (uint16_t)((level->sum + level->count / 2) / level->count);
}

uint16_t jig_level_span(const jig_level *level) {
  return level->count == 0 ? 0 : (uint16_t)(level->max - level->min);
}

void jig_detector_init(jig_detector *detector, uint16_t baseline, uint32_t threshold, uint32_t needed) {
  detector->baseline = baseline;
  detector->threshold = (int32_t)threshold;
  detector->needed = needed == 0 ? 1 : needed;
  detector->run = 0;
  detector->peak = 0;
  detector->triggered = false;
}

jig_detect jig_detector_feed(jig_detector *detector, uint16_t sample) {
  int32_t distance = (int32_t)sample - detector->baseline;
  if (distance < 0) distance = -distance;
  if (distance > detector->peak) detector->peak = distance;
  if (detector->triggered) return JIG_DETECT_NONE;
  if (distance < detector->threshold) {
    detector->run = 0;
    return JIG_DETECT_NONE;
  }
  detector->run++;
  if (detector->run >= detector->needed) {
    detector->triggered = true;
    return JIG_DETECT_TRIGGERED;
  }
  return detector->run == 1 ? JIG_DETECT_CANDIDATE : JIG_DETECT_NONE;
}

uint32_t jig_random_next(uint32_t *state) {
  uint32_t x = *state == 0 ? 0x9E3779B9u : *state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *state = x;
  return x;
}

uint32_t jig_random_range(uint32_t *state, uint32_t min, uint32_t max) {
  if (max <= min) return min;
  uint32_t span = max - min + 1;
  return min + jig_random_next(state) % span;
}

int jig_format_result(char *buffer, size_t size, const jig_result *result) {
  int written;
  switch (result->kind) {
    case JIG_RESULT_PRESS:
      written = snprintf(buffer, size, "P,%" PRIu32 ",%" PRIu64 ",%" PRIu64 ",%" PRIu64 ",%" PRIu64 ",%" PRIu64
                                       ",%" PRIu32 ",%" PRIu32,
                         result->index, result->queued_us, result->sent_us, result->onset_us,
                         result->onset_us - result->sent_us, result->sent_us - result->queued_us, result->peak,
                         result->quiet_span);
      break;
    case JIG_RESULT_TIMEOUT:
      written = snprintf(buffer, size, "T,%" PRIu32 ",%" PRIu64 ",%" PRIu64 ",,,%" PRIu64 ",%" PRIu32 ",%" PRIu32,
                         result->index, result->queued_us, result->sent_us, result->sent_us - result->queued_us,
                         result->peak, result->quiet_span);
      break;
    default:
      written = snprintf(buffer, size, "N,%" PRIu32 ",,,,,,,%" PRIu32, result->index, result->quiet_span);
      break;
  }
  return written < 0 || (size_t)written >= size ? -1 : written;
}
