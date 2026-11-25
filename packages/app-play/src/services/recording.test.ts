import type { PixiSceneHost } from '@be-music/player-browser/host';
import { describe, expect, test, vi } from 'vite-plus/test';
import { startAutomaticRecording, type GameplayRecorder } from '../recording-controller.ts';
import { RecordingService } from './recording.ts';

function recorder(): GameplayRecorder & { formats: unknown[] } {
  let recording = false;
  const formats: unknown[] = [];
  return {
    formats,
    startRecording: (options) => {
      formats.push(options?.format);
      recording = true;
    },
    stopRecording: async () => {
      recording = false;
      return undefined;
    },
    isRecording: () => recording,
  };
}

function setup() {
  const sceneHost = {} as PixiSceneHost;
  const settings = {
    recordGameplay: false,
    recordingResultSeconds: 3,
    recordingFormat: 'webm/vp9',
    recordingQuality: 'high',
  };
  const statuses: string[] = [];
  let play: GameplayRecorder | undefined;
  const service = new RecordingService({
    sceneHost,
    activeGameplay: () => play,
    settings,
    setStatus: (text) => statuses.push(text),
  });
  return {
    sceneHost,
    settings,
    statuses,
    service,
    setPlay: (next: GameplayRecorder | undefined) => {
      play = next;
    },
  };
}

describe('RecordingService', () => {
  test("a bundle reads the app's state when the recording controller asks, not when it was made", () => {
    const { sceneHost, settings, service, setPlay } = setup();
    const deps = service.deps();
    expect(deps.sceneHost).toBe(sceneHost);
    expect(deps.getActiveGameplay()).toBeUndefined();
    expect(deps.getRecordingFilenameBase()).toBe('gameplay');
    expect(deps.getRecordingFormat()).toEqual({ container: 'webm', videoCodec: 'vp9' });
    expect(deps.getRecordingQuality()).toBe('high');

    const play = recorder();
    setPlay(play);
    service.setFilenameBase('Fixture A');
    settings.recordingFormat = 'unknown';
    settings.recordingQuality = 'unknown';
    expect(deps.getActiveGameplay()).toBe(play);
    expect(deps.getRecordingFilenameBase()).toBe('Fixture A');
    // A format the recorder does not offer falls back to MP4 · H.264, a quality to Standard.
    expect(deps.getRecordingFormat()).toEqual({ container: 'mp4', videoCodec: 'avc' });
    expect(deps.getRecordingQuality()).toBe('standard');
  });
  test('starts a fresh recording for each play until the setting is turned off', () => {
    const { service, setPlay, settings, statuses } = setup();
    settings.recordGameplay = true;
    for (let index = 0; index < 2; index++) {
      const play = recorder();
      setPlay(play);
      startAutomaticRecording(service.deps());
      expect(play.isRecording()).toBe(true);
      expect(play.formats).toEqual([{ container: 'webm', videoCodec: 'vp9' }]);
    }
    expect(statuses).toEqual(['Recording…', 'Recording…']);
    settings.recordGameplay = false;
    const nextPlay = recorder();
    setPlay(nextPlay);
    startAutomaticRecording(service.deps());
    expect(nextPlay.isRecording()).toBe(false);
  });

  test.each([3, 8, 0])('includes %i seconds after the entrance in the original take', async (seconds) => {
    vi.useFakeTimers();
    try {
      const { service, setPlay, settings } = setup();
      settings.recordingResultSeconds = seconds;
      const fadeOutRecording = vi.fn();
      const play = { ...recorder(), fadeOutRecording };
      play.startRecording();
      const finish = service.prepareResult(play)!(2_000);
      settings.recordingResultSeconds = seconds + 1;
      const nextPlay = recorder();
      setPlay(nextPlay);
      const fadeWindowMs = seconds === 0 ? 0 : 400;
      await vi.advanceTimersByTimeAsync(2_000 + seconds * 1_000 - fadeWindowMs - 1);
      expect(fadeOutRecording).not.toHaveBeenCalled();
      expect(play.isRecording()).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      if (seconds > 0) {
        expect(fadeOutRecording).toHaveBeenCalledWith(350);
        await vi.advanceTimersByTimeAsync(fadeWindowMs - 1);
        expect(play.isRecording()).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
      } else {
        expect(fadeOutRecording).not.toHaveBeenCalled();
      }
      await finish;
      expect(play.isRecording()).toBe(false);
      expect(nextPlay.formats).toEqual([]);
      expect(service.prepareResult(nextPlay)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
