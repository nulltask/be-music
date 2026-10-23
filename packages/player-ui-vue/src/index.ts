import type { DefineComponent } from 'vue';
import type {
  BeMusicScoreData,
  BeMusicJudgmentData,
  BeMusicGaugeData,
  BeMusicTimingData,
  BeMusicSettingsData,
  LibraryEntry,
  BeMusicDOMSelectFrame,
  BeMusicDOMGameplayFrame,
  BeMusicDOMResultFrame,
  BeMusicDOMDecideFrame,
  BeMusicGameplayFrame,
  BeMusicBGAData,
  BeMusicLanesData,
  BeMusicNotesData,
  BeMusicLaneCoversData,
  BeMusicJudgeLineData,
  BeMusicBombsData,
  BeMusicJudgmentDisplayData,
  BeMusicRect,
  BeMusicPlaybackData,
  LibraryChart,
} from '@be-music/player-ui';
import { wrap, type BeMusicVueEventHandlers, type BeMusicVueElementRef } from './wrap.ts';
export type { BeMusicVueEventHandlers, BeMusicVueElementRef } from './wrap.ts';

export type BeMusicScoreSummaryProps = { data?: BeMusicScoreData; compact?: boolean } & BeMusicVueEventHandlers<never>;
export const BeMusicScoreSummary: DefineComponent<BeMusicScoreSummaryProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicScoreData; compact?: boolean },
  never
>('BeMusicScoreSummary', 'be-music-score-summary', ['data', 'compact'], []);

export type BeMusicJudgmentTableProps = { data?: BeMusicJudgmentData } & BeMusicVueEventHandlers<never>;
export const BeMusicJudgmentTable: DefineComponent<BeMusicJudgmentTableProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicJudgmentData },
  never
>('BeMusicJudgmentTable', 'be-music-judgment-table', ['data'], []);

export type BeMusicGaugePanelProps = { data?: BeMusicGaugeData; compact?: boolean } & BeMusicVueEventHandlers<never>;
export const BeMusicGaugePanel: DefineComponent<BeMusicGaugePanelProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicGaugeData; compact?: boolean },
  never
>('BeMusicGaugePanel', 'be-music-gauge-panel', ['data', 'compact'], []);

export type BeMusicTimingGraphProps = { data?: BeMusicTimingData } & BeMusicVueEventHandlers<never>;
export const BeMusicTimingGraph: DefineComponent<BeMusicTimingGraphProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicTimingData },
  never
>('BeMusicTimingGraph', 'be-music-timing-graph', ['data'], []);

export type BeMusicPlaySettingsProps = { data?: BeMusicSettingsData } & BeMusicVueEventHandlers<never>;
export const BeMusicPlaySettings: DefineComponent<BeMusicPlaySettingsProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicSettingsData },
  never
>('BeMusicPlaySettings', 'be-music-play-settings', ['data'], []);

export type BeMusicChartListProps = {
  entries?: readonly LibraryEntry[];
  selectedIndex?: number;
  disabled?: boolean;
} & BeMusicVueEventHandlers<'selection-change' | 'activate-request'>;
export const BeMusicChartList: DefineComponent<BeMusicChartListProps, BeMusicVueElementRef> = wrap<
  { entries?: readonly LibraryEntry[]; selectedIndex?: number; disabled?: boolean },
  'selection-change' | 'activate-request'
>(
  'BeMusicChartList',
  'be-music-chart-list',
  ['entries', 'selectedIndex', 'disabled'],
  ['selection-change', 'activate-request'],
);

export type BeMusicChartDetailsProps = {
  entry?: LibraryEntry;
  launching?: boolean;
  readText?: string;
} & BeMusicVueEventHandlers<'play-request' | 'readme-request'>;
export const BeMusicChartDetails: DefineComponent<BeMusicChartDetailsProps, BeMusicVueElementRef> = wrap<
  { entry?: LibraryEntry; launching?: boolean; readText?: string },
  'play-request' | 'readme-request'
>(
  'BeMusicChartDetails',
  'be-music-chart-details',
  ['entry', 'launching', 'readText'],
  ['play-request', 'readme-request'],
);

