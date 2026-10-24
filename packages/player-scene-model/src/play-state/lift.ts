/** The beatoraja LIFT geometry: shorten scroll distance by the same ratio as the raised judgement line. */
export function resolveLiftedLane<T extends { top: number; bottom: number }>(
  lane: T,
  lift: number,
): T & { baseBottom: number; scrollScale: number } {
  const scrollScale = 1 - (Number.isFinite(lift) ? Math.max(0, Math.min(1, lift)) : 0);
  return { ...lane, bottom: lane.top + (lane.bottom - lane.top) * scrollScale, baseBottom: lane.bottom, scrollScale };
}
