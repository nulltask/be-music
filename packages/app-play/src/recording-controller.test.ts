import { describe, expect, test, vi } from 'vite-plus/test';
import type { PixiSceneHost } from '@be-music/player-browser/host';
import {
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
