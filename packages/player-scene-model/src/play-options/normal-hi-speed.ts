/** AC 32 Lightning Model measurements published by masaoblue (2025-08-21), not a claimed AC 34 calibration. */
export const AC32_HI_SPEED_BASE = 174728;
/** Full-lane green numbers for the twenty normal HI-SPEED levels in that measured profile. */
export const NORMAL_HI_SPEED_GREEN_NUMBERS: readonly number[] = [
  1200, 1000, 800, 700, 650, 600, 550, 500, 480, 460, 440, 420, 400, 380, 360, 340, 320, 300, 280, 260,
];

/** Normal HI-SPEED computes a multiplier at the BPM where the level is selected, then retains it across tempo changes. */
export function resolveNormalHiSpeed(level: number, bpm: number): number | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 20 || !Number.isFinite(bpm) || bpm <= 0) return undefined;
  return AC32_HI_SPEED_BASE / NORMAL_HI_SPEED_GREEN_NUMBERS[level - 1]! / bpm;
}

/** The nearest normal level for a host-supplied multiplier at the current BPM; used only while the profile is active. */
export function resolveNormalHiSpeedLevel(hiSpeed: number, bpm: number): number | undefined {
  if (!Number.isFinite(hiSpeed) || hiSpeed <= 0 || !Number.isFinite(bpm) || bpm <= 0) return undefined;
  const green = AC32_HI_SPEED_BASE / hiSpeed / bpm;
  let best = 0;
  for (let index = 1; index < NORMAL_HI_SPEED_GREEN_NUMBERS.length; index += 1) {
    if (
      Math.abs(NORMAL_HI_SPEED_GREEN_NUMBERS[index]! - green) < Math.abs(NORMAL_HI_SPEED_GREEN_NUMBERS[best]! - green)
    )
      best = index;
  }
  return best + 1;
}
