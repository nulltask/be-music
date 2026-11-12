// The key rows of the Options help: what each lane key and each screen key does, built from the key tables.
import { html, type TemplateResult } from 'lit';
import { CONTROL_ACTIONS, type ControlActionDefinition, type ControlScreen } from '@be-music/player-browser/host';
import { LANE_KEY_CONFIG, type LaneKeyConfigLane, type LaneKeyGroup } from '@be-music/player-engine/lanes';
import { ACTION_LABELS_JA, actionKeyConfigLabel, laneKeyConfigLabel, schemesOf } from './action-labels.ts';

export type HelpLang = 'en' | 'ja';

/** What a lane's row says it sets: the lane it plays, in its key config group. */
function laneKeyHelpText(group: LaneKeyGroup, lane: LaneKeyConfigLane, lang: HelpLang): string {
  if (group === 'popn') {
    return lang === 'ja'
      ? `9 KEY で ${lane.id} 番のボタンを押すキー。`
      : `The key that plays button ${lane.id} in 9 KEY.`;
  }
  if (lane.scratch) {
    return lang === 'ja'
      ? `5 / 7 / 10 / 14 KEY で ${lane.side} 側の皿を回すキー。Ctrl (1P 側は Space も) は皿の 2 つ目のキーのままです。`
      : `The key that turns the ${lane.side} turntable in 5 / 7 / 10 / 14 KEY. Ctrl (and Space on 1P) stays its second key.`;
  }
  const number = laneKeyConfigLabel(group, lane).split(' ').at(-1);
  return lang === 'ja'
    ? `5 / 7 / 10 / 14 KEY で ${lane.side} 側の ${number} 番の鍵盤を押すキー。`
    : `The key that plays the ${lane.side} side's key ${number} in 5 / 7 / 10 / 14 KEY.`;
}

/** An entry per lane of the key config, each naming the lane it sets. */
export function laneKeyHelp(lang: HelpLang): TemplateResult[] {
  return (['beat', 'popn'] as const).flatMap((group) =>
    LANE_KEY_CONFIG[group].map(
      (lane) =>
        html`<dt>${laneKeyConfigLabel(group, lane)}</dt>
          <dd>${laneKeyHelpText(group, lane, lang)}</dd>`,
    ),
  );
}

const SCREEN_PHRASES: Readonly<Record<HelpLang, Readonly<Record<ControlScreen, string>>>> = {
  en: {
    global: 'every screen',
    select: 'the select screen',
    decide: 'the decide screen',
    play: 'the play screen',
    result: 'the result screen',
  },
  ja: { global: 'すべての画面', select: '選曲画面', decide: '決定画面', play: 'プレイ画面', result: 'リザルト画面' },
};

/** What an operation's row says it sets: the operation and its screen, and the key map it is on when only one has it. */
export function screenKeyHelpText(definition: ControlActionDefinition, lang: HelpLang): string {
  const schemes = schemesOf(definition);
  const only = schemes.length === 1 ? (schemes[0] === 'lr2' ? 'LR2' : 'beatoraja') : undefined;
  const screen = SCREEN_PHRASES[lang][definition.screen];
  if (lang === 'ja') {
    const name = ACTION_LABELS_JA[definition.label] ?? definition.label;
    return `${screen}で「${name}」を行うキー。${only === undefined ? '' : `${only} のキー操作だけにあります。`}`;
  }
  return `The keys for “${definition.label}” on ${screen}.${only === undefined ? '' : ` Only ${only}'s key map has it.`}`;
}

/** An entry per operation of the Screens page. */
export function screenKeyHelp(lang: HelpLang): TemplateResult[] {
  return CONTROL_ACTIONS.map((action) => {
    const definition = action as ControlActionDefinition;
    return html`<dt>${actionKeyConfigLabel(definition)}</dt>
      <dd>${screenKeyHelpText(definition, lang)}</dd>`;
  });
}
