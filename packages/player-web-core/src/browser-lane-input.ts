export interface BrowserLaneBinding {
  displayChannel: string;
  triggerChannels: string[];
  keyCodes: string[];
  keyLabel: string;
  isScratch: boolean;
  side: '1P' | '2P' | 'OTHER';
}

interface FixedBrowserLaneBindingDefinition {
  displayChannel: string;
  keyCodes: string[];
  keyLabel: string;
  isScratch?: boolean;
  side: '1P' | '2P' | 'OTHER';
}

const IIDX_7KEY_SP_BINDINGS: readonly FixedBrowserLaneBindingDefinition[] = [
  { displayChannel: '16', keyCodes: ['ShiftLeft'], keyLabel: 'LShift', side: '1P', isScratch: true },
  { displayChannel: '11', keyCodes: ['KeyZ'], keyLabel: 'Z', side: '1P' },
  { displayChannel: '12', keyCodes: ['KeyS'], keyLabel: 'S', side: '1P' },
  { displayChannel: '13', keyCodes: ['KeyX'], keyLabel: 'X', side: '1P' },
  { displayChannel: '14', keyCodes: ['KeyD'], keyLabel: 'D', side: '1P' },
  { displayChannel: '15', keyCodes: ['KeyC'], keyLabel: 'C', side: '1P' },
  { displayChannel: '18', keyCodes: ['KeyF'], keyLabel: 'F', side: '1P' },
  { displayChannel: '19', keyCodes: ['KeyV'], keyLabel: 'V', side: '1P' },
];

const IIDX_14KEY_DP_BINDINGS: readonly FixedBrowserLaneBindingDefinition[] = [
  ...IIDX_7KEY_SP_BINDINGS,
  { displayChannel: '21', keyCodes: ['KeyB'], keyLabel: 'B', side: '2P' },
  { displayChannel: '22', keyCodes: ['KeyH'], keyLabel: 'H', side: '2P' },
  { displayChannel: '23', keyCodes: ['KeyN'], keyLabel: 'N', side: '2P' },
  { displayChannel: '24', keyCodes: ['KeyJ'], keyLabel: 'J', side: '2P' },
  { displayChannel: '25', keyCodes: ['KeyM'], keyLabel: 'M', side: '2P' },
  { displayChannel: '28', keyCodes: ['KeyK'], keyLabel: 'K', side: '2P' },
  { displayChannel: '29', keyCodes: ['Comma'], keyLabel: ',', side: '2P' },
  { displayChannel: '26', keyCodes: ['ShiftRight'], keyLabel: 'RShift', side: '2P', isScratch: true },
];

export function createBrowserLaneBindings(
  displayChannels: ReadonlyArray<string>,
  sourceChannels: ReadonlyArray<string>,
): BrowserLaneBinding[] {
  const visibleDisplayChannels = new Set(displayChannels);
  const visibleSourceChannels = new Set(sourceChannels);
  const fixedBindings = [...(displayChannels.some((channel) => channel.startsWith('2')) ? IIDX_14KEY_DP_BINDINGS : IIDX_7KEY_SP_BINDINGS)];

  const bindings: BrowserLaneBinding[] = [];
  for (const definition of fixedBindings) {
    if (!visibleDisplayChannels.has(definition.displayChannel)) {
      continue;
    }
    const triggerChannels = new Set<string>([definition.displayChannel]);
    if (definition.displayChannel === '16' && visibleSourceChannels.has('17')) {
      triggerChannels.add('17');
    }
    if (definition.displayChannel === '26' && visibleSourceChannels.has('27')) {
      triggerChannels.add('27');
    }
    bindings.push({
      displayChannel: definition.displayChannel,
      triggerChannels: [...triggerChannels],
      keyCodes: [...definition.keyCodes],
      keyLabel: definition.keyLabel,
      isScratch: definition.isScratch === true,
      side: definition.side,
    });
  }
  return bindings;
}

export function createBrowserInputChannelMap(bindings: ReadonlyArray<BrowserLaneBinding>): Map<string, string[]> {
  const inputMap = new Map<string, string[]>();
  for (const binding of bindings) {
    for (const keyCode of binding.keyCodes) {
      const existing = inputMap.get(keyCode) ?? [];
      for (const channel of binding.triggerChannels) {
        if (!existing.includes(channel)) {
          existing.push(channel);
        }
      }
      inputMap.set(keyCode, existing);
    }
  }
  return inputMap;
}
