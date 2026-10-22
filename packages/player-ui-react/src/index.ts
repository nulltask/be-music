'use client';

import type * as React from 'react';
import type { EventName, ReactWebComponent } from '@lit/react';
import {
  BeMusicScoreSummaryElement,
  BeMusicJudgmentTableElement,
  BeMusicGaugePanelElement,
  BeMusicTimingGraphElement,
  BeMusicPlaySettingsElement,
  BeMusicChartListElement,
  BeMusicChartDetailsElement,
  BeMusicPlayOptionsElement,
  BeMusicSelectScreenElement,
  BeMusicGameplayHUDElement,
  BeMusicResultScreenElement,
  BeMusicDecideScreenElement,
  BeMusicLanesElement,
  BeMusicNotesElement,
  BeMusicLaneCoversElement,
  BeMusicJudgeLineElement,
  BeMusicBombsElement,
  BeMusicJudgmentDisplayElement,
  BeMusicPlayfieldElement,
} from '@be-music/player-ui';
import type { BeMusicUIEvent } from '@be-music/player-ui';
import { wrap } from './wrap.ts';

const eventsScoreSummary = {};
export const BeMusicScoreSummary: ReactWebComponent<BeMusicScoreSummaryElement, typeof eventsScoreSummary> = wrap(
  'be-music-score-summary',
  BeMusicScoreSummaryElement,
  eventsScoreSummary,
);
export type BeMusicScoreSummaryProps = React.ComponentProps<typeof BeMusicScoreSummary>;

const eventsJudgmentTable = {};
export const BeMusicJudgmentTable: ReactWebComponent<BeMusicJudgmentTableElement, typeof eventsJudgmentTable> = wrap(
  'be-music-judgment-table',
  BeMusicJudgmentTableElement,
  eventsJudgmentTable,
);
export type BeMusicJudgmentTableProps = React.ComponentProps<typeof BeMusicJudgmentTable>;

const eventsGaugePanel = {};
export const BeMusicGaugePanel: ReactWebComponent<BeMusicGaugePanelElement, typeof eventsGaugePanel> = wrap(
  'be-music-gauge-panel',
  BeMusicGaugePanelElement,
  eventsGaugePanel,
);
export type BeMusicGaugePanelProps = React.ComponentProps<typeof BeMusicGaugePanel>;

const eventsTimingGraph = {};
export const BeMusicTimingGraph: ReactWebComponent<BeMusicTimingGraphElement, typeof eventsTimingGraph> = wrap(
  'be-music-timing-graph',
  BeMusicTimingGraphElement,
  eventsTimingGraph,
);
export type BeMusicTimingGraphProps = React.ComponentProps<typeof BeMusicTimingGraph>;

const eventsPlaySettings = {};
export const BeMusicPlaySettings: ReactWebComponent<BeMusicPlaySettingsElement, typeof eventsPlaySettings> = wrap(
  'be-music-play-settings',
  BeMusicPlaySettingsElement,
  eventsPlaySettings,
);
export type BeMusicPlaySettingsProps = React.ComponentProps<typeof BeMusicPlaySettings>;

const eventsChartList = {
  onSelectionChange: 'selection-change' as EventName<BeMusicUIEvent<'selection-change'>>,
  onActivateRequest: 'activate-request' as EventName<BeMusicUIEvent<'activate-request'>>,
};
export const BeMusicChartList: ReactWebComponent<BeMusicChartListElement, typeof eventsChartList> = wrap(
  'be-music-chart-list',
  BeMusicChartListElement,
  eventsChartList,
);
export type BeMusicChartListProps = React.ComponentProps<typeof BeMusicChartList>;

const eventsChartDetails = {
  onPlayRequest: 'play-request' as EventName<BeMusicUIEvent<'play-request'>>,
  onReadmeRequest: 'readme-request' as EventName<BeMusicUIEvent<'readme-request'>>,
};
export const BeMusicChartDetails: ReactWebComponent<BeMusicChartDetailsElement, typeof eventsChartDetails> = wrap(
  'be-music-chart-details',
  BeMusicChartDetailsElement,
  eventsChartDetails,
);
export type BeMusicChartDetailsProps = React.ComponentProps<typeof BeMusicChartDetails>;

const eventsPlayOptions = {
  onPlayOptionChange: 'play-option-change' as EventName<BeMusicUIEvent<'play-option-change'>>,
};
export const BeMusicPlayOptions: ReactWebComponent<BeMusicPlayOptionsElement, typeof eventsPlayOptions> = wrap(
  'be-music-play-options',
  BeMusicPlayOptionsElement,
  eventsPlayOptions,
);
export type BeMusicPlayOptionsProps = React.ComponentProps<typeof BeMusicPlayOptions>;

