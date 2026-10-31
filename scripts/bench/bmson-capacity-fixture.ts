/** Authored overflow fixture: no corpus chart currently exceeds the BMS resource capacity. */
export const BMSON_CAPACITY_TEXT = JSON.stringify({
  version: '1.0.0',
  info: { init_bpm: 120, resolution: 240 },
  sound_channels: Array.from({ length: 3_845 }, (_, index) => ({
    name: `sample-${index}.wav`,
    notes: [{ x: 1, y: index * 240 }],
  })),
  bpm_events: Array.from({ length: 3_845 }, (_, index) => ({ y: index * 240, bpm: 120 + index })),
  stop_events: Array.from({ length: 3_845 }, (_, index) => ({ y: index * 240, duration: index + 1 })),
  scroll_events: Array.from({ length: 3_845 }, (_, index) => ({ y: index * 240, rate: index + 1 })),
});
