import { describe, expect, it } from 'vite-plus/test';
import { OPTION_FOLDERS, OPTIONS_TABS, clearPlayerSettings, playerSettingKeys, type PlayerStorage } from './folders.ts';

function memoryStorage(initial: Record<string, string> = {}): PlayerStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}

const BLOCKED_STORAGE: PlayerStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
  get length(): number {
    throw new Error('SecurityError');
  },
  key: () => {
    throw new Error('SecurityError');
  },
};

describe('Options dialog folder layout', () => {
  it('has unique folder titles', () => {
    const titles = Object.values(OPTION_FOLDERS).map((folder) => folder.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('has unique tab titles', () => {
    expect(new Set(OPTIONS_TABS).size).toBe(OPTIONS_TABS.length);
  });
});

describe('settings reset', () => {
  it('removes player settings but keeps best records and other sites’ keys', () => {
    const storage = memoryStorage({
      'be-music.volumes': '{}',
      'be-music.option-settings': '{}',
      'be-music.chart-best-records': '{}',
      'other-app.key': 'x',
    });
    expect(playerSettingKeys(storage).sort()).toEqual(['be-music.option-settings', 'be-music.volumes']);
    expect(clearPlayerSettings(storage)).toBe(2);
    expect([...storage.values.keys()].sort()).toEqual(['be-music.chart-best-records', 'other-app.key']);
  });

  it('does nothing on blocked storage', () => {
    expect(playerSettingKeys(BLOCKED_STORAGE)).toEqual([]);
    expect(clearPlayerSettings(BLOCKED_STORAGE)).toBe(0);
  });
});
