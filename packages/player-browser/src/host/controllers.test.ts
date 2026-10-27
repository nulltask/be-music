import { expect, it, vi } from 'vite-plus/test';
import { createSelectController } from './controllers.ts';
import { createAudioService } from '../runtime/audio-service.ts';
import { makeChart, makeCollection } from '../session/select/test-support.ts';

it('browses and starts a chart without a Canvas, Pixi host or global key listener', () => {
  const start = vi.fn();
  const controller = createSelectController({
    library: makeCollection([makeChart('First', 'pack'), makeChart('Second', 'pack')]),
    audio: createAudioService({ createContext: () => undefined }),
    sounds: {},
    on: { start },
    now: () => 0,
  });
  controller.enter(0);
  controller.advance(0);
  controller.dispatch({ type: 'browse', command: { type: 'search', text: 'Second' } });
  controller.advance(1);
  expect(controller.getSnapshot()?.entries).toHaveLength(1);
  controller.dispatch({ type: 'start', autoPlay: true });
  controller.advance(2);
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'chart', chart: expect.objectContaining({ title: 'Second' }) }),
    { autoPlay: true },
  );
  controller.dispose();
});
