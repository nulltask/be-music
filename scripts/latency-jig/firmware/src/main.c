// Be-Music latency jig: presses a key as a USB keyboard and times how long the computer takes to make a sound.
//
// For each press it waits a random gap, checks that the audio input is quiet, sends a key-down report and samples
// the ADC until the signal leaves its resting level. The key-down time is when the host took the report (its
// transfer completed), so the 1 ms USB polling does not count against the computer. Results go out on the USB
// serial port as CSV lines (`jig_core.h`); commands come in on it (`help` lists them).
//
// See docs/latency-jig.md for the wiring and the procedure.
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "hardware/adc.h"
#include "jig_core.h"
#include "pico/stdlib.h"
#include "tusb.h"

// The audio input: ADC0 on GP26, biased to mid-scale (docs/latency-jig.md).
#define JIG_ADC_GPIO 26
#define JIG_ADC_INPUT 0
// How long the input must stay quiet before a press, and how long to wait for that.
#define JIG_QUIET_WINDOW_US 20000ull
#define JIG_QUIET_WAIT_US 1000000ull
// How long to keep sampling after the onset, for the peak.
#define JIG_PEAK_WINDOW_US 5000ull
// USB is serviced once per this many ADC samples (about 2 µs each) while a press is being timed.
#define JIG_SERVICE_EVERY 32u
// How long to wait for the host to take a key report.
#define JIG_REPORT_WAIT_US 100000ull

#if defined(PICO_RP2350) && PICO_RP2350
#define JIG_CHIP "rp2350"
#else
#define JIG_CHIP "rp2040"
#endif

static jig_settings settings;
static jig_line_buffer line;
static uint32_t random_state;
static bool running;
static bool stop_requested;

// The key-down report in flight, and when the host took it.
static bool down_pending;
static uint64_t down_sent_us;

static void led(bool on) {
#ifdef PICO_DEFAULT_LED_PIN
  gpio_put(PICO_DEFAULT_LED_PIN, on);
#else
  (void)on;
#endif
}

// Writes `text` to the serial port, waiting a little for room; drops what does not fit when nobody reads.
static void serial_write(const char *text) {
  size_t length = strlen(text);
  uint64_t deadline = time_us_64() + 200000ull;
  while (length > 0) {
    uint32_t written = tud_cdc_write(text, (uint32_t)length);
    text += written;
    length -= written;
    if (length == 0) break;
    tud_cdc_write_flush();
    tud_task();
    if (time_us_64() > deadline) break;
  }
  tud_cdc_write_flush();
}

static void serial_printf(const char *format, ...) {
  char buffer[256];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof buffer, format, args);
  va_end(args);
  serial_write(buffer);
}

static void handle_line(const char *text);

// Reads the serial input. During a run only `stop` is taken.
static void poll_commands(void) {
  char c;
  while (tud_cdc_available() > 0 && tud_cdc_read(&c, 1) == 1) {
    if (!jig_line_buffer_push(&line, c)) continue;
    if (!running) {
      char text[sizeof line.text];
      memcpy(text, line.text, sizeof text);
      handle_line(text);
      continue;
    }
    jig_settings scratch = settings;
    jig_command command = jig_parse_command(line.text, &scratch, NULL, 0);
    if (command == JIG_CMD_STOP) {
      stop_requested = true;
    } else if (command != JIG_CMD_NONE) {
      serial_write("# busy: only stop works during a run\n");
    }
  }
}

static void service(void) {
  tud_task();
  poll_commands();
}

static void wait_serviced(uint64_t us) {
  uint64_t end = time_us_64() + us;
  while (time_us_64() < end && !stop_requested) service();
}

static jig_level measure_level(uint64_t window_us) {
  jig_level level;
  jig_level_init(&level);
  uint64_t end = time_us_64() + window_us;
  uint32_t count = 0;
  while (time_us_64() < end) {
    jig_level_add(&level, adc_read());
    if (++count % JIG_SERVICE_EVERY == 0) service();
  }
  return level;
}

