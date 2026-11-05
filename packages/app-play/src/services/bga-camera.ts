// The BGA camera: opens the camera the Options dialog picked while a play is on the stage and hands it to the play scene
// (`PlayScene.setBGACamera`), which shows it in the BGA frame in place of the chart's BGA. The camera opens only when
// the setting is on and a play is showing, and closes on every other screen. A camera that is unplugged or whose
// permission is taken back closes, and the play shows the chart's BGA again.
//
// The picture goes nowhere but the play's canvas. A Capture recording of the canvas includes it with the BGA frame.

import type { BGACamera } from '@be-music/player-browser/host';
import {
  BGA_CAMERA_STORAGE_KEY,
  cameraConstraints,
  cameraDevices,
  cameraNamesKnown,
  isPickedCameraMissing,
  parseStoredBGACameraSettings,
  pickCamera,
  serializeBGACameraSettings,
  type BGACameraSettings,
  type CameraDevice,
} from '../bga-camera-settings.ts';
import { playerText } from '../player-copy.ts';
import { defaultSettingStorage, type SettingStorage } from './settings.ts';

/**
 * Where the camera stands:
 * - `off`: the setting is off.
 * - `standby`: on, waiting for a play.
 * - `starting`: opening the camera.
 * - `live`: showing in the play's BGA frame.
 * - `denied`: the browser or the player refused the camera.
 * - `missing`: the picked camera, or any camera, is not connected.
 * - `busy`: another app holds the camera, or it failed to start.
 * - `unsupported`: the browser has no camera access here (no `getUserMedia`, or not a secure page).
 */
export type BGACameraStatus = 'off' | 'standby' | 'starting' | 'live' | 'denied' | 'missing' | 'busy' | 'unsupported';

/** What the service asks of the play scene. */
export interface BGACameraTarget {
  setBGACamera(camera: BGACamera | undefined): void;
}

export interface BGACameraServiceDeps {
  /** `navigator.mediaDevices`, or `undefined` where the page has none (not a secure context). */
  readonly mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices' | 'addEventListener'> | undefined;
  /** `navigator.permissions`, to hear when the camera permission is taken back. */
  readonly permissions?: Pick<Permissions, 'query'> | undefined;
  readonly storage?: SettingStorage | undefined;
  /** Shows a status line: the camera was lost, or could not open. */
  setStatus?(text: string): void;
}

/** A camera's `MediaDeviceInfo`, as far as the service reads it. */
export type BGACameraDevice = CameraDevice;

export class BGACameraService {
  private settingsValue: BGACameraSettings;
  private camerasValue: BGACameraDevice[] = [];
  private statusValue: BGACameraStatus;
  private target: BGACameraTarget | undefined;
  private stream: MediaStream | undefined;
  /** Moves on every open and close, so an open that settles after a newer one is dropped. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly deps: BGACameraServiceDeps;
  private watching = false;

  public constructor(deps: BGACameraServiceDeps) {
    this.deps = deps;
    this.settingsValue = parseStoredBGACameraSettings(this.storage()?.getItem(BGA_CAMERA_STORAGE_KEY));
    this.statusValue = deps.mediaDevices === undefined ? 'unsupported' : this.settingsValue.enabled ? 'standby' : 'off';
  }

  public get settings(): BGACameraSettings {
    return this.settingsValue;
  }

  /** The connected cameras, named once the player has allowed the camera. */
  public get cameras(): readonly BGACameraDevice[] {
    return this.camerasValue;
  }

  public get status(): BGACameraStatus {
    return this.statusValue;
  }

  /** Whether the browser has told the page the cameras' names (the player allowed the camera once). */
  public get namesKnown(): boolean {
    return cameraNamesKnown(this.camerasValue);
  }

  /** Runs `listener` whenever the settings, the cameras or the status change. Returns the unsubscribe. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lists the cameras, and from then on follows plugging and permission changes. */
  public async watch(): Promise<void> {
    const media = this.deps.mediaDevices;
    if (media === undefined) return;
    if (!this.watching) {
      this.watching = true;
      media.addEventListener('devicechange', () => void this.onDeviceChange());
      void this.deps.permissions
        ?.query({ name: 'camera' as PermissionName })
        .then((permission) => {
          permission.addEventListener('change', () => {
            if (permission.state === 'denied') this.lose('denied');
            void this.refreshCameras();
          });
        })
        .catch(() => {
          // Firefox has no `camera` permission query; a revoked permission still ends the camera's track.
        });
    }
    await this.refreshCameras();
  }

  /**
   * Asks the browser for the camera once, so it names the cameras, then closes it again (unless a play is showing it).
   * Resolves `false` when the player or the browser refused.
   */
  public async requestAccess(): Promise<boolean> {
    const media = this.deps.mediaDevices;
    if (media === undefined) return false;
    if (this.stream !== undefined) {
      await this.refreshCameras();
      return true;
    }
    try {
      const stream = await media.getUserMedia(cameraConstraints(this.settingsValue, undefined));
      for (const track of stream.getTracks()) track.stop();
    } catch (error) {
      this.setStatusValue(statusOfError(error));
      await this.refreshCameras();
      return false;
    }
    await this.refreshCameras();
    if (this.statusValue === 'denied') this.setStatusValue(this.idleStatus());
    return true;
  }

  public setEnabled(enabled: boolean): void {
    this.save({ ...this.settingsValue, enabled });
    if (enabled) void this.open();
    else this.close('off');
  }

