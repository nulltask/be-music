// @vitest-environment jsdom
import { afterEach, expect, test } from 'vite-plus/test';
import type { BeMusicPlaybackData } from '../models.ts';
import { defineBeMusicElements } from '../register.ts';

defineBeMusicElements();

const playing: BeMusicPlaybackData = {
  currentSeconds: 10,
  durationSeconds: 90,
  playing: true,
  seekable: true,
  volume: 0.35,
  muted: false,
  fullscreen: false,
};

async function mount(data = playing) {
  const controls = document.createElement('be-music-playback-controls');
  const host = document.createElement('div');
  host.append(controls);
  document.body.append(host);
  controls.data = data;
  await controls.updateComplete;
  const root = controls.shadowRoot!;
  return {
    controls,
    host,
    seek: root.querySelector<HTMLInputElement>('[aria-label="Seek"]')!,
    button: (name: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!,
    volume: root.querySelector<HTMLInputElement>('[aria-label="Volume"]')!,
  };
}

afterEach(() => document.body.replaceChildren());

test('keeps the dragged time through incoming playback frames and rejoins the clock on release', async () => {
  const { controls, host, seek } = await mount();
  const requests: number[] = [];
  host.addEventListener('seek-request', (event) => {
    requests.push((event as CustomEvent<{ seconds: number }>).detail.seconds);
  });
  expect(seek.valueAsNumber).toBe(10);
  expect(seek.getAttribute('aria-valuetext')).toBe('0:10 of 1:30');

  seek.dispatchEvent(new Event('pointerdown'));
  seek.value = '65';
  seek.dispatchEvent(new Event('input'));
  controls.data = { ...playing, currentSeconds: 11 };
  await controls.updateComplete;

  expect(requests).toEqual([65]);
  expect(seek.valueAsNumber).toBe(65);
  expect(seek.getAttribute('aria-valuetext')).toBe('1:05 of 1:30');

  seek.dispatchEvent(new Event('pointerup'));
  await controls.updateComplete;
  expect(requests).toEqual([65, 65]);
  expect(seek.valueAsNumber).toBe(11);
  expect(seek.getAttribute('aria-valuetext')).toBe('0:11 of 1:30');
});

test('honors a keyboard-only seek and disables seeking for unavailable or zero-length previews', async () => {
  const { controls, seek } = await mount();
  const requests: number[] = [];
  controls.addEventListener('seek-request', (event) => {
    requests.push((event as CustomEvent<{ seconds: number }>).detail.seconds);
  });
  seek.value = '24';
  seek.dispatchEvent(new Event('change'));
  expect(requests).toEqual([24]);
  controls.data = { ...playing, seekable: false };
  await controls.updateComplete;
  expect(seek.disabled).toBe(true);
  controls.data = { ...playing, durationSeconds: 0 };
  await controls.updateComplete;
  expect(seek.disabled).toBe(true);
  expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 0:00');
});

test('requests mute without discarding the volume and follows the player’s result', async () => {
  const { controls, volume, button } = await mount();
  const requests: unknown[] = [];
  for (const name of ['volume-change', 'pause-request', 'fullscreen-request']) {
    controls.addEventListener(name, (event) => requests.push([name, (event as CustomEvent).detail]));
  }
  button('Mute').click();
  button('Pause').click();
  button('Full screen').click();
  expect(requests).toEqual([
    ['volume-change', { volume: 0.35, muted: true }],
    ['pause-request', null],
    ['fullscreen-request', null],
  ]);
  controls.data = { ...playing, muted: true, playing: false, fullscreen: true };
  await controls.updateComplete;
  expect(volume.valueAsNumber).toBe(0);
  expect(button('Play')).not.toBeNull();
  expect(button('Exit full screen')).not.toBeNull();

  button('Unmute').click();
  volume.value = '0.6';
  volume.dispatchEvent(new Event('input'));
  expect(requests.slice(3)).toEqual([
    ['volume-change', { volume: 0.35, muted: false }],
    ['volume-change', { volume: 0.6, muted: false }],
  ]);
});
