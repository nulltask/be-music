/** Collect each owned output buffer once, without copying buffers or walking cyclic references twice. */
export function collectWorkerTransferables(value: unknown): ArrayBuffer[] {
  const seen = new Set<object>();
  const buffers = new Set<ArrayBuffer>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (item instanceof ArrayBuffer) buffers.add(item);
    else if (ArrayBuffer.isView(item)) {
      if (item.buffer instanceof ArrayBuffer) buffers.add(item.buffer);
    } else if (item instanceof Map) {
      for (const [key, entry] of item) {
        visit(key);
        visit(entry);
      }
    } else if (item instanceof Set) {
      for (const entry of item) visit(entry);
    } else {
      for (const entry of Object.values(item)) visit(entry);
    }
  };
  visit(value);
  return [...buffers];
}