  /** Picks the camera by `deviceId` (`''` for the browser's default) and opens it in place of the one showing. */
  public setDevice(deviceId: string): void {
    const camera = this.camerasValue.find((device) => device.deviceId === deviceId);
    this.save({
      ...this.settingsValue,
      deviceId,
      label: deviceId === '' ? '' : (camera?.label ?? this.settingsValue.label),
    });
    if (this.stream !== undefined || this.statusValue === 'missing' || this.statusValue === 'busy') {
      this.close(this.idleStatus());
      void this.open();
    }
  }

  public setMirror(mirror: boolean): void {
    this.save({ ...this.settingsValue, mirror });
    if (this.stream !== undefined) this.target?.setBGACamera({ stream: this.stream, mirror });
  }

  /**
   * The play on the stage, or `undefined` when another screen shows: the camera opens for a play when the setting is on
   * and closes as the play leaves. A play that follows a play (a retry) takes the camera over without reopening it.
   */
  public follow(target: BGACameraTarget | undefined): void {
    if (target === this.target) return;
    if (target === undefined) {
      this.close(this.idleStatus());
      this.target = undefined;
      return;
    }
    this.target = target;
    if (this.stream !== undefined) target.setBGACamera({ stream: this.stream, mirror: this.settingsValue.mirror });
    else void this.open();
  }

  /** Opens the picked camera for the play showing, when the setting is on. */
  private async open(): Promise<void> {
    const media = this.deps.mediaDevices;
    if (media === undefined || !this.settingsValue.enabled || this.target === undefined || this.stream !== undefined)
      return;
    const generation = ++this.generation;
    if (isPickedCameraMissing(this.camerasValue, this.settingsValue)) {
      this.setStatusValue('missing');
      return;
    }
    this.setStatusValue('starting');
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia(
        cameraConstraints(this.settingsValue, pickCamera(this.camerasValue, this.settingsValue)),
      );
    } catch (error) {
      if (generation !== this.generation) return;
      const status = statusOfError(error);
      this.setStatusValue(status);
      this.deps.setStatus?.(lostMessage(status));
      return;
    }
    if (generation !== this.generation || this.target === undefined || !this.settingsValue.enabled) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (this.stream === stream) this.lose('missing');
      });
    }
    this.target.setBGACamera({ stream, mirror: this.settingsValue.mirror });
    this.setStatusValue('live');
    // The cameras have names now; a picked camera found by its name gets its new id.
    await this.refreshCameras();
    const picked = pickCamera(this.camerasValue, this.settingsValue);
    if (picked !== undefined && picked.deviceId !== this.settingsValue.deviceId && this.settingsValue.deviceId !== '')
      this.save({ ...this.settingsValue, deviceId: picked.deviceId });
  }

  /** Closes the camera and shows the chart's BGA again; `status` is where the camera stands after. */
  private close(status: BGACameraStatus): void {
    this.generation += 1;
    const stream = this.stream;
    this.stream = undefined;
    if (stream !== undefined) {
      this.target?.setBGACamera(undefined);
      for (const track of stream.getTracks()) track.stop();
    }
    this.setStatusValue(status);
  }

  /** The camera went away during a play: close it, show the BGA, and say so. */
  private lose(status: BGACameraStatus): void {
    if (this.stream === undefined) {
      if (this.settingsValue.enabled) this.setStatusValue(status);
      return;
    }
    this.close(status);
    this.deps.setStatus?.(lostMessage(status));
  }

  private async onDeviceChange(): Promise<void> {
    await this.refreshCameras();
    const track = this.stream?.getVideoTracks()[0];
    const deviceId = track?.getSettings().deviceId;
    if (track !== undefined && deviceId !== undefined && this.namesKnown) {
      if (!this.camerasValue.some((camera) => camera.deviceId === deviceId)) this.lose('missing');
      return;
    }
    // A camera plugged in while a play waits for it.
    if (this.stream === undefined && (this.statusValue === 'missing' || this.statusValue === 'busy')) {
      this.setStatusValue(this.idleStatus());
      void this.open();
    }
  }

  private async refreshCameras(): Promise<void> {
    const media = this.deps.mediaDevices;
    if (media === undefined) return;
    try {
      this.camerasValue = cameraDevices(await media.enumerateDevices()).map(({ deviceId, kind, label }) => ({
        deviceId,
        kind,
        label,
      }));
    } catch {
      this.camerasValue = [];
    }
    this.emit();
  }

  private idleStatus(): BGACameraStatus {
    if (this.deps.mediaDevices === undefined) return 'unsupported';
    return this.settingsValue.enabled ? 'standby' : 'off';
  }

  private save(settings: BGACameraSettings): void {
    this.settingsValue = settings;
    try {
      this.storage()?.setItem(BGA_CAMERA_STORAGE_KEY, serializeBGACameraSettings(settings));
    } catch {
      // Storage blocked — the settings last for this visit.
    }
    if (!settings.enabled && this.stream === undefined) this.statusValue = this.idleStatus();
    else if (settings.enabled && this.statusValue === 'off') this.statusValue = 'standby';
    this.emit();
  }

  private setStatusValue(status: BGACameraStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private storage(): SettingStorage | undefined {
    return this.deps.storage ?? defaultSettingStorage();
  }
}

/** Where the camera stands after `getUserMedia` threw `error`. */
export function statusOfError(error: unknown): BGACameraStatus {
  const name =
    error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
      ? String((error as { name: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'TypeError') return 'unsupported';
  return 'busy';
}

/** The status line for a camera that closed or did not open. */
function lostMessage(status: BGACameraStatus): string {
  const lost = playerText().camera.lost;
  return status === 'denied' || status === 'missing' || status === 'unsupported' ? lost[status] : lost.busy;
}