// Sends a keyboard report holding `key` (0 releases every key).
static bool send_key(uint8_t key) {
  uint64_t deadline = time_us_64() + JIG_REPORT_WAIT_US;
  while (!tud_hid_ready()) {
    if (time_us_64() > deadline) return false;
    tud_task();
  }
  uint8_t keycodes[6] = {key, 0, 0, 0, 0, 0};
  return tud_hid_keyboard_report(0, 0, key == 0 ? NULL : keycodes);
}

void tud_hid_report_complete_cb(uint8_t instance, uint8_t const *report, uint16_t len) {
  (void)instance;
  // A boot keyboard report: modifiers, reserved, then the key codes.
  if (down_pending && len >= 3 && report[2] != 0) {
    down_sent_us = time_us_64();
    down_pending = false;
  }
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t *buffer,
                               uint16_t reqlen) {
  (void)instance;
  (void)report_id;
  (void)report_type;
  (void)buffer;
  (void)reqlen;
  return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id, hid_report_type_t report_type, uint8_t const *buffer,
                           uint16_t bufsize) {
  (void)instance;
  (void)report_id;
  (void)report_type;
  (void)buffer;
  (void)bufsize;
}

// Times one press into `result`. Returns false when the host did not take the key report.
static bool press_once(uint32_t index, jig_result *result) {
  memset(result, 0, sizeof *result);
  result->index = index;

  jig_level level;
  uint64_t quiet_deadline = time_us_64() + JIG_QUIET_WAIT_US;
  do {
    level = measure_level(JIG_QUIET_WINDOW_US);
  } while (jig_level_span(&level) > settings.quiet_limit && time_us_64() < quiet_deadline && !stop_requested);
  result->quiet_span = jig_level_span(&level);
  if (result->quiet_span > settings.quiet_limit) {
    result->kind = JIG_RESULT_NOISY;
    return true;
  }

  jig_detector detector;
  jig_detector_init(&detector, jig_level_mean(&level), settings.threshold, JIG_ONSET_SAMPLES);
  down_pending = true;
  down_sent_us = 0;
  if (!send_key(settings.key)) {
    down_pending = false;
    return false;
  }
  result->queued_us = time_us_64();

  uint64_t deadline = result->queued_us + (uint64_t)settings.timeout_ms * 1000ull;
  uint64_t candidate_us = 0;
  bool found = false;
  uint32_t count = 0;
  for (;;) {
    uint64_t now = time_us_64();
    jig_detect detect = jig_detector_feed(&detector, adc_read());
    if (detect == JIG_DETECT_CANDIDATE) {
      candidate_us = now;
    } else if (detect == JIG_DETECT_TRIGGERED) {
      result->onset_us = detector.needed == 1 ? now : candidate_us;
      found = true;
      break;
    }
    if (now >= deadline) break;
    // Services USB only: the completion callback stamps the key-down's transfer.
    if (++count % JIG_SERVICE_EVERY == 0) tud_task();
  }
  if (found) {
    uint64_t peak_end = time_us_64() + JIG_PEAK_WINDOW_US;
    while (time_us_64() < peak_end) jig_detector_feed(&detector, adc_read());
  }
  result->peak = (uint32_t)detector.peak;

  // The completion may still be queued for `tud_task`.
  uint64_t wait_end = time_us_64() + JIG_REPORT_WAIT_US;
  while (down_pending && time_us_64() < wait_end) tud_task();
  if (down_pending) {
    down_pending = false;
    send_key(0);
    return false;
  }
  result->sent_us = down_sent_us;
  result->kind = found ? JIG_RESULT_PRESS : JIG_RESULT_TIMEOUT;

  uint64_t release_at = result->queued_us + (uint64_t)settings.hold_ms * 1000ull;
  while (time_us_64() < release_at) tud_task();
  send_key(0);
  return true;
}

