// Which family draws each screen, and the kit it draws with: the Debug Menu's "Skin system" pick, or the auto chain
// (beatoraja → LR2 → built-in), over what the theme services have loaded (`family-dispatch.ts`).

import type { DecideSceneKit, PlaySceneKit, SelectSceneKit } from '@be-music/player-web/host';
import type { SkinFamilyId } from '@be-music/player-web/skin';
import { pickLR2PlaySkin, pickLR2PlaySkinVariant } from '@be-music/lr2-skin';
import { resolveCourseView, type LibraryChart, type LibraryCourse, type SystemSoundSet } from '@be-music/scene-model';
import type { CourseStagePlay } from '../course-flow.ts';
import { pickActiveFamilyForScene, type FamilyDispatchState } from '../family-dispatch.ts';
import type { BeatorajaPlayEntry, BeatorajaThemeService } from '../services/themes/beatoraja.ts';
import type { BuiltInThemeService } from '../services/themes/built-in.ts';
import type { LR2ThemeService } from '../services/themes/lr2.ts';
import type { DemoGUIState } from '../types.ts';

export interface FamilyKitsOptions {
  /** The LR2 theme: its skins and its select sounds. */
  readonly lr2: Pick<
    LR2ThemeService,
    'playSkins' | 'selectSkin' | 'decideSkin' | 'resultSkin' | 'courseLR2Skin' | 'selectSoundSet'
  >;
  /** The beatoraja theme: its entries loaded as kits, and its select sounds. */
  readonly beatoraja: Pick<
    BeatorajaThemeService,
    'beatorajaTheme' | 'loadBeatorajaPlayKit' | 'loadBeatorajaDecideKit' | 'selectSoundSet'
  >;
  /** The be-music skin the built-in family draws with. */
  readonly builtIn: Pick<BuiltInThemeService, 'beMusicSkin' | 'builtInKit'>;
  /** The Debug Menu's "Skin system" pick (`skinFamilyOverride`). */
  readonly guiState: Pick<DemoGUIState, 'skinFamilyOverride'>;
}

/** The kit a play is drawn with, and on a beatoraja theme the play entry it was loaded from. */
export interface ResolvedPlayKit {
  readonly kit: PlaySceneKit;
  /** The beatoraja theme's play entry, which the play puts in force as it takes the stage (`activeBeatorajaPlay`). */
  readonly beatorajaPlay?: BeatorajaPlayEntry;
}

/** The family each screen is drawn by, and its kit, from the theme services and the "Skin system" pick. */
export class FamilyKits {
  private readonly lr2: FamilyKitsOptions['lr2'];
  private readonly beatoraja: FamilyKitsOptions['beatoraja'];
  private readonly builtIn: FamilyKitsOptions['builtIn'];
  private readonly guiState: FamilyKitsOptions['guiState'];

  public constructor(options: FamilyKitsOptions) {
    this.lr2 = options.lr2;
    this.beatoraja = options.beatoraja;
    this.builtIn = options.builtIn;
    this.guiState = options.guiState;
  }

  /**
   * Bundle the theme services' skins and the "Skin system" pick into the {@link FamilyDispatchState} shape consumed by
   * `family-dispatch.ts`. Built per call (cheap — a half-dozen direct references) so the pure helpers can stay
   * unaware of where the state lives.
   */
  public familyDispatchState(): FamilyDispatchState {
    return {
      beatorajaTheme: this.beatoraja.beatorajaTheme,
      selectSkin: this.lr2.selectSkin,
      decideSkin: this.lr2.decideSkin,
      resultSkin: this.lr2.resultSkin,
      playSkins: this.lr2.playSkins,
      skinFamilyOverride: this.guiState.skinFamilyOverride,
    };
  }

  /**
   * The select screen's sounds as a `SystemSoundSet` for the family drawing it: a beatoraja theme's cues and select BGM
   * (by path, read from the theme's files; its decide sound plays on its decide screen), or the LR2 theme's select BGM,
   * decide jingle and cues (by bytes); none without a theme.
   */
  public selectSoundSet(family: SelectSceneKit['family']): SystemSoundSet {
    return family === 'beatoraja' ? this.beatoraja.selectSoundSet() : this.lr2.selectSoundSet();
  }

