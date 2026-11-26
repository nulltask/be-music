// Host test of the jig's core: `cc -std=c11 -Wall -Wextra -Werror -I../src ../src/jig_core.c jig_core_test.c`
// (scripts/latency-jig/firmware/test/run.sh), run on CI by .github/workflows/latency-jig.yml.
#include <stdio.h>
#include <string.h>

#include "jig_core.h"

static int failures = 0;

#define CHECK(condition)                                                \
  do {                                                                  \
    if (!(condition)) {                                                 \
      fprintf(stderr, "%s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #condition); \
      failures++;                                                       \
    }                                                                   \
  } while (0)

static void test_commands(void) {
  jig_settings settings;
  jig_settings_default(&settings);
  char error[96] = "";

  CHECK(jig_parse_command("", &settings, error, sizeof error) == JIG_CMD_NONE);
  CHECK(jig_parse_command("  \r\n", &settings, error, sizeof error) == JIG_CMD_NONE);
  CHECK(jig_parse_command("HELP", &settings, error, sizeof error) == JIG_CMD_HELP);
  CHECK(jig_parse_command("status", &settings, error, sizeof error) == JIG_CMD_STATUS);
  CHECK(jig_parse_command("stop", &settings, error, sizeof error) == JIG_CMD_STOP);
  CHECK(jig_parse_command("level", &settings, error, sizeof error) == JIG_CMD_LEVEL);

  // `run` keeps the settings it is not given.
  CHECK(jig_parse_command("run", &settings, error, sizeof error) == JIG_CMD_RUN);
  CHECK(settings.presses == JIG_DEFAULT_PRESSES);
  CHECK(jig_parse_command("run 50 200 400", &settings, error, sizeof error) == JIG_CMD_RUN);
  CHECK(settings.presses == 50 && settings.min_gap_ms == 200 && settings.max_gap_ms == 400);
  // A minimum above the kept maximum raises the maximum with it.
  CHECK(jig_parse_command("run 10 900", &settings, error, sizeof error) == JIG_CMD_RUN);
  CHECK(settings.min_gap_ms == 900 && settings.max_gap_ms == 900);

  // An invalid line changes nothing.
  jig_settings before = settings;
  CHECK(jig_parse_command("run 10 500 400", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(strstr(error, "maxGapMs") != NULL);
  CHECK(jig_parse_command("run 0", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(jig_parse_command("run -5", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(jig_parse_command("run 10x", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(memcmp(&before, &settings, sizeof settings) == 0);

  CHECK(jig_parse_command("thr 250", &settings, error, sizeof error) == JIG_CMD_SET);
  CHECK(settings.threshold == 250);
  CHECK(jig_parse_command("thr 5000", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(strstr(error, "thr") != NULL);
  CHECK(jig_parse_command("timeout 800", &settings, error, sizeof error) == JIG_CMD_SET);
  CHECK(settings.timeout_ms == 800);
  CHECK(jig_parse_command("hold 40", &settings, error, sizeof error) == JIG_CMD_SET);
  CHECK(settings.hold_ms == 40);
  CHECK(jig_parse_command("quiet 80", &settings, error, sizeof error) == JIG_CMD_SET);
  CHECK(settings.quiet_limit == 80);
  CHECK(jig_parse_command("key 0x16", &settings, error, sizeof error) == JIG_CMD_SET);
  CHECK(settings.key == 0x16);
  CHECK(jig_parse_command("key 0x02", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(jig_parse_command("key", &settings, error, sizeof error) == JIG_CMD_INVALID);

  CHECK(jig_parse_command("explode", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(strstr(error, "unknown") != NULL);
  CHECK(jig_parse_command("status now", &settings, error, sizeof error) == JIG_CMD_INVALID);
  CHECK(jig_parse_command("run 1 2 3 4 5", &settings, error, sizeof error) == JIG_CMD_INVALID);
}

static void test_line_buffer(void) {
  jig_line_buffer buffer;
  jig_line_buffer_init(&buffer);
  const char *input = "run 5\r\n";
  bool complete = false;
  for (const char *c = input; *c != '\0' && !complete; c++) complete = jig_line_buffer_push(&buffer, *c);
  CHECK(complete);
  CHECK(strcmp(buffer.text, "run 5") == 0);
  // The \n after \r ends an empty line.
  CHECK(jig_line_buffer_push(&buffer, '\n'));
  CHECK(strcmp(buffer.text, "") == 0);

  // An overlong line is dropped whole, and the next line is whole again.
  for (int i = 0; i < 200; i++) CHECK(!jig_line_buffer_push(&buffer, 'x'));
  CHECK(!jig_line_buffer_push(&buffer, '\n'));
  for (const char *c = "stop"; *c != '\0'; c++) jig_line_buffer_push(&buffer, *c);
  CHECK(jig_line_buffer_push(&buffer, '\n'));
  CHECK(strcmp(buffer.text, "stop") == 0);
}

static void test_level(void) {
  jig_level level;
  jig_level_init(&level);
  CHECK(jig_level_mean(&level) == 0 && jig_level_span(&level) == 0);
  const uint16_t samples[] = {2040, 2050, 2060, 2049};
  for (size_t i = 0; i < 4; i++) jig_level_add(&level, samples[i]);
  CHECK(jig_level_mean(&level) == 2050);
  CHECK(jig_level_span(&level) == 20);
}

static void test_detector(void) {
  jig_detector detector;
  jig_detector_init(&detector, 2048, 300, 2);
  CHECK(jig_detector_feed(&detector, 2100) == JIG_DETECT_NONE);
  // One sample over the threshold, then back: a spike, not an onset.
  CHECK(jig_detector_feed(&detector, 2400) == JIG_DETECT_CANDIDATE);
  CHECK(jig_detector_feed(&detector, 2050) == JIG_DETECT_NONE);
  // Two in a row, either side of the resting level.
  CHECK(jig_detector_feed(&detector, 1700) == JIG_DETECT_CANDIDATE);
  CHECK(jig_detector_feed(&detector, 2500) == JIG_DETECT_TRIGGERED);
  // Once triggered it only tracks the peak.
  CHECK(jig_detector_feed(&detector, 4000) == JIG_DETECT_NONE);
  CHECK(detector.peak == 1952);

  jig_detector_init(&detector, 2048, 300, 1);
  CHECK(jig_detector_feed(&detector, 2348) == JIG_DETECT_TRIGGERED);
}

static void test_random(void) {
  uint32_t state = 1;
  uint32_t first = jig_random_next(&state);
  uint32_t again = 1;
  CHECK(jig_random_next(&again) == first);
  uint32_t zero = 0;
  CHECK(jig_random_next(&zero) != 0);
  for (int i = 0; i < 1000; i++) {
    uint32_t value = jig_random_range(&state, 300, 800);
    CHECK(value >= 300 && value <= 800);
  }
  CHECK(jig_random_range(&state, 500, 500) == 500);
  CHECK(jig_random_range(&state, 600, 500) == 600);
}

static void test_format(void) {
  char line[128];
  jig_result press = {JIG_RESULT_PRESS, 7, 1000000, 1000420, 1029420, 1500, 12};
  CHECK(jig_format_result(line, sizeof line, &press) > 0);
  CHECK(strcmp(line, "P,7,1000000,1000420,1029420,29000,420,1500,12") == 0);

  jig_result timeout = {JIG_RESULT_TIMEOUT, 8, 2000000, 2000900, 0, 40, 9};
  CHECK(jig_format_result(line, sizeof line, &timeout) > 0);
  CHECK(strcmp(line, "T,8,2000000,2000900,,,900,40,9") == 0);

  jig_result noisy = {JIG_RESULT_NOISY, 9, 0, 0, 0, 0, 400};
  CHECK(jig_format_result(line, sizeof line, &noisy) > 0);
  CHECK(strcmp(line, "N,9,,,,,,,400") == 0);

  char tiny[8];
  CHECK(jig_format_result(tiny, sizeof tiny, &press) < 0);
}

int main(void) {
  test_commands();
  test_line_buffer();
  test_level();
  test_detector();
  test_random();
  test_format();
  if (failures > 0) {
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  puts("jig_core: all checks passed");
  return 0;
}
