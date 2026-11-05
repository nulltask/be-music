import { describe, expect, test, vi } from 'vite-plus/test';
import { BGA_CAMERA_STORAGE_KEY } from '../bga-camera-settings.ts';
import { BGACameraService, statusOfError, type BGACameraTarget } from './bga-camera.ts';

class FakeTrack extends EventTarget {
  public stopped = false;
  private readonly deviceId: string;
  public constructor(deviceId: string) {
    super();
    this.deviceId = deviceId;
  }
  public stop(): void {
    this.stopped = true;
  }
  public getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }
  /** The camera was unplugged, or its permission taken back. */
  public end(): void {
    this.stopped = true;
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  public readonly track: FakeTrack;
  public constructor(deviceId: string) {
    this.track = new FakeTrack(deviceId);
  }
  public getTracks(): FakeTrack[] {
    return [this.track];
  }
  public getVideoTracks(): FakeTrack[] {
    return [this.track];
  }
}

function setup(options: { stored?: string; denied?: boolean } = {}) {
  const store = new Map<string, string>();
  if (options.stored !== undefined) store.set(BGA_CAMERA_STORAGE_KEY, options.stored);
  let devices = [
    { deviceId: 'front-id', kind: 'videoinput', label: 'Front' },
    { deviceId: 'desk-id', kind: 'videoinput', label: 'Desk' },
  ];
  const streams: FakeStream[] = [];
  const deviceChange = new EventTarget();
  const media = {
    getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
      if (options.denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      const video = constraints.video;
      const id =
        typeof video === 'object' && video !== null && typeof video.deviceId === 'object'
          ? String((video.deviceId as { exact: string }).exact)
          : 'front-id';
      const stream = new FakeStream(id);
      streams.push(stream);
      return stream as unknown as MediaStream;
    }),
    enumerateDevices: vi.fn(async () => devices as MediaDeviceInfo[]),
    addEventListener: (type: string, listener: EventListener) => deviceChange.addEventListener(type, listener),
  };
  const statusLines: string[] = [];
  const service = new BGACameraService({
    mediaDevices: media as unknown as MediaDevices,
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) },
    setStatus: (text) => statusLines.push(text),
  });
  const shown: (string | undefined)[] = [];
  const scene: BGACameraTarget & { camera: { stream: MediaStream; mirror: boolean } | undefined } = {
    camera: undefined,
    setBGACamera(camera) {
      this.camera = camera;
      shown.push(
        camera === undefined ? undefined : (camera.stream as unknown as FakeStream).track.getSettings().deviceId,
      );
    },
  };
  return {
    service,
    media,
    streams,
    scene,
    shown,
    store,
    statusLines,
    unplug(deviceId: string) {
      devices = devices.filter((device) => device.deviceId !== deviceId);
      deviceChange.dispatchEvent(new Event('devicechange'));
    },
    plug(device: { deviceId: string; kind: string; label: string }) {
      devices = [...devices, device];
      deviceChange.dispatchEvent(new Event('devicechange'));
    },
  };
}

