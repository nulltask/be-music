// The Options dialog's BGA camera folder (Skin tab): show a camera in the play's BGA frame, which camera, and whether
// it is mirrored. It is built with the dialog as `this` (`OptionsDialog`). The settings are live: a play showing takes
// them from the next frame, so the play lock leaves them enabled.
import { html, render } from 'lit';
import { cameraChoices } from '../../bga-camera-settings.ts';
import { paneOptions, selectBinding } from '../../pane-controls.ts';
import { onPlayerLangChange, playerText } from '../../player-copy.ts';
import type { BGACameraService } from '../../services/bga-camera.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';

export function buildBGACameraFolder(this: OptionsDialog, folder: OptionContainer, camera: BGACameraService): void {
  // The controls' own copy of the settings; `paint` brings it in line with the service.
  const state = {
    enabled: camera.settings.enabled,
    deviceId: camera.settings.deviceId,
    mirror: camera.settings.mirror,
  };
  const choices = (): Record<string, string> => {
    const text = playerText().camera;
    return cameraChoices(camera.cameras, camera.settings, {
      defaultCamera: text.defaultCamera,
      unnamed: text.unnamed,
      missing: text.missingChoice,
    });
  };
  const enabled = folder
    .addBinding(state, 'enabled', { label: 'Show camera in BGA' })
    .on('change', ({ value }) => camera.setEnabled(value));
  const device = selectBinding(folder, state, 'deviceId', 'Camera', choices()).on('change', ({ value }) =>
    camera.setDevice(value),
  );
  // The browser names the cameras only once the player has allowed one.
  const access = folder.addButton({ title: 'Allow camera access' }).on('click', () => void camera.requestAccess());
  const mirror = folder
    .addBinding(state, 'mirror', { label: 'Mirror camera' })
    .on('change', ({ value }) => camera.setMirror(value));
  const note = document.createElement('div');
  note.className = 'options-camera-note';
  folder.addElement(note);
  const paint = (): void => {
    const text = playerText().camera;
    state.enabled = camera.settings.enabled;
    state.deviceId = camera.settings.deviceId;
    state.mirror = camera.settings.mirror;
    device.options = paneOptions(choices());
    enabled.refresh();
    mirror.refresh();
    const status = camera.status;
    const unsupported = status === 'unsupported';
    for (const row of [enabled, device, access, mirror]) row.unavailable = unsupported;
    access.unavailable = unsupported || (camera.namesKnown && status !== 'denied');
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
