// The latency jig's logic that needs no hardware: settings and the serial commands that change them, the onset
// detector, the level statistics, the random gaps and the result lines. `main.c` drives it on the Pico; the host test
// (`test/jig_core_test.c`) runs it on a computer.
#ifndef JIG_CORE_H
#define JIG_CORE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// HID usage of the key the jig presses by default: Z, lane 1 of the 7 KEY layout.
#define JIG_DEFAULT_KEY 0x1D
#define JIG_DEFAULT_PRESSES 300u
#define JIG_DEFAULT_MIN_GAP_MS 300u
#define JIG_DEFAULT_MAX_GAP_MS 800u
// ADC counts (12 bits over 3.3 V: about 0.8 mV each) the signal must move from its resting level.
#define JIG_DEFAULT_THRESHOLD 300u
#define JIG_DEFAULT_TIMEOUT_MS 500u
#define JIG_DEFAULT_HOLD_MS 30u
// Samples in a row over the threshold that count as the sound's onset (about 2 µs apart).
#define JIG_ONSET_SAMPLES 2u
// The most the resting signal may move (peak to peak, ADC counts) for a press to go ahead.
#define JIG_DEFAULT_QUIET_LIMIT 150u

typedef struct {
  uint32_t presses;
  uint32_t min_gap_ms;
  uint32_t max_gap_ms;
  uint32_t threshold;
  uint32_t timeout_ms;
  uint32_t hold_ms;
  uint32_t quiet_limit;
  uint8_t key;
} jig_settings;

void jig_settings_default(jig_settings *settings);

typedef enum {
  JIG_CMD_NONE,
  JIG_CMD_HELP,
  JIG_CMD_STATUS,
  JIG_CMD_RUN,
  JIG_CMD_STOP,
  JIG_CMD_LEVEL,
  JIG_CMD_SET,
  JIG_CMD_INVALID,
} jig_command;

// Parses one command line and applies what it sets to `settings` (only when the whole line is valid). On
// JIG_CMD_INVALID, `error` holds why.
jig_command jig_parse_command(const char *line, jig_settings *settings, char *error, size_t error_size);

// Collects serial input into lines.
typedef struct {
  char text[96];
  size_t length;
  bool overflow;
} jig_line_buffer;

void jig_line_buffer_init(jig_line_buffer *buffer);
// Adds one character; returns true when it ends a line, whose text is then in `buffer->text` until the next push.
// A line longer than the buffer is dropped whole.
bool jig_line_buffer_push(jig_line_buffer *buffer, char c);

// Running minimum, maximum and mean of the ADC samples.
typedef struct {
  uint32_t count;
  uint64_t sum;
  uint16_t min;
  uint16_t max;
} jig_level;

void jig_level_init(jig_level *level);
void jig_level_add(jig_level *level, uint16_t sample);
uint16_t jig_level_mean(const jig_level *level);
uint16_t jig_level_span(const jig_level *level);

typedef enum {
  JIG_DETECT_NONE,
  // This sample starts a run over the threshold: the onset if the run lasts.
  JIG_DETECT_CANDIDATE,
  // The run reached JIG_ONSET_SAMPLES: the onset was the candidate.
  JIG_DETECT_TRIGGERED,
} jig_detect;

typedef struct {
  int32_t baseline;
  int32_t threshold;
  uint32_t needed;
  uint32_t run;
  int32_t peak;
  bool triggered;
} jig_detector;

void jig_detector_init(jig_detector *detector, uint16_t baseline, uint32_t threshold, uint32_t needed);
jig_detect jig_detector_feed(jig_detector *detector, uint16_t sample);

// xorshift32: the gaps between presses, so they do not lock to the player's frame rate.
uint32_t jig_random_next(uint32_t *state);
// A value from `min` to `max` inclusive (`min` when `max` <= `min`).
uint32_t jig_random_range(uint32_t *state, uint32_t min, uint32_t max);

typedef enum {
  // The sound arrived.
  JIG_RESULT_PRESS,
  // No sound within the timeout.
  JIG_RESULT_TIMEOUT,
  // The signal was not quiet before the press, so the press was skipped.
  JIG_RESULT_NOISY,
} jig_result_kind;

typedef struct {
  jig_result_kind kind;
  uint32_t index;
  // When the key-down report was queued, and when the host took it (its transfer completed), in µs since boot.
  uint64_t queued_us;
  uint64_t sent_us;
  // When the sound's onset reached the ADC (JIG_RESULT_PRESS only).
  uint64_t onset_us;
  // The largest distance from the resting level seen (ADC counts).
  uint32_t peak;
  // The resting level's peak-to-peak before the press (ADC counts).
  uint32_t quiet_span;
} jig_result;

// The CSV header the result lines follow, as a comment line.
#define JIG_RESULT_HEADER "# kind,index,queuedUs,sentUs,onsetUs,latencyUs,usbUs,peak,quietSpan"

// Formats `result` as one CSV line (no newline); returns the length, or a negative value when it does not fit.
int jig_format_result(char *buffer, size_t size, const jig_result *result);

#endif