const eventsSelectScreen = {
  onSelectionChange: 'selection-change' as EventName<BeMusicUIEvent<'selection-change'>>,
  onActivateRequest: 'activate-request' as EventName<BeMusicUIEvent<'activate-request'>>,
  onPlayRequest: 'play-request' as EventName<BeMusicUIEvent<'play-request'>>,
  onReadmeRequest: 'readme-request' as EventName<BeMusicUIEvent<'readme-request'>>,
  onSearchChange: 'search-change' as EventName<BeMusicUIEvent<'search-change'>>,
  onBackRequest: 'back-request' as EventName<BeMusicUIEvent<'back-request'>>,
  onGestureRequest: 'gesture-request' as EventName<BeMusicUIEvent<'gesture-request'>>,
  onPlayOptionChange: 'play-option-change' as EventName<BeMusicUIEvent<'play-option-change'>>,
};
export const BeMusicSelectScreen: ReactWebComponent<BeMusicSelectScreenElement, typeof eventsSelectScreen> = wrap(
  'be-music-select-screen',
  BeMusicSelectScreenElement,
  eventsSelectScreen,
);
export type BeMusicSelectScreenProps = React.ComponentProps<typeof BeMusicSelectScreen>;

const eventsGameplayHUD = {
  onPauseRequest: 'pause-request' as EventName<BeMusicUIEvent<'pause-request'>>,
  onRetryRequest: 'retry-request' as EventName<BeMusicUIEvent<'retry-request'>>,
  onQuitRequest: 'quit-request' as EventName<BeMusicUIEvent<'quit-request'>>,
};
export const BeMusicGameplayHUD: ReactWebComponent<BeMusicGameplayHUDElement, typeof eventsGameplayHUD> = wrap(
  'be-music-gameplay-hud',
  BeMusicGameplayHUDElement,
  eventsGameplayHUD,
);
export type BeMusicGameplayHUDProps = React.ComponentProps<typeof BeMusicGameplayHUD>;

const eventsResultScreen = {
  onContinueRequest: 'continue-request' as EventName<BeMusicUIEvent<'continue-request'>>,
  onRetryRequest: 'retry-request' as EventName<BeMusicUIEvent<'retry-request'>>,
};
export const BeMusicResultScreen: ReactWebComponent<BeMusicResultScreenElement, typeof eventsResultScreen> = wrap(
  'be-music-result-screen',
  BeMusicResultScreenElement,
  eventsResultScreen,
);
export type BeMusicResultScreenProps = React.ComponentProps<typeof BeMusicResultScreen>;

const eventsDecideScreen = {
  onContinueRequest: 'continue-request' as EventName<BeMusicUIEvent<'continue-request'>>,
  onCancelRequest: 'cancel-request' as EventName<BeMusicUIEvent<'cancel-request'>>,
};
export const BeMusicDecideScreen: ReactWebComponent<BeMusicDecideScreenElement, typeof eventsDecideScreen> = wrap(
  'be-music-decide-screen',
  BeMusicDecideScreenElement,
  eventsDecideScreen,
);
export type BeMusicDecideScreenProps = React.ComponentProps<typeof BeMusicDecideScreen>;

const eventsLanes = {};
export const BeMusicLanes: ReactWebComponent<BeMusicLanesElement, typeof eventsLanes> = wrap(
  'be-music-lanes',
  BeMusicLanesElement,
  eventsLanes,
);
export type BeMusicLanesProps = React.ComponentProps<typeof BeMusicLanes>;

const eventsNotes = {};
export const BeMusicNotes: ReactWebComponent<BeMusicNotesElement, typeof eventsNotes> = wrap(
  'be-music-notes',
  BeMusicNotesElement,
  eventsNotes,
);
export type BeMusicNotesProps = React.ComponentProps<typeof BeMusicNotes>;

const eventsLaneCovers = {};
export const BeMusicLaneCovers: ReactWebComponent<BeMusicLaneCoversElement, typeof eventsLaneCovers> = wrap(
  'be-music-lane-covers',
  BeMusicLaneCoversElement,
  eventsLaneCovers,
);
export type BeMusicLaneCoversProps = React.ComponentProps<typeof BeMusicLaneCovers>;

const eventsJudgeLine = {};
export const BeMusicJudgeLine: ReactWebComponent<BeMusicJudgeLineElement, typeof eventsJudgeLine> = wrap(
  'be-music-judge-line',
  BeMusicJudgeLineElement,
  eventsJudgeLine,
);
export type BeMusicJudgeLineProps = React.ComponentProps<typeof BeMusicJudgeLine>;

const eventsBombs = {};
export const BeMusicBombs: ReactWebComponent<BeMusicBombsElement, typeof eventsBombs> = wrap(
  'be-music-bombs',
  BeMusicBombsElement,
  eventsBombs,
);
export type BeMusicBombsProps = React.ComponentProps<typeof BeMusicBombs>;

const eventsJudgmentDisplay = {};
export const BeMusicJudgmentDisplay: ReactWebComponent<BeMusicJudgmentDisplayElement, typeof eventsJudgmentDisplay> =
  wrap('be-music-judgment-display', BeMusicJudgmentDisplayElement, eventsJudgmentDisplay);
export type BeMusicJudgmentDisplayProps = React.ComponentProps<typeof BeMusicJudgmentDisplay>;

const eventsPlayfield = {};
export const BeMusicPlayfield: ReactWebComponent<BeMusicPlayfieldElement, typeof eventsPlayfield> = wrap(
  'be-music-playfield',
  BeMusicPlayfieldElement,
  eventsPlayfield,
);
export type BeMusicPlayfieldProps = React.ComponentProps<typeof BeMusicPlayfield>;
