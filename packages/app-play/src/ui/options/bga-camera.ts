// The Options dialog's Camera tab: show a camera in the play's BGA frame, which camera, whether it is mirrored, and a
// preview of it. It is built with the dialog as `this` (`OptionsDialog`). The settings are live: a play showing takes
// them from the next frame, so the play lock leaves them enabled.
import { html, render } from 'lit';
import { cameraChoices, type BGACameraAspect, type BGACameraResolution } from '../../bga-camera-settings.ts';
import { paneOptions, selectBinding } from '../../pane-controls.ts';
import { onPlayerLangChange, playerLang, playerText } from '../../player-copy.ts';
import { optionLabel } from './labels.ts';
import type { BGACameraService } from '../../services/bga-camera.ts';
import type { OptionsDialog } from './index.ts';

/** The Camera resolution choices, by their English text (`labels.ts` has the Japanese). */
const RESOLUTION_CHOICES: Record<string, BGACameraResolution> = {
  "Camera's own": 'auto',
  '480p': '480p',
  '720p': '720p',
  '1080p': '1080p',
};
/** The Camera aspect ratio choices. */
const ASPECT_CHOICES: Record<string, BGACameraAspect> = {
  "Camera's own": 'auto',
  '4:3': '4:3',
  '16:9': '16:9',
  '1:1 (square)': '1:1',
};

export function buildBGACameraFolder(this: OptionsDialog, camera: BGACameraService): void {
  // The controls' own copy of the settings; `paint` brings it in line with the service.
  const state = {
    enabled: camera.settings.enabled,
    deviceId: camera.settings.deviceId,
    mirror: camera.settings.mirror,
    resolution: camera.settings.resolution,
    aspect: camera.settings.aspect,
  };
  const choices = (): Record<string, string> => {
    const text = playerText().camera;
    return cameraChoices(camera.cameras, camera.settings, {
      defaultCamera: text.defaultCamera,
      unnamed: text.unnamed,
      missing: text.missingChoice,
    });
  };
  // The preview runs while the Camera tab shows and the camera is on: no button to press.
  let previewShown = false;
  const syncPreview = (): void => {
    if (previewShown && camera.settings.enabled && camera.status !== 'unsupported') void camera.startPreview();
    else camera.stopPreview();
  };
  const enabled = this.place('bgaCameraEnabled')
    .addBinding(state, 'enabled', { label: 'Show camera in BGA' })
    .on('change', ({ value }) => {
      camera.setEnabled(value);
      syncPreview();
    });
  const device = selectBinding(this.place('bgaCameraDevice'), state, 'deviceId', 'Camera', choices()).on(
    'change',
    ({ value }) => camera.setDevice(value),
  );
  // The browser names the cameras only once the player has allowed one.
  const access = this.place('bgaCameraAccess')
    .addButton({ title: 'Allow camera access' })
    .on('click', () => void camera.requestAccess());
  const mirror = this.place('bgaCameraMirror')
    .addBinding(state, 'mirror', { label: 'Mirror camera' })
    .on('change', ({ value }) => camera.setMirror(value));
  // What to ask the camera for; a camera that cannot give it opens at its nearest.
  const resolution = selectBinding(
    this.place('bgaCameraResolution'),
    state,
    'resolution',
    'Camera resolution',
    RESOLUTION_CHOICES,
  ).on('change', ({ value }) => camera.setFormat({ resolution: value }));
  const aspect = selectBinding(
    this.place('bgaCameraAspect'),
    state,
    'aspect',
    'Camera aspect ratio',
    ASPECT_CHOICES,
  ).on('change', ({ value }) => camera.setFormat({ aspect: value }));
  // The dialog relabels its controls, not a select's choices: these follow the player's language here.
  const relabel = (): void => {
    const localize = <T>(choice: { text: string; value: T }) => ({
      ...choice,
      text: optionLabel(choice.text, playerLang()),
    });
    resolution.options = paneOptions(RESOLUTION_CHOICES).map(localize);
    aspect.options = paneOptions(ASPECT_CHOICES).map(localize);
  };
  relabel();
  onPlayerLangChange(relabel);
  // The preview: the picked camera as the BGA frame would show it. It runs only while it is on screen.
  const preview = document.createElement('div');
  preview.className = 'options-camera-preview';
  this.place('bgaCameraPreview').addElement(preview);
  new IntersectionObserver((entries) => {
    // Shown or hidden (another tab, the dialog closed), not scrolled away: the preview follows the tab.
    const entry = entries.at(-1);
    if (entry === undefined) return;
    previewShown = entry.boundingClientRect.width > 0;
    syncPreview();
  }).observe(preview);
  const note = document.createElement('div');
  note.className = 'options-camera-note';
  this.place('bgaCameraNote').addElement(note);
  const paint = (): void => {
    const text = playerText().camera;
    state.enabled = camera.settings.enabled;
    state.deviceId = camera.settings.deviceId;
    state.mirror = camera.settings.mirror;
    state.resolution = camera.settings.resolution;
    state.aspect = camera.settings.aspect;
    device.options = paneOptions(choices());
    enabled.refresh();
    mirror.refresh();
    resolution.refresh();
    aspect.refresh();
    const status = camera.status;
    const unsupported = status === 'unsupported';
    for (const row of [enabled, device, access, mirror, resolution, aspect]) row.unavailable = unsupported;
    access.unavailable = unsupported || (camera.namesKnown && status !== 'denied');
    const stream = camera.previewStream;
    const problem = camera.previewProblem;
    render(
      html`<video
          class="options-camera-preview-video"
          ?hidden=${stream === undefined}
          ?data-mirror=${camera.settings.mirror}
          .srcObject=${stream ?? null}
          .muted=${true}
          autoplay
          playsinline
          aria-label=${text.previewLabel}
        ></video>
        ${
          stream === undefined
            ? html`<p class="options-camera-preview-message">
                ${
                  camera.previewing
                    ? text.status.starting
                    : problem !== undefined && problem !== 'off' && problem !== 'standby' && problem !== 'live'
                      ? text.status[problem]
                      : text.previewOff
                }
              </p>`
            : ''
        }`,
      preview,
    );
    render(
      html`<p class="options-camera-status" role="status" data-status=${status}>${text.status[status]}</p>
        ${!unsupported && !camera.namesKnown ? html`<p>${text.needNames}</p>` : ''}
        <p>${text.privacy}</p>`,
      note,
    );
  };
  camera.subscribe(paint);
  onPlayerLangChange(paint);
  paint();
  void camera.watch();
}