  /**
   * The kit the decide splash of `family` is drawn with, or `undefined` for no splash: the beatoraja theme's decide
   * entry, the LR2 theme's decide skin, or the be-music skin's decide screen. A be-music skin's decide screen hands over
   * to the LR2 / default gameplay preloaded behind it, so it is skipped when the play itself runs on a beatoraja theme.
   */
  public async decideKitFor(
    family: SkinFamilyId,
    song: LibraryChart,
    playsOnBeatoraja: boolean,
  ): Promise<DecideSceneKit | undefined> {
    switch (family) {
      case 'beatoraja':
        return this.beatoraja.loadBeatorajaDecideKit(song);
      case 'lr2':
        return this.lr2.decideSkin !== undefined ? { family: 'lr2', skin: this.lr2.decideSkin } : undefined;
      default:
        return this.builtIn.beMusicSkin.decide !== undefined && !playsOnBeatoraja ? this.builtIn.builtInKit : undefined;
    }
  }

  /**
   * The kit `song` plays with, for the gameplay family the Debug Menu's "Skin family" pick (or the auto chain) gives it:
   *
   * - **beatoraja** (`playsOnBeatoraja`, a replay and a stitched NONSTOP chart included) → the theme's play entry
   *   (`loadBeatorajaPlayKit`), with the entry; `undefined` when it cannot be loaded.
   * - **LR2** with a play skin for the chart's key mode → an LR2 kit with that skin (parsed again with the course's ops
   *   for a course stage or a NONSTOP run), and the theme's 9-keys skin, whose Pop'n green wide note at index 3 is drawn
   *   over each invisible note when {@link DemoGUIState.showInvisibleNotes} is on.
   * - otherwise → the built-in kit with the active be-music skin.
   *
   * Nothing is put in force here: the play may load behind a decide screen that is backed out of.
   */
  public async resolvePlayKit(
    song: LibraryChart,
    overrides: { courseStage?: CourseStagePlay; nonstop?: { readonly course: LibraryCourse } },
  ): Promise<ResolvedPlayKit | undefined> {
    if (this.playsOnBeatoraja(song)) {
      const loaded = await this.beatoraja.loadBeatorajaPlayKit(song);
      return loaded !== undefined
        ? {
            kit: loaded.kit,
            beatorajaPlay: { entryPath: loaded.entryPath, header: loaded.header, variant: loaded.variant },
          }
        : undefined;
    }
    // Picking `'default'` from the Debug Menu strips the LR2 skin even when one is loaded for this chart.
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    const playSkin =
      gameplayFamily !== 'lr2'
        ? undefined
        : overrides.courseStage !== undefined || overrides.nonstop !== undefined
          ? this.lr2.courseLR2Skin(
              pickLR2PlaySkin(this.lr2.playSkins, song),
              overrides.courseStage?.courseInfo ?? resolveCourseView(overrides.nonstop!.course, 0),
              { kind: 'play', playVariant: pickLR2PlaySkinVariant(this.lr2.playSkins, song) },
            )
          : pickLR2PlaySkin(this.lr2.playSkins, song);
    if (playSkin === undefined) return { kit: this.builtIn.builtInKit };
    const invisibleNoteSkin = this.lr2.playSkins['9'];
    return {
      kit: { family: 'lr2', skin: playSkin, ...(invisibleNoteSkin !== undefined ? { invisibleNoteSkin } : {}) },
    };
  }

  /**
   * Whether a play of `song` runs on the beatoraja play screen: the gameplay family says so, whatever the play is (a
   * replay and a stitched NONSTOP chart included: the play session carries the play log arrangement and the per-stage
   * audio for every family). Every path into gameplay — `playSong`, and the decide splash deciding what to preload — asks
   * this one question.
   */
  public playsOnBeatoraja(song: LibraryChart): boolean {
    return pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song) === 'beatoraja';
  }
}