export type BeMusicPlayOptionsProps = {
  options?: BeMusicDOMSelectFrame['playOptions'];
  choices?: BeMusicDOMSelectFrame['playOptionChoices'];
  disabled?: boolean;
} & BeMusicVueEventHandlers<'play-option-change'>;
export const BeMusicPlayOptions: DefineComponent<BeMusicPlayOptionsProps, BeMusicVueElementRef> = wrap<
  {
    options?: BeMusicDOMSelectFrame['playOptions'];
    choices?: BeMusicDOMSelectFrame['playOptionChoices'];
    disabled?: boolean;
  },
  'play-option-change'
>('BeMusicPlayOptions', 'be-music-play-options', ['options', 'choices', 'disabled'], ['play-option-change']);

export type BeMusicSelectScreenProps = { frame?: BeMusicDOMSelectFrame } & BeMusicVueEventHandlers<
  | 'selection-change'
  | 'activate-request'
  | 'play-request'
  | 'readme-request'
  | 'search-change'
  | 'back-request'
  | 'gesture-request'
  | 'play-option-change'
>;
export const BeMusicSelectScreen: DefineComponent<BeMusicSelectScreenProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicDOMSelectFrame },
  | 'selection-change'
  | 'activate-request'
  | 'play-request'
  | 'readme-request'
  | 'search-change'
  | 'back-request'
  | 'gesture-request'
  | 'play-option-change'
>(
  'BeMusicSelectScreen',
  'be-music-select-screen',
  ['frame'],
  [
    'selection-change',
    'activate-request',
    'play-request',
    'readme-request',
    'search-change',
    'back-request',
    'gesture-request',
    'play-option-change',
  ],
);

export type BeMusicGameplayHUDProps = { frame?: BeMusicDOMGameplayFrame } & BeMusicVueEventHandlers<
  'pause-request' | 'retry-request' | 'quit-request'
>;
export const BeMusicGameplayHUD: DefineComponent<BeMusicGameplayHUDProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicDOMGameplayFrame },
  'pause-request' | 'retry-request' | 'quit-request'
>('BeMusicGameplayHUD', 'be-music-gameplay-hud', ['frame'], ['pause-request', 'retry-request', 'quit-request']);

export type BeMusicResultScreenProps = { frame?: BeMusicDOMResultFrame } & BeMusicVueEventHandlers<
  'continue-request' | 'retry-request'
>;
export const BeMusicResultScreen: DefineComponent<BeMusicResultScreenProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicDOMResultFrame },
  'continue-request' | 'retry-request'
>('BeMusicResultScreen', 'be-music-result-screen', ['frame'], ['continue-request', 'retry-request']);

export type BeMusicDecideScreenProps = { frame?: BeMusicDOMDecideFrame } & BeMusicVueEventHandlers<
  'continue-request' | 'cancel-request'
>;
export const BeMusicDecideScreen: DefineComponent<BeMusicDecideScreenProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicDOMDecideFrame },
  'continue-request' | 'cancel-request'
>('BeMusicDecideScreen', 'be-music-decide-screen', ['frame'], ['continue-request', 'cancel-request']);

export type BeMusicBGAProps = { data?: BeMusicBGAData; rect?: BeMusicRect } & BeMusicVueEventHandlers<never>;
export const BeMusicBGA: DefineComponent<BeMusicBGAProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicBGAData; rect?: BeMusicRect },
  never
>('BeMusicBGA', 'be-music-bga', ['data', 'rect'], []);

export type BeMusicLanesProps = { data?: BeMusicLanesData; rect?: BeMusicRect } & BeMusicVueEventHandlers<never>;
export const BeMusicLanes: DefineComponent<BeMusicLanesProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicLanesData; rect?: BeMusicRect },
  never
>('BeMusicLanes', 'be-music-lanes', ['data', 'rect'], []);

export type BeMusicNotesProps = { data?: BeMusicNotesData; rect?: BeMusicRect } & BeMusicVueEventHandlers<never>;
export const BeMusicNotes: DefineComponent<BeMusicNotesProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicNotesData; rect?: BeMusicRect },
  never
>('BeMusicNotes', 'be-music-notes', ['data', 'rect'], []);

export type BeMusicLaneCoversProps = {
  data?: BeMusicLaneCoversData;
  rect?: BeMusicRect;
} & BeMusicVueEventHandlers<never>;
export const BeMusicLaneCovers: DefineComponent<BeMusicLaneCoversProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicLaneCoversData; rect?: BeMusicRect },
  never
