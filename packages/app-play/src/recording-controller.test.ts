import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import type { PixiSceneHost } from '@be-music/player-browser/host';
import {
  captureScreenshot,
  finalizeRecordingIfActive,
  startArmedRecording,
  type GameplayRecorder,
  type RecordingDeps,
} from './recording-controller.ts';

vi.mock('@be-music/player-browser/recording', () => ({
  downloadBlob: vi.fn(),
  makeWebMSeekable: vi.fn(async (blob: Blob) => blob),
  recordingFileExtension: () => 'webm',
}));

function recorder(recording = false): GameplayRecorder & { started: number } {
  const view = {
    started: 0,
    recording,
    startRecording: vi.fn(() => {
      view.started += 1;
      view.recording = true;
    }),
    stopRecording: vi.fn(async () => {
      view.recording = false;
      return { blob: new Blob(['x']), mimeType: 'video/webm', durationMs: 1000, seekable: true };
    }),
    isRecording: () => view.recording,
  };
  return view;
}

function deps(gameplay: GameplayRecorder | undefined, armed: boolean): RecordingDeps & { statuses: string[] } {
  const statuses: string[] = [];
  let autoRecordArmed = armed;
  return {
    statuses,
    sceneHost: {} as PixiSceneHost,
    recordController: undefined,
    getActiveGameplay: () => gameplay,
    getAutoRecordArmed: () => autoRecordArmed,
    setAutoRecordArmed: (value) => {
      autoRecordArmed = value;
    },
    getRecordingFilenameBase: () => 'play',
    getRecordingFormat: () => ({ container: 'mp4', videoCodec: 'avc' }),
    setStatus: (text) => statuses.push(text),
  } as RecordingDeps & { statuses: string[] };
}

describe('startArmedRecording', () => {
  test('starts the armed recording on the mounted view, of either family, once', () => {
    const view = recorder();
    const recordingDeps = deps(view, true);
    startArmedRecording(recordingDeps);
    startArmedRecording(recordingDeps);
    expect(view.started).toBe(1);
    expect(recordingDeps.getAutoRecordArmed()).toBe(false);
    expect(recordingDeps.statuses).toEqual(['Recording…']);
  });

  test('does nothing unless armed', () => {
    const view = recorder();
    startArmedRecording(deps(view, false));
    expect(view.started).toBe(0);
  });

  test('says why when the view cannot record', () => {
    const view = recorder();
    view.startRecording = () => {
      throw new Error('no MediaRecorder');
    };
    const recordingDeps = deps(view, true);
    startArmedRecording(recordingDeps);
    expect(recordingDeps.statuses).toEqual(['Recording unavailable: no MediaRecorder']);
  });
});

describe('finalizeRecordingIfActive', () => {
  test('stops a running recording on whichever view is mounted', async () => {
    const view = recorder(true);
    await finalizeRecordingIfActive(deps(view, false));
    expect(view.stopRecording).toHaveBeenCalledOnce();
  });

  test('leaves an idle view alone', async () => {
    const view = recorder(false);
    await finalizeRecordingIfActive(deps(view, false));
    expect(view.stopRecording).not.toHaveBeenCalled();
    expect(view.startRecording).not.toHaveBeenCalled();
  });
});

describe('captureScreenshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  test.each([
    [2, 1.5, 853],
    [1.5, 1.5, 640],
  ])('preserves output pixel aspect while removing viewport magnification (%s, %s)', async (sx, sy, outputWidth) => {
    vi.useFakeTimers();
    const drawImage = vi.fn();
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, imageSmoothingEnabled: true }),
      toBlob: (cb: (blob: Blob) => void) => cb(new Blob(['png'])),
    };
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? output : { click() {} }),
      body: { appendChild() {}, removeChild() {} },
    });
    const container = {
      scale: {
        x: sx,
        y: sy,
        set(x: number, y: number) {
          this.x = x;
          this.y = y;
        },
      },
      x: 12,
      y: 34,
      position: {
        set(x: number, y: number) {
          container.x = x;
          container.y = y;
        },
      },
    };
    const extract = vi.fn((options: { frame: { width: number; height: number } }) => {
      expect(options.frame.width).toBe(640);
      expect(options.frame.height).toBe(480);
      expect(container.scale.x).toBe(1);
      expect(container.scale.y).toBe(1);
      return { toBlob: (cb: (b: Blob) => void) => cb(new Blob(['png'])) };
    });
    const d = deps(undefined, false);
    Object.assign(d, {
      sceneHost: {
        app: { renderer: { extract: { canvas: extract } } },
        getCurrentScene: () => ({ getStageInfo: () => ({ container, width: 640, height: 480 }) }),
      },
    });
    await captureScreenshot(d);
    expect(extract).toHaveBeenCalledOnce();
    if (outputWidth !== 640) {
      expect(output).toMatchObject({ width: outputWidth, height: 480 });
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, outputWidth, 480);
    } else expect(drawImage).not.toHaveBeenCalled();
    expect(container.scale).toMatchObject({ x: sx, y: sy });
    expect(container).toMatchObject({ x: 12, y: 34 });
    expect(d.statuses.some((s) => s.includes('Screenshot failed'))).toBe(false);
  });
});
