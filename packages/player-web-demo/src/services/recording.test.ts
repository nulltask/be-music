import type { PixiSceneHost } from '@be-music/player-web/host';
import { describe, expect, test, vi } from 'vite-plus/test';
import { startArmedRecording, toggleRecording, type GameplayRecorder } from '../recording-controller.ts';
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
  const settings = { recordingFormat: 'webm/vp9' };
  const statuses: string[] = [];
  let play: GameplayRecorder | undefined;
  const service = new RecordingService({
    sceneHost,
    recordController: () => undefined,
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

    const play = recorder();
    setPlay(play);
    service.setFilenameBase('Fixture A');
    settings.recordingFormat = 'unknown';
    expect(deps.getActiveGameplay()).toBe(play);
    expect(deps.getRecordingFilenameBase()).toBe('Fixture A');
    // A format the recorder does not offer falls back to MP4 · H.264.
    expect(deps.getRecordingFormat()).toEqual({ container: 'mp4', videoCodec: 'avc' });
  });

  test('takes the record button as it is when the bundle is made', () => {
    const controller = { name: vi.fn() };
    let menuBuilt = false;
    const service = new RecordingService({
      sceneHost: {} as PixiSceneHost,
      recordController: () => (menuBuilt ? (controller as never) : undefined),
      activeGameplay: () => undefined,
      settings: { recordingFormat: 'mp4/avc' },
      setStatus: () => {},
    });
    expect(service.deps().recordController).toBeUndefined();
    menuBuilt = true;
    expect(service.deps().recordController).toBe(controller);
  });

  test('a recording armed on the select screen starts with the next play, in the format picked', async () => {
    const { service, setPlay, statuses } = setup();
    // Record pressed with no play up arms the next one.
    await toggleRecording(service.deps());
    expect(statuses).toEqual(['Recording armed — pick a song to start capturing']);
    expect(service.deps().getAutoRecordArmed()).toBe(true);

    const play = recorder();
    setPlay(play);
    startArmedRecording(service.deps());
    expect(play.isRecording()).toBe(true);
    expect(play.formats).toEqual([{ container: 'webm', videoCodec: 'vp9' }]);
    expect(service.deps().getAutoRecordArmed()).toBe(false);
  });

  test('a second press before a play disarms', async () => {
    const { service, setPlay, statuses } = setup();
    await toggleRecording(service.deps());
    await toggleRecording(service.deps());
    expect(statuses.at(-1)).toBe('Recording disarmed');

    const play = recorder();
    setPlay(play);
    startArmedRecording(service.deps());
    expect(play.isRecording()).toBe(false);
  });
});