>('BeMusicLaneCovers', 'be-music-lane-covers', ['data', 'rect'], []);

export type BeMusicJudgeLineProps = {
  data?: BeMusicJudgeLineData;
  rect?: BeMusicRect;
} & BeMusicVueEventHandlers<never>;
export const BeMusicJudgeLine: DefineComponent<BeMusicJudgeLineProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicJudgeLineData; rect?: BeMusicRect },
  never
>('BeMusicJudgeLine', 'be-music-judge-line', ['data', 'rect'], []);

export type BeMusicBombsProps = { data?: BeMusicBombsData; rect?: BeMusicRect } & BeMusicVueEventHandlers<never>;
export const BeMusicBombs: DefineComponent<BeMusicBombsProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicBombsData; rect?: BeMusicRect },
  never
>('BeMusicBombs', 'be-music-bombs', ['data', 'rect'], []);

export type BeMusicJudgmentDisplayProps = {
  data?: BeMusicJudgmentDisplayData;
  rect?: BeMusicRect;
} & BeMusicVueEventHandlers<never>;
export const BeMusicJudgmentDisplay: DefineComponent<BeMusicJudgmentDisplayProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicJudgmentDisplayData; rect?: BeMusicRect },
  never
>('BeMusicJudgmentDisplay', 'be-music-judgment-display', ['data', 'rect'], []);

export type BeMusicPlayfieldProps = { frame?: BeMusicGameplayFrame } & BeMusicVueEventHandlers<never>;
export const BeMusicPlayfield: DefineComponent<BeMusicPlayfieldProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicGameplayFrame },
  never
>('BeMusicPlayfield', 'be-music-playfield', ['frame'], []);

type PlaybackEvents = 'pause-request' | 'seek-request' | 'volume-change' | 'fullscreen-request';
const PLAYBACK_EVENTS: PlaybackEvents[] = ['pause-request', 'seek-request', 'volume-change', 'fullscreen-request'];

export type BeMusicPlaybackControlsProps = { data?: BeMusicPlaybackData } & BeMusicVueEventHandlers<PlaybackEvents>;
export const BeMusicPlaybackControls: DefineComponent<BeMusicPlaybackControlsProps, BeMusicVueElementRef> = wrap<
  { data?: BeMusicPlaybackData },
  PlaybackEvents
>('BeMusicPlaybackControls', 'be-music-playback-controls', ['data'], PLAYBACK_EVENTS);

export type BeMusicPreviewHUDProps = {
  frame?: BeMusicDOMGameplayFrame;
  volume?: number;
  muted?: boolean;
  fullscreen?: boolean;
} & BeMusicVueEventHandlers<PlaybackEvents>;
export const BeMusicPreviewHUD: DefineComponent<BeMusicPreviewHUDProps, BeMusicVueElementRef> = wrap<
  { frame?: BeMusicDOMGameplayFrame; volume?: number; muted?: boolean; fullscreen?: boolean },
  PlaybackEvents
>('BeMusicPreviewHUD', 'be-music-preview-hud', ['frame', 'volume', 'muted', 'fullscreen'], PLAYBACK_EVENTS);

export type BeMusicPreviewSelectProps = {
  charts?: readonly LibraryChart[];
  heading?: string;
  images?: ReadonlyMap<string, string>;
} & BeMusicVueEventHandlers<'activate-request'>;
export const BeMusicPreviewSelect: DefineComponent<BeMusicPreviewSelectProps, BeMusicVueElementRef> = wrap<
  { charts?: readonly LibraryChart[]; heading?: string; images?: ReadonlyMap<string, string> },
  'activate-request'
>('BeMusicPreviewSelect', 'be-music-preview-select', ['charts', 'heading', 'images'], ['activate-request']);

export type BeMusicPreviewStartProps = {
  mode?: 'play' | 'replay';
  disabled?: boolean;
} & BeMusicVueEventHandlers<'play-request'>;
export const BeMusicPreviewStart: DefineComponent<BeMusicPreviewStartProps, BeMusicVueElementRef> = wrap<
  { mode?: 'play' | 'replay'; disabled?: boolean },
  'play-request'
>('BeMusicPreviewStart', 'be-music-preview-start', ['mode', 'disabled'], ['play-request']);
