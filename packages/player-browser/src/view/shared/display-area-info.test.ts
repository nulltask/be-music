import { describe, expect, test } from 'vite-plus/test';
import { measureLayer, resolveDisplayAreaLabels, type DisplayAreaLane } from './display-area-info.ts';

const lanes: DisplayAreaLane[] = [
  { side: '1P', x: 10, w: 20, top: 20, bottom: 420 },
  { side: '1P', x: 30, w: 20, top: 20, bottom: 420 },
  { side: '2P', x: 110, w: 40, top: 20, bottom: 420 },
];
const covers = [
  { side: '1P' as const, sudden: 0.25, hidden: 0, lift: 0 },
  { side: '2P' as const, sudden: 0.5, hidden: 0, lift: 0.2 },
];
const input = { lanes, covers, visibleMs: (cover: (typeof covers)[number]) => (cover.side === '1P' ? 500 : 300) };

describe('AC 34 display-area information', () => {
  test('uses the base lane for SUDDEN and the actual raised line for LIFT', () => {
    expect(
      resolveDisplayAreaLabels({
        mode: 'ON',
        lanes: [{ side: '1P', x: 10, w: 40, top: 20, bottom: 320, baseBottom: 420 }],
        covers: [{ side: '1P', sudden: 0.15, hidden: 0, lift: 0.25 }],
        visibleMs: () => 500,
      }),
    ).toEqual([
      { side: '1P', edge: 'sudden', x: 30, y: 80, length: 150, green: 300 },
      { side: '1P', edge: 'lift', x: 30, y: 320, length: 250, green: 300 },
    ]);
  });

  test('OFF leaves authored skin information alone', () => {
    expect(resolveDisplayAreaLabels({ ...input, mode: 'OFF' })).toEqual([]);
  });
  test('ON places cover length and green number at each side’s cover and LIFT edges', () => {
    expect(resolveDisplayAreaLabels({ ...input, mode: 'ON' })).toEqual([
      { side: '1P', edge: 'sudden', x: 30, y: 120, length: 250, green: 300 },
      { side: '2P', edge: 'sudden', x: 130, y: 220, length: 500, green: 180 },
      { side: '2P', edge: 'lift', x: 130, y: 420, length: 200, green: 180 },
    ]);
  });
  test('the source’s restricted modes select only their respective edges', () => {
    expect(resolveDisplayAreaLabels({ ...input, mode: 'SUDDEN_ONLY' }).map((value) => value.edge)).toEqual([
      'sudden',
      'sudden',
    ]);
    expect(resolveDisplayAreaLabels({ ...input, mode: 'HIDDEN_LIFT_ONLY' }).map((value) => value.edge)).toEqual([
      'lift',
    ]);
    expect(
      resolveDisplayAreaLabels({
        ...input,
        covers: [{ side: '1P', sudden: 0, hidden: 0.1, lift: 0 }],
        mode: 'HIDDEN_LIFT_ONLY',
      })[0],
    ).toMatchObject({ edge: 'hidden', y: 380, length: 100 });
  });
  test('missing lanes, disabled covers and unknown visible time do not fabricate values', () => {
    expect(resolveDisplayAreaLabels({ ...input, lanes: [], mode: 'ON' })).toEqual([]);
    expect(
      resolveDisplayAreaLabels({ ...input, covers: [{ side: '1P', sudden: 0, hidden: 0, lift: 0 }], mode: 'ON' }),
    ).toEqual([]);
    expect(resolveDisplayAreaLabels({ ...input, visibleMs: () => undefined, mode: 'ON' })[0]?.green).toBeUndefined();
  });
});

test('Canvas readouts update, hide and release with the view', async () => {
  const { Container, Text } = await import('pixi.js');
  const { DisplayAreaInfoOverlay } = await import('./display-area-info.ts');
  const root = new Container();
  const overlay = new DisplayAreaInfoOverlay();
  overlay.attachCanvas(root);
  overlay.update(
    resolveDisplayAreaLabels({ ...input, mode: 'ON' }),
    { width: 640, height: 480 },
    { width: 960, height: 540 },
  );
  const layer = root.getChildByLabel('display-area-info') as InstanceType<typeof Container>;
  expect(
    layer.children.filter((child) => child instanceof Text).map((child) => (child as InstanceType<typeof Text>).text),
  ).toEqual(['SUD-LENGTH 250', '300', 'SUD-LENGTH 500', '180', 'LIFT-LENGTH 200', '180']);
  overlay.update([], { width: 640, height: 480 }, { width: 960, height: 540 });
  expect(layer.visible).toBe(false);
  overlay.detach();
  expect(root.children).toHaveLength(0);
  overlay.dispose();
  expect(layer.destroyed).toBe(true);
  root.destroy();
});

describe('DOM overlay layer size', () => {
  test("uses the layer's own CSS box, not the renderer's screen", () => {
    const layer = { clientWidth: 855, clientHeight: 924 } as HTMLElement;
    expect(measureLayer(layer, { width: 800, height: 828 })).toEqual({ width: 855, height: 924 });
  });

  test('falls back to the screen before the layer is laid out', () => {
    const layer = { clientWidth: 0, clientHeight: 0 } as HTMLElement;
    expect(measureLayer(layer, { width: 800, height: 828 })).toEqual({ width: 800, height: 828 });
  });
});
