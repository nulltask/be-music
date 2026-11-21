// The BGA camera's settings (Options → Camera): whether the play shows a camera in the BGA frame, which
// camera, and whether it is mirrored. They belong to this browser's cameras, so they stay in this browser's
// `localStorage` and are not part of the synced Options document (`option-settings.ts`).

/** `localStorage` key of the BGA camera settings. Reset deletes it with the other `be-music.*` settings. */
export const BGA_CAMERA_STORAGE_KEY = 'be-music.bga-camera';

export interface BGACameraSettings {
  /** Show the camera in the BGA frame during a play. The camera opens only then. */
  readonly enabled: boolean;
  /** The picked camera's `deviceId`; `''` for the browser's default camera. */
  readonly deviceId: string;
  /** The picked camera's name when it was picked, to find it again if the browser hands out a new `deviceId`. */
  readonly label: string;
  /** Flip the picture left to right. */
  readonly mirror: boolean;
  /** The picture's height to ask the camera for; `auto` takes what the camera gives. */
  readonly resolution: BGACameraResolution;
  /** The picture's width to height to ask the camera for; `auto` takes what the camera gives. */
  readonly aspect: BGACameraAspect;
}

/** The camera resolutions offered: the camera's own, or about 480, 720 or 1080 lines. */
export type BGACameraResolution = 'auto' | '480p' | '720p' | '1080p';
export const BGA_CAMERA_RESOLUTIONS: readonly BGACameraResolution[] = ['auto', '480p', '720p', '1080p'];

/** The camera aspect ratios offered: the camera's own, 4:3, 16:9 or square (the BGA frame's shape). */
export type BGACameraAspect = 'auto' | '4:3' | '16:9' | '1:1';
export const BGA_CAMERA_ASPECTS: readonly BGACameraAspect[] = ['auto', '4:3', '16:9', '1:1'];

export const DEFAULT_BGA_CAMERA_SETTINGS: BGACameraSettings = {
  enabled: false,
  deviceId: '',
  label: '',
  mirror: false,
  resolution: 'auto',
  aspect: 'auto',
};

const RESOLUTION_HEIGHTS: Readonly<Record<Exclude<BGACameraResolution, 'auto'>, number>> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};
const ASPECT_RATIOS: Readonly<Record<Exclude<BGACameraAspect, 'auto'>, number>> = {
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '1:1': 1,
};

/** The stored settings, with the default for anything missing or malformed. */
export function parseStoredBGACameraSettings(raw: string | null | undefined): BGACameraSettings {
  if (raw == null) return DEFAULT_BGA_CAMERA_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_BGA_CAMERA_SETTINGS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_BGA_CAMERA_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    enabled: record['enabled'] === true,
    deviceId: typeof record['deviceId'] === 'string' ? record['deviceId'] : '',
    label: typeof record['label'] === 'string' ? record['label'] : '',
    mirror: record['mirror'] === true,
    resolution: BGA_CAMERA_RESOLUTIONS.find((value) => value === record['resolution']) ?? 'auto',
    aspect: BGA_CAMERA_ASPECTS.find((value) => value === record['aspect']) ?? 'auto',
  };
}

export function serializeBGACameraSettings(settings: BGACameraSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    deviceId: settings.deviceId,
    label: settings.label,
    mirror: settings.mirror,
    resolution: settings.resolution,
    aspect: settings.aspect,
  });
}

/** What the camera list needs of a `MediaDeviceInfo`. */
export interface CameraDevice {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string;
}

/** The cameras among `enumerateDevices()`'s devices. */
export function cameraDevices<T extends CameraDevice>(devices: readonly T[]): T[] {
  return devices.filter((device) => device.kind === 'videoinput');
}

/**
 * Whether the browser has told the page the cameras' names. Until the player allows the camera once, browsers list a
 * camera with an empty `label` (and often an empty `deviceId`), so the list cannot name them yet.
 */