static void run_presses(void) {
  if (!tud_mounted()) {
    serial_write("# error: the USB keyboard is not connected to a host\n");
    return;
  }
  running = true;
  stop_requested = false;
  led(true);
  serial_printf("# run presses=%lu gapMs=%lu-%lu threshold=%lu timeoutMs=%lu holdMs=%lu quiet=%lu key=0x%02x chip=%s\n",
                (unsigned long)settings.presses, (unsigned long)settings.min_gap_ms,
                (unsigned long)settings.max_gap_ms, (unsigned long)settings.threshold,
                (unsigned long)settings.timeout_ms, (unsigned long)settings.hold_ms,
                (unsigned long)settings.quiet_limit, settings.key, JIG_CHIP);
  serial_write(JIG_RESULT_HEADER "\n");

  uint32_t timed = 0, timeouts = 0, noisy = 0;
  for (uint32_t index = 1; index <= settings.presses && !stop_requested; index++) {
    wait_serviced((uint64_t)jig_random_range(&random_state, settings.min_gap_ms, settings.max_gap_ms) * 1000ull);
    if (stop_requested) break;
    jig_result result;
    if (!press_once(index, &result)) {
      serial_write("# error: the host did not take the key report\n");
      break;
    }
    char text[128];
    if (jig_format_result(text, sizeof text, &result) > 0) {
      serial_write(text);
      serial_write("\n");
    }
    if (result.kind == JIG_RESULT_PRESS) timed++;
    if (result.kind == JIG_RESULT_TIMEOUT) timeouts++;
    if (result.kind == JIG_RESULT_NOISY) noisy++;
  }
  send_key(0);
  serial_printf("# done timed=%lu timeouts=%lu noisy=%lu%s\n", (unsigned long)timed, (unsigned long)timeouts,
                (unsigned long)noisy, stop_requested ? " stopped" : "");
  led(false);
  running = false;
}

static void print_status(void) {
  serial_printf("# status usb=%s presses=%lu gapMs=%lu-%lu threshold=%lu timeoutMs=%lu holdMs=%lu quiet=%lu "
                "key=0x%02x chip=%s\n",
                tud_mounted() ? "mounted" : "not-mounted", (unsigned long)settings.presses,
                (unsigned long)settings.min_gap_ms, (unsigned long)settings.max_gap_ms,
                (unsigned long)settings.threshold, (unsigned long)settings.timeout_ms,
                (unsigned long)settings.hold_ms, (unsigned long)settings.quiet_limit, settings.key, JIG_CHIP);
}

static void handle_line(const char *text) {
  char error[96] = "";
  switch (jig_parse_command(text, &settings, error, sizeof error)) {
    case JIG_CMD_NONE:
      return;
    case JIG_CMD_HELP:
      serial_write("# commands:\n"
                   "#   run [presses] [minGapMs] [maxGapMs]  time presses (stop ends a run)\n"
                   "#   level                               the input's level over 1 s, in ADC counts\n"
                   "#   thr <counts>                        distance from rest that counts as sound\n"
                   "#   quiet <counts>                      most the rest may move before a press\n"
                   "#   timeout <ms> | hold <ms>            wait for sound | hold the key\n"
                   "#   key <hid usage>                     the key to press (0x1D = Z)\n"
                   "#   status | help\n");
      return;
    case JIG_CMD_STATUS:
      print_status();
      return;
    case JIG_CMD_RUN:
      run_presses();
      return;
    case JIG_CMD_STOP:
      serial_write("# not running\n");
      return;
    case JIG_CMD_LEVEL: {
      running = true;
      jig_level level = measure_level(1000000ull);
      running = false;
      serial_printf("# level mean=%u min=%u max=%u span=%u threshold=%lu quiet=%lu\n", jig_level_mean(&level),
                    level.min, level.max, jig_level_span(&level), (unsigned long)settings.threshold,
                    (unsigned long)settings.quiet_limit);
      return;
    }
    case JIG_CMD_SET:
      print_status();
      return;
    default:
      serial_printf("# error: %s\n", error);
      return;
  }
}

int main(void) {
  adc_init();
  adc_gpio_init(JIG_ADC_GPIO);
  adc_select_input(JIG_ADC_INPUT);
#ifdef PICO_DEFAULT_LED_PIN
  gpio_init(PICO_DEFAULT_LED_PIN);
  gpio_set_dir(PICO_DEFAULT_LED_PIN, GPIO_OUT);
#endif
  jig_settings_default(&settings);
  jig_line_buffer_init(&line);
  // Seeds the gaps from the ADC's noise and the boot time, so runs differ.
  random_state = (uint32_t)time_us_64();
  for (int i = 0; i < 32; i++) random_state = (random_state << 1) ^ (adc_read() & 1u) ^ (random_state >> 31);

  tusb_init();
  for (;;) service();
}