/** Lets the service's awaited `getUserMedia` and `enumerateDevices` settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BGACameraService', () => {
  test('opens the camera only for a play, and only with the setting on', async () => {
    const { service, media, scene } = setup();
    service.follow(scene);
    await settle();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(service.status).toBe('off');
    service.setEnabled(true);
    await settle();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(scene.camera).toBeDefined();
    expect(service.status).toBe('live');
  });

  test('closes the camera as the play leaves the stage', async () => {
    const { service, streams, scene } = setup({ stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}' });
    service.follow(scene);
    await settle();
    expect(streams).toHaveLength(1);
    service.follow(undefined);
    expect(streams[0]!.track.stopped).toBe(true);
    expect(scene.camera).toBeUndefined();
    expect(service.status).toBe('standby');
  });

  test('hands the open camera to the next play without opening it again', async () => {
    const { service, media, scene } = setup({ stored: '{"enabled":true,"deviceId":"","label":"","mirror":true}' });
    service.follow(scene);
    await settle();
    const next = { setBGACamera: vi.fn() };
    service.follow(next);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(next.setBGACamera).toHaveBeenCalledWith({ stream: scene.camera!.stream, mirror: true });
  });

  test('opens the picked camera and remembers the pick', async () => {
    const { service, scene, shown, store } = setup({
      stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}',
    });
    await service.watch();
    service.follow(scene);
    await settle();
    service.setDevice('desk-id');
    await settle();
    expect(shown).toEqual(['front-id', undefined, 'desk-id']);
    expect(JSON.parse(store.get(BGA_CAMERA_STORAGE_KEY)!)).toMatchObject({ deviceId: 'desk-id', label: 'Desk' });
  });

  test('mirrors the camera showing at once', async () => {
    const { service, scene } = setup({ stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}' });
    service.follow(scene);
    await settle();
    service.setMirror(true);
    expect(scene.camera?.mirror).toBe(true);
  });

  test('shows the BGA again when the camera is unplugged during a play', async () => {
    const { service, scene, streams, statusLines, unplug } = setup({
      stored: '{"enabled":true,"deviceId":"desk-id","label":"Desk","mirror":false}',
    });
    await service.watch();
    service.follow(scene);
    await settle();
    expect(scene.camera).toBeDefined();
    unplug('desk-id');
    await settle();
    expect(scene.camera).toBeUndefined();
    expect(streams[0]!.track.stopped).toBe(true);
    expect(service.status).toBe('missing');
    expect(statusLines.at(-1)).toMatch(/not connected/u);
  });

  test('shows the BGA again when the camera track ends (permission taken back)', async () => {
    const { service, scene, streams } = setup({ stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}' });
    service.follow(scene);
    await settle();
    streams[0]!.track.end();
    expect(scene.camera).toBeUndefined();
    expect(service.status).toBe('missing');
  });

  test('waits for a picked camera that is not connected, and opens it once plugged in', async () => {
    const { service, media, scene, unplug, plug } = setup({
      stored: '{"enabled":true,"deviceId":"desk-id","label":"Desk","mirror":false}',
    });
    unplug('desk-id');
    await service.watch();
    service.follow(scene);
    await settle();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(service.status).toBe('missing');
    plug({ deviceId: 'desk-id', kind: 'videoinput', label: 'Desk' });
    await settle();
    await settle();
    expect(service.status).toBe('live');
    expect(scene.camera).toBeDefined();
  });

  test('says when the camera is refused, and the play keeps its BGA', async () => {
    const { service, scene, statusLines } = setup({
      stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}',
      denied: true,
    });
    service.follow(scene);
    await settle();
    expect(scene.camera).toBeUndefined();
    expect(service.status).toBe('denied');
    expect(statusLines.at(-1)).toMatch(/refused/u);
  });

  test('asks for access once to learn the names, then closes the camera', async () => {
    const { service, streams } = setup();
    expect(await service.requestAccess()).toBe(true);
    expect(streams[0]!.track.stopped).toBe(true);
    expect(service.namesKnown).toBe(true);
  });

  test('previews the picked camera whether the setting is on or not, and closes it when stopped', async () => {
    const { service, streams } = setup();
    await service.watch();
    service.setDevice('desk-id');
    await service.startPreview();
    expect(service.previewing).toBe(true);
    expect(service.previewStream).toBe(streams[0] as unknown as MediaStream);
    expect(streams[0]!.track.getSettings().deviceId).toBe('desk-id');
    service.stopPreview();
    expect(streams[0]!.track.stopped).toBe(true);
    expect(service.previewStream).toBeUndefined();
  });

  test('shares the play camera with the preview, and opens its own once the play leaves', async () => {
    const { service, media, scene, streams } = setup({
      stored: '{"enabled":true,"deviceId":"","label":"","mirror":false}',
    });
    await service.startPreview();
    expect(streams).toHaveLength(1);
    service.follow(scene);
    await settle();
    // The play's camera replaces the preview's own.
    expect(streams[0]!.track.stopped).toBe(true);
    expect(service.previewStream).toBe(scene.camera!.stream);
    service.follow(undefined);
    await settle();
    expect(media.getUserMedia).toHaveBeenCalledTimes(3);
    expect(service.previewStream).toBe(streams[2] as unknown as MediaStream);
    expect(streams[2]!.track.stopped).toBe(false);
  });

  test('says why the preview could not open', async () => {
    const { service } = setup({ denied: true });
    await service.startPreview();
    expect(service.previewing).toBe(false);
    expect(service.previewProblem).toBe('denied');
  });

  test('stops the preview when its camera ends', async () => {
    const { service, streams } = setup();
    await service.startPreview();
    streams[0]!.track.end();
    expect(service.previewing).toBe(false);
    expect(service.previewProblem).toBe('missing');
  });

  test('is unsupported where the page has no camera access', () => {
    const service = new BGACameraService({ mediaDevices: undefined, storage: undefined });
    expect(service.status).toBe('unsupported');
  });
});

describe('statusOfError', () => {
  test('tells a refusal, a missing camera and a busy one apart', () => {
    expect(statusOfError({ name: 'NotAllowedError' })).toBe('denied');
    expect(statusOfError({ name: 'NotFoundError' })).toBe('missing');
    expect(statusOfError({ name: 'OverconstrainedError' })).toBe('missing');
    expect(statusOfError({ name: 'NotReadableError' })).toBe('busy');
  });
});
