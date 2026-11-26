// Runs the latency jig and saves its log (docs/latency-jig.md):
// `node scripts/latency-jig/capture.ts <serial device> <out.csv> [presses] [minGapMs] [maxGapMs]`.
// Sends `run` to the jig, echoes and saves every line until `# done`, and sends `stop` on Ctrl+C.
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The command that starts a run with these arguments (the jig keeps its own value for each one left out). */
export function jigRunCommand(args: readonly string[]): string {
  for (const arg of args) {
    if (!/^\d+$/.test(arg)) throw new Error(`not a whole number: ${arg}`);
  }
  return ['run', ...args].join(' ') + '\n';
}

/** Whether `line` ends a run: `# done ...`, or an error that stops it. */
export function endsJigRun(line: string): boolean {
  return /^#\s*done\b/.test(line) || /^#\s*error:/.test(line);
}

/**
 * The `stty` arguments that put `device` in raw mode without echo, so the terminal driver neither echoes the jig's
 * lines back to it nor waits for whole lines. macOS's `stty` names the device with `-f`, Linux's with `-F`.
 */
export function rawModeArgs(platform: NodeJS.Platform, device: string): string[] {
  return [platform === 'darwin' ? '-f' : '-F', device, 'raw', '-echo'];
}

/** Splits `chunk` into complete lines, carrying a partial last line in `rest`. */
export function splitJigLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (rest + chunk).split(/\r?\n/);
  return { lines: parts.slice(0, -1), rest: parts.at(-1) ?? '' };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [device, outFile, ...runArgs] = process.argv.slice(2);
  if (device === undefined || outFile === undefined) {
    console.error(
      'usage: node scripts/latency-jig/capture.ts <serial device> <out.csv> [presses] [minGapMs] [maxGapMs]',
    );
    process.exit(1);
  }
  const command = jigRunCommand(runArgs);
  // USB CDC ignores the baud rate, so the device opens as a plain file for reading and writing.
  const handle = await open(device, 'r+');
  // Set while the device is open: some systems reset a serial port's settings when its last user closes it.
  await promisify(execFile)('stty', rawModeArgs(process.platform, device));
  const out = createWriteStream(outFile);
  const input = handle.createReadStream({ encoding: 'utf8', autoClose: false });
  let rest = '';
  let finished = false;
  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    input.destroy();
    out.end();
    await handle.close();
  };
  process.on('SIGINT', () => {
    void handle.write('stop\n');
  });
  input.on('data', (chunk) => {
    const split = splitJigLines(rest, String(chunk));
    rest = split.rest;
    for (const line of split.lines) {
      out.write(line + '\n');
      console.log(line);
      if (endsJigRun(line)) void finish();
    }
  });
  await handle.write(command);
  console.error(`sent: ${command.trim()} (Ctrl+C stops the run)`);
}
