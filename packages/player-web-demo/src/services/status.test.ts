import { describe, expect, test, vi } from 'vite-plus/test';
import { StatusLine } from './status.ts';

function setup() {
  const settings = { status: '' };
  const refresh = vi.fn<() => void>();
  const record = vi.fn<(text: string) => void>();
  return { settings, refresh, record, status: new StatusLine({ settings, refresh, record }) };
}

describe('StatusLine', () => {
  test('writes the line into the settings, repaints the Status row, then hands it to the test hook', () => {
    const { settings, refresh, record, status } = setup();
    refresh.mockImplementation(() => {
      // The row repaints from the settings, so the new line is there first.
      expect(settings.status).toBe('Loaded 3 songs');
    });
    status.set('Loaded 3 songs');
    expect(settings.status).toBe('Loaded 3 songs');
    expect(refresh).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('Loaded 3 songs');
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]!);
  });

  test("remembers a play's or result's line until the next plain one", () => {
    const { settings, record, status } = setup();
    expect(status.playShown).toBe(false);
    status.setPlay('Playing: Fixture A');
    expect(status.playShown).toBe(true);
    expect(settings.status).toBe('Playing: Fixture A');
    status.setPlay('Result: Fixture A');
    expect(status.playShown).toBe(true);
    status.set('Loaded 3 songs');
    expect(status.playShown).toBe(false);
    expect(record.mock.calls.map(([text]) => text)).toEqual([
      'Playing: Fixture A',
      'Result: Fixture A',
      'Loaded 3 songs',
    ]);
  });
});
