import { describe, expect, test } from 'vite-plus/test';
import {
  cameraChoices,
  cameraConstraints,
  cameraDevices,
  cameraNamesKnown,
  DEFAULT_BGA_CAMERA_SETTINGS,
  isPickedCameraMissing,
  parseStoredBGACameraSettings,
  pickCamera,
  serializeBGACameraSettings,
} from './bga-camera-settings.ts';

const front = { deviceId: 'front-id', kind: 'videoinput', label: 'FaceTime HD Camera' };
const desk = { deviceId: 'desk-id', kind: 'videoinput', label: 'USB Camera' };
const microphone = { deviceId: 'mic-id', kind: 'audioinput', label: 'Microphone' };
const text = {
  defaultCamera: 'Default camera',
  unnamed: (index: number) => `Camera ${index}`,
  missing: (label: string) => `${label} (not connected)`,
};

describe('parseStoredBGACameraSettings', () => {
  test('reads back what was stored', () => {
    const settings = { enabled: true, deviceId: 'desk-id', label: 'USB Camera', mirror: true };
    expect(parseStoredBGACameraSettings(serializeBGACameraSettings(settings))).toEqual(settings);
  });

  test('falls back to the defaults for nothing stored or something malformed', () => {
    expect(parseStoredBGACameraSettings(null)).toEqual(DEFAULT_BGA_CAMERA_SETTINGS);
    expect(parseStoredBGACameraSettings('{')).toEqual(DEFAULT_BGA_CAMERA_SETTINGS);
    expect(parseStoredBGACameraSettings('"on"')).toEqual(DEFAULT_BGA_CAMERA_SETTINGS);
    expect(parseStoredBGACameraSettings('{"enabled":"yes","deviceId":3,"mirror":1}')).toEqual(
      DEFAULT_BGA_CAMERA_SETTINGS,
    );
  });

  test('keeps the camera off by default', () => {
    expect(DEFAULT_BGA_CAMERA_SETTINGS.enabled).toBe(false);
  });
});

describe('cameraDevices', () => {
  test('keeps only the cameras', () => {
    expect(cameraDevices([front, microphone, desk])).toEqual([front, desk]);
  });
});

describe('cameraNamesKnown', () => {
  test('is false until the browser names every camera', () => {
    expect(cameraNamesKnown([{ deviceId: '', kind: 'videoinput', label: '' }])).toBe(false);
    expect(cameraNamesKnown([])).toBe(false);
    expect(cameraNamesKnown([front, desk])).toBe(true);
  });
});

describe('pickCamera', () => {
  test('finds the picked camera by its id', () => {
    expect(pickCamera([front, desk], { deviceId: 'desk-id', label: 'USB Camera' })).toBe(desk);
  });

  test('finds it by its name when the browser handed out a new id', () => {
    const renamed = { ...desk, deviceId: 'new-desk-id' };
    expect(pickCamera([front, renamed], { deviceId: 'desk-id', label: 'USB Camera' })).toBe(renamed);
  });

  test('finds nothing for the default camera or a camera that is gone', () => {
    expect(pickCamera([front, desk], { deviceId: '', label: '' })).toBeUndefined();
    expect(pickCamera([front], { deviceId: 'desk-id', label: 'USB Camera' })).toBeUndefined();
  });
});

describe('isPickedCameraMissing', () => {
  test('is true only for a picked camera missing from a named list', () => {
    expect(isPickedCameraMissing([front], { deviceId: 'desk-id', label: 'USB Camera' })).toBe(true);
    expect(isPickedCameraMissing([front, desk], { deviceId: 'desk-id', label: 'USB Camera' })).toBe(false);
    expect(isPickedCameraMissing([front], { deviceId: '', label: '' })).toBe(false);
  });

  test('cannot tell before the browser names the cameras', () => {
    const unnamed = { deviceId: '', kind: 'videoinput', label: '' };
    expect(isPickedCameraMissing([unnamed], { deviceId: 'desk-id', label: 'USB Camera' })).toBe(false);
  });
});

describe('cameraChoices', () => {
  test('lists the default camera, then each camera by name', () => {
    expect(cameraChoices([front, desk], { deviceId: '', label: '' }, text)).toEqual({
      'Default camera': '',
      'FaceTime HD Camera': 'front-id',
      'USB Camera': 'desk-id',
    });
  });

  test('numbers cameras the browser has not named and leaves out ones without an id', () => {
    expect(
      cameraChoices(
        [
          { deviceId: 'a', kind: 'videoinput', label: '' },
          { deviceId: '', kind: 'videoinput', label: '' },
        ],
        { deviceId: '', label: '' },
        text,
      ),
    ).toEqual({ 'Default camera': '', 'Camera 1': 'a' });
  });

  test('tells two cameras of one model apart', () => {
    const twin = { ...desk, deviceId: 'desk-2' };
    expect(Object.keys(cameraChoices([desk, twin], { deviceId: '', label: '' }, text))).toEqual([
      'Default camera',
      'USB Camera',
      'USB Camera (2)',
    ]);
  });

  test('keeps a picked camera that is not connected, marked', () => {
    expect(cameraChoices([front], { deviceId: 'desk-id', label: 'USB Camera' }, text)).toEqual({
      'Default camera': '',
      'FaceTime HD Camera': 'front-id',
      'USB Camera (not connected)': 'desk-id',
    });
  });
});

describe('cameraConstraints', () => {
  test('asks for the picked camera exactly, and no sound', () => {
    expect(cameraConstraints({ deviceId: 'old-id' }, desk)).toEqual({
      audio: false,
      video: { deviceId: { exact: 'desk-id' } },
    });
  });

  test('asks for any camera with no pick', () => {
    expect(cameraConstraints({ deviceId: '' }, undefined)).toEqual({ audio: false, video: true });
  });
});
