import { collectWorkerTransferables } from './worker-transferables.ts';
import { executeBrowserTask } from '@be-music/player-browser/compute';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = (event) => {
  const { id, name, input } = event.data as { id: number; name: string; input: unknown };
  void (async () => {
    return executeBrowserTask(name, input);
  })()
    .then((value) => scope.postMessage({ id, value }, collectWorkerTransferables(value)))
    .catch((error: unknown) =>
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []),
    );
};
