import { describe, expect, test } from 'vite-plus/test';
import { endsJigRun, jigRunCommand, rawModeArgs, splitJigLines } from './capture.ts';

describe('jigRunCommand', () => {
  test('passes the whole-number arguments through', () => {
    expect(jigRunCommand([])).toBe('run\n');
    expect(jigRunCommand(['300', '250', '600'])).toBe('run 300 250 600\n');
  });

  test('rejects anything else', () => {
    expect(() => jigRunCommand(['3.5'])).toThrow('not a whole number: 3.5');
    expect(() => jigRunCommand(['10;stop'])).toThrow();
  });
});

describe('endsJigRun', () => {
  test('ends on done or an error, not on other comments or results', () => {
    expect(endsJigRun('# done timed=300 timeouts=0 noisy=0')).toBe(true);
    expect(endsJigRun('# error: the host did not take the key report')).toBe(true);
    expect(endsJigRun('# run presses=300')).toBe(false);
    expect(endsJigRun('P,1,0,0,0,0,0,0,0')).toBe(false);
  });
});

describe('rawModeArgs', () => {
  test('names the device the way each stty expects', () => {
    expect(rawModeArgs('darwin', '/dev/cu.usbmodem1101')).toEqual(['-f', '/dev/cu.usbmodem1101', 'raw', '-echo']);
    expect(rawModeArgs('linux', '/dev/ttyACM0')).toEqual(['-F', '/dev/ttyACM0', 'raw', '-echo']);
  });
});

describe('splitJigLines', () => {
  test('carries a partial line into the next chunk', () => {
    const first = splitJigLines('', '# run presses=2\r\nP,1,0,');
    expect(first).toEqual({ lines: ['# run presses=2'], rest: 'P,1,0,' });
    expect(splitJigLines(first.rest, '1,2\n')).toEqual({ lines: ['P,1,0,1,2'], rest: '' });
  });
});