export function cameraNamesKnown(cameras: readonly CameraDevice[]): boolean {
  return cameras.length > 0 && cameras.every((camera) => camera.label !== '' && camera.deviceId !== '');
}

/**
 * The camera to open for `settings`, among `cameras` (`cameraDevices`): the one with the picked `deviceId`, else the
 * one with the picked name (a browser hands out new ids when its site data is cleared), else `undefined` when a picked
 * camera is gone. With no pick, `undefined` too, and the browser opens its default camera.
 */
export function pickCamera<T extends CameraDevice>(
  cameras: readonly T[],
  settings: Pick<BGACameraSettings, 'deviceId' | 'label'>,
): T | undefined {
  if (settings.deviceId === '' && settings.label === '') return undefined;
  return (
    cameras.find((camera) => settings.deviceId !== '' && camera.deviceId === settings.deviceId) ??
    cameras.find((camera) => settings.label !== '' && camera.label === settings.label)
  );
}

/** Whether a picked camera (`settings`) is missing from `cameras`, whose names are known. */
export function isPickedCameraMissing(
  cameras: readonly CameraDevice[],
  settings: Pick<BGACameraSettings, 'deviceId' | 'label'>,
): boolean {
  if (settings.deviceId === '' && settings.label === '') return false;
  return cameraNamesKnown(cameras) && pickCamera(cameras, settings) === undefined;
}

/** The choice for the browser's default camera in the camera list. */
export const DEFAULT_CAMERA_CHOICE = '';

/**
 * The camera list's choices, label → `deviceId`: the browser's default camera, then each camera by name (`Camera 1`,
 * `Camera 2`, … while the names are unknown). A picked camera that is not connected stays in the list, marked, so
 * the list never shows a pick it does not have.
 */
export function cameraChoices(
  cameras: readonly CameraDevice[],
  settings: Pick<BGACameraSettings, 'deviceId' | 'label'>,
  text: {
    readonly defaultCamera: string;
    readonly unnamed: (index: number) => string;
    readonly missing: (label: string) => string;
  },
): Record<string, string> {
  const choices: Record<string, string> = { [text.defaultCamera]: DEFAULT_CAMERA_CHOICE };
  cameras.forEach((camera, index) => {
    if (camera.deviceId === '') return;
    let label = camera.label !== '' ? camera.label : text.unnamed(index + 1);
    // Two cameras of one model share a name.
    while (label in choices) label = `${label} (${index + 1})`;
    choices[label] = camera.deviceId;
  });
  if (settings.deviceId !== '' && !Object.values(choices).includes(settings.deviceId)) {
    const picked = pickCamera(cameras, settings);
    if (picked === undefined)
      choices[text.missing(settings.label || settings.deviceId.slice(0, 8))] = settings.deviceId;
  }
  return choices;
}

/**
 * `getUserMedia`'s constraints for `settings`' camera, `camera` being what {@link pickCamera} found. A resolution and
 * an aspect ratio are asked as `ideal`, so a camera that cannot give them still opens at its nearest.
 */
export function cameraConstraints(
  settings: Pick<BGACameraSettings, 'deviceId'> & Partial<Pick<BGACameraSettings, 'resolution' | 'aspect'>>,
  camera: CameraDevice | undefined,
): MediaStreamConstraints {
  const deviceId = camera?.deviceId ?? settings.deviceId;
  const video: MediaTrackConstraints = {};
  if (deviceId !== '') video.deviceId = { exact: deviceId };
  const height =
    settings.resolution === undefined || settings.resolution === 'auto'
      ? undefined
      : RESOLUTION_HEIGHTS[settings.resolution];
  const ratio =
    settings.aspect === undefined || settings.aspect === 'auto' ? undefined : ASPECT_RATIOS[settings.aspect];
  if (height !== undefined) {
    video.height = { ideal: height };
    video.width = { ideal: Math.round(height * (ratio ?? 16 / 9)) };
  }
  if (ratio !== undefined) video.aspectRatio = { ideal: ratio };
  return { audio: false, video: Object.keys(video).length > 0 ? video : true };
}
