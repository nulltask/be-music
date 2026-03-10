import type readline from 'node:readline';
import { describe, expect, test } from 'vitest';
import {
  appendFreeZoneInputChannels,
  createInputTokenToChannelsMap,
  createLaneBindings,
  resolveLaneDisplayMode,
  resolveInputTokenEvent,
} from './manual-input.ts';

describe('manual input', () => {
  test('manual-input: builds full 5-key SP lanes from used channels', () => {
    const bindings = createLaneBindings(['11', '14'], { platform: 'linux' });
    expect(bindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15']);
    expect(bindings.find((binding) => binding.channel === '16')).toMatchObject({
      keyLabel: 'LShift',
      inputTokens: ['shift-left', 'ctrl-left', 'control-left'],
      isScratch: true,
    });
  });

  test('manual-input: builds full 7-key SP lanes when 18/19 is used', () => {
    const bindings = createLaneBindings(['11', '18']);
    expect(bindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15', '18', '19']);
  });

  test('manual-input: builds full 5-key DP lanes when 2P channels are used', () => {
    const bindings = createLaneBindings(['11', '22'], { platform: 'linux' });
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
    ]);
    expect(bindings.filter((binding) => binding.side === '2P').map((binding) => binding.keyLabel)).toEqual([
      'b',
      'h',
      'n',
      'j',
      'm',
      'RShift',
    ]);
    expect(bindings.find((binding) => binding.channel === '26')).toMatchObject({
      keyLabel: 'RShift',
      inputTokens: ['shift-right', 'ctrl-right', 'control-right'],
      isScratch: true,
    });
  });

  test('manual-input: builds full 14-key DP lanes when 28/29 is used', () => {
    const bindings = createLaneBindings(['11', '21', '29']);
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '21',
      '22',
      '23',
      '24',
      '25',
      '28',
      '29',
      '26',
    ]);
    expect(bindings.filter((binding) => binding.side === '2P').map((binding) => binding.keyLabel)).toEqual([
      'b',
      'h',
      'n',
      'j',
      'm',
      'k',
      ',',
      'RShift',
    ]);
  });

  test('manual-input: uses Option for reverse scratch on macOS', () => {
    const bindings = createLaneBindings(['11', '22'], { platform: 'darwin' });

    expect(bindings.find((binding) => binding.channel === '16')?.inputTokens).toEqual([
      'shift-left',
      'option-left',
      'alt-left',
    ]);
    expect(bindings.find((binding) => binding.channel === '26')?.inputTokens).toEqual([
      'shift-right',
      'option-right',
      'alt-right',
    ]);
  });

  test('manual-input: builds full 9-key lanes with BME layout when .pms fallback has 16-19 markers', () => {
    const bindings = createLaneBindings(['11', '17'], { chartExtension: '.pms' });
    expect(bindings.map((binding) => binding.channel)).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
    expect(bindings.map((binding) => binding.keyLabel)).toEqual(['z', 's', 'x', 'd', 'c', 'f', 'v', 'g', 'b']);
    expect(bindings.find((binding) => binding.channel === '16')?.isScratch).toBe(false);
  });

  test('manual-input: builds full 9-key lanes with standard PMS layout when .pms fallback has 22-25 markers', () => {
    const bindings = createLaneBindings(['11', '22'], { chartExtension: '.pms' });
    expect(bindings.map((binding) => binding.channel)).toEqual(['11', '12', '13', '14', '15', '22', '23', '24', '25']);
    expect(bindings.map((binding) => binding.keyLabel)).toEqual(['z', 's', 'x', 'd', 'c', 'f', 'v', 'g', 'b']);
    expect(bindings.every((binding) => binding.side === '1P')).toBe(true);
  });

  test('manual-input: prefers standard PMS layout when .pms has mixed 16-19 and 22-25 markers', () => {
    const bindings = createLaneBindings(['11', '18', '22'], { chartExtension: '.pms' });
    expect(bindings.slice(0, 9).map((binding) => binding.channel)).toEqual([
      '11',
      '12',
      '13',
      '14',
      '15',
      '22',
      '23',
      '24',
      '25',
    ]);
    expect(bindings.at(-1)?.channel).toBe('18');
  });

  test('manual-input: defaults .pms ambiguous chart to standard PMS layout', () => {
    const bindings = createLaneBindings(['11'], { chartExtension: '.pms' });
    expect(bindings.map((binding) => binding.channel)).toEqual(['11', '12', '13', '14', '15', '22', '23', '24', '25']);
  });

  test('manual-input: treats lone channel 17 as unknown and keeps 5-key SP mode', () => {
    const bindings = createLaneBindings(['11', '12', '13', '14', '15', '17']);
    expect(bindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15']);
  });

  test('manual-input: prefers 9-key when #PLAYER=3 even without 18/19 channels', () => {
    const bindings = createLaneBindings(['11', '17'], { player: 3 });
    expect(bindings.map((binding) => binding.channel)).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19']);
  });

  test('manual-input: does not force 9-key for #PLAYER=2/4', () => {
    const coupleBindings = createLaneBindings(['11', '17'], { player: 2 });
    expect(coupleBindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15']);

    const battleBindings = createLaneBindings(['11', '17'], { player: 4 });
    expect(battleBindings.map((binding) => binding.channel)).toEqual(['16', '11', '12', '13', '14', '15']);
  });

  test('manual-input: falls back to extension mode when channels alone are ambiguous', () => {
    expect(createLaneBindings(['11'], { chartExtension: '.bms' }).map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
    expect(createLaneBindings(['11'], { chartExtension: '.bme' }).map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
    ]);
    expect(createLaneBindings(['11', '21'], { chartExtension: '.bme' }).map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '21',
      '22',
      '23',
      '24',
      '25',
      '28',
      '29',
      '26',
    ]);
  });

  test('manual-input: builds full 24-key SP lanes when extended 1P channel is used', () => {
    const bindings = createLaneBindings(['1A']);
    expect(bindings).toHaveLength(24);
    expect(bindings[0]?.channel).toBe('11');
    expect(bindings[23]?.channel).toBe('1O');
    expect(bindings.some((binding) => binding.channel === '21')).toBe(false);
    expect(bindings.find((binding) => binding.channel === '16')?.isScratch).toBe(false);
  });

  test('manual-input: builds full 48-key DP lanes when extended 2P channel is used', () => {
    const bindings = createLaneBindings(['2A']);
    expect(bindings).toHaveLength(48);
    expect(bindings[0]?.channel).toBe('11');
    expect(bindings[23]?.channel).toBe('1O');
    expect(bindings[24]?.channel).toBe('21');
    expect(bindings[47]?.channel).toBe('2O');
    expect(bindings.find((binding) => binding.channel === '26')?.isScratch).toBe(false);
  });

  test('manual-input: appends unknown channels after detected mode lanes', () => {
    const bindings = createLaneBindings(['11', '19', '0A', 'SC']);
    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
      '0A',
      'SC',
    ]);
    expect(bindings.at(-1)?.side).toBe('OTHER');
  });

  test('manual-input: appends free-zone channels to scratch input mapping', () => {
    const channels = ['11', '12', '13', '14', '15', '17', '21', '22', '23', '24', '25', '26', '27'];
    const bindings = createLaneBindings(channels, { platform: 'linux' });
    const inputMap = createInputTokenToChannelsMap(bindings);
    appendFreeZoneInputChannels(inputMap, bindings, channels);

    expect(bindings.map((binding) => binding.channel)).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
    ]);
    expect(inputMap.get('shift-left')).toContain('17');
    expect(inputMap.get('ctrl-left')).toContain('17');
    expect(inputMap.get('shift-right')).toContain('27');
    expect(inputMap.get('ctrl-right')).toContain('27');
  });

  test('manual-input: resolves kitty keyboard protocol tokens for scratch and controls', () => {
    const leftShiftPress = resolveInputTokenEvent('\u001b[57441;1:1u', createKey(undefined, '\u001b[57441;1:1u'));
    expect(leftShiftPress.tokens).toContain('shift-left');
    expect(leftShiftPress.tokens).toContain('shift');
    expect(leftShiftPress.repeatTokens).toEqual([]);
    expect(leftShiftPress.kittyProtocolEvent).toBe(true);

    const repeatedS = resolveInputTokenEvent('\u001b[115;1:2u', createKey(undefined, '\u001b[115;1:2u'));
    expect(repeatedS.tokens).toEqual([]);
    expect(repeatedS.repeatTokens).toContain('s');

    const rightShiftRelease = resolveInputTokenEvent('\u001b[57447;1:3u', createKey(undefined, '\u001b[57447;1:3u'));
    expect(rightShiftRelease.tokens).toEqual([]);
    expect(rightShiftRelease.repeatTokens).toEqual([]);
    expect(rightShiftRelease.releaseTokens).toContain('shift-right');
    expect(rightShiftRelease.kittyProtocolEvent).toBe(true);

    const leftCtrl = resolveInputTokenEvent('\u001b[57442;1:1u', createKey(undefined, '\u001b[57442;1:1u'));
    expect(leftCtrl.tokens).toContain('ctrl-left');
    expect(leftCtrl.tokens).toContain('control-left');
    expect(leftCtrl.tokens).toContain('ctrl');

    const rightAlt = resolveInputTokenEvent('\u001b[57449;1:1u', createKey(undefined, '\u001b[57449;1:1u'));
    expect(rightAlt.tokens).toContain('alt-right');
    expect(rightAlt.tokens).toContain('option-right');
    expect(rightAlt.tokens).toContain('alt');

    const ctrlC = resolveInputTokenEvent('\u001b[99;5:1u', createKey(undefined, '\u001b[99;5:1u'));
    expect(ctrlC.tokens).toContain('ctrl+c');
    expect(ctrlC.tokens).toContain('ctrl');

    const altS = resolveInputTokenEvent('\u001b[115;3:1u', createKey(undefined, '\u001b[115;3:1u'));
    expect(altS.tokens).toContain('alt+s');
    expect(altS.tokens).toContain('option+s');
    expect(altS.tokens).toContain('alt');

    const shiftW = resolveInputTokenEvent('\u001b[87;2:1u', createKey(undefined, '\u001b[87;2:1u'));
    expect(shiftW.tokens).toContain('w');
    expect(shiftW.tokens).toContain('shift+w');

    const implicitShiftW = resolveInputTokenEvent('\u001b[87;1:1u', createKey(undefined, '\u001b[87;1:1u'));
    expect(implicitShiftW.tokens).toContain('w');
    expect(implicitShiftW.tokens).toContain('shift+w');
  });

  test('manual-input: resolves ghostty short kitty shift key codes', () => {
    const leftShift = resolveInputTokenEvent('441;2u', createKey(undefined, '441;2u'));
    expect(leftShift.tokens).toContain('shift-left');

    const rightShift = resolveInputTokenEvent('447;2u', createKey(undefined, '447;2u'));
    expect(rightShift.tokens).toContain('shift-right');

    const rightShiftCombined = resolveInputTokenEvent(
      '447;2u447;1:3u',
      createKey(undefined, '447;2u447;1:3u'),
    );
    expect(rightShiftCombined.tokens).toContain('shift-right');
    expect(rightShiftCombined.releaseTokens).toContain('shift-right');
  });

  test('manual-input: resolves legacy Alt key tokens', () => {
    const altS = resolveInputTokenEvent('s', createKey('s', 's', false, false, true));
    expect(altS.tokens).toContain('s');
    expect(altS.tokens).toContain('alt');
    expect(altS.tokens).toContain('alt+s');
    expect(altS.tokens).toContain('option+s');
  });

  test('manual-input: resolves lane display mode labels', () => {
    expect(resolveLaneDisplayMode(['11'])).toBe('5 KEY SP');
    expect(resolveLaneDisplayMode(['11'], { chartExtension: '.bme' })).toBe('7 KEY SP');
    expect(resolveLaneDisplayMode(['11', '22'])).toBe('5 KEY DP');
    expect(resolveLaneDisplayMode(['11', '22'], { chartExtension: '.bme' })).toBe('14 KEY DP');
    expect(resolveLaneDisplayMode(['11', '19'])).toBe('7 KEY SP');
    expect(resolveLaneDisplayMode(['11', '21', '29'])).toBe('14 KEY DP');
    expect(resolveLaneDisplayMode(['1A'])).toBe('24 KEY SP');
    expect(resolveLaneDisplayMode(['2A'])).toBe('48 KEY DP');
    expect(resolveLaneDisplayMode(['11', '17'])).toBe('5 KEY SP');
    expect(resolveLaneDisplayMode(['11', '17'], { chartExtension: '.pms' })).toBe('9 KEY (PMS-COMPAT)');
    expect(resolveLaneDisplayMode(['11', '18', '22'], { chartExtension: '.pms' })).toBe('9 KEY (PMS-STD)');
    expect(resolveLaneDisplayMode(['11', '17'], { player: 3 })).toBe('9 KEY (PMS-COMPAT)');
  });
});

function createKey(name?: string, sequence?: string, shift = false, ctrl = false, meta = false): readline.Key {
  return {
    name,
    sequence: sequence ?? '',
    ctrl,
    meta,
    shift,
  } satisfies readline.Key;
}
