import { afterEach, expect, test } from 'vite-plus/test';
import { defineBeMusicElements } from '../register.ts';

defineBeMusicElements();

afterEach(() => document.body.replaceChildren());

test('redraws the judge line in the resized device-pixel canvas and clears it when its data is removed', async () => {
  const judgeLine = document.createElement('be-music-judge-line');
  judgeLine.rect = { x: 100, y: 200, w: 20, h: 10 };
  judgeLine.data = { y: 204, runs: [{ left: 105, right: 115 }] };
  judgeLine.style.cssText = 'width: 40px; height: 20px';
  document.body.append(judgeLine);
  await judgeLine.updateComplete;
  const canvas = judgeLine.shadowRoot!.querySelector('canvas')!;
  const context = canvas.getContext('2d')!;
  const ratio = devicePixelRatio;
  const pixel = (x: number, y: number) => [
    ...context.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data,
  ];

  await expect.poll(() => [canvas.width, canvas.height]).toEqual([40 * ratio, 20 * ratio]);
  expect(pixel(20, 10)).toEqual([255, 168, 179, 255]);
  expect(pixel(4, 10)).toEqual([0, 0, 0, 0]);

  judgeLine.style.width = '60px';
  judgeLine.style.height = '40px';
  await expect.poll(() => [canvas.width, canvas.height]).toEqual([60 * ratio, 40 * ratio]);
  expect(pixel(30, 20)).toEqual([255, 168, 179, 255]);
  expect(pixel(12, 10)).toEqual([0, 0, 0, 0]);

  judgeLine.data = undefined;
  await judgeLine.updateComplete;
  expect(pixel(30, 20)).toEqual([0, 0, 0, 0]);
});
