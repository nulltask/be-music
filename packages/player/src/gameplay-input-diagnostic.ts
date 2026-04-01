import { createPlayerInputSignalBus } from './core/input-signal-bus.ts';
import { createInputTokenToChannelsMap, createLaneBindings } from './manual-input.ts';
import { createNodeInputRuntime } from './node/node-input-runtime.ts';

let sequence = 0;

main();

function main(): void {
  const laneBindings = createLaneBindings(['11', '12', '13', '14', '15', '16', '18', '19'], {
    platform: process.platform,
  });
  const inputSignals = createPlayerInputSignalBus();
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  const runtime = createNodeInputRuntime({
    mode: 'manual',
    inputSignals,
    inputTokenToChannels,
  });

  process.stdout.write(
    'Gameplay input diagnostics started. Press keys to inspect runtime commands. Press Ctrl+C to exit.\n',
  );
  emitRecord({
    kind: 'bindings',
    bindings: laneBindings.map((binding) => ({
      channel: binding.channel,
      keyLabel: binding.keyLabel,
      inputTokens: binding.inputTokens,
      isScratch: binding.isScratch,
    })),
  });

  runtime.start();

  const interval = setInterval(() => {
    for (const command of inputSignals.drainCommands()) {
      emitRecord(command);
      if (command.kind === 'interrupt' && command.reason === 'ctrl-c') {
        clearInterval(interval);
        runtime.stop();
        process.exit(0);
      }
    }
  }, 16);

  const stopOnExit = (): void => {
    clearInterval(interval);
    runtime.stop();
  };

  process.once('exit', stopOnExit);
}

function emitRecord(payload: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({
      sequence: sequence++,
      at: new Date().toISOString(),
      ...payload,
    })}\n`,
  );
}
