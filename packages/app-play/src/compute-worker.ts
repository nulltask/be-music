import { collectWorkerTransferables } from './worker-transferables.ts';
import { executeBrowserTask } from '@be-music/player-browser/compute';
import { prepareLeaderboardSubmission, prepareCourseLeaderboardSubmission } from './leaderboard.ts';

type Single = Parameters<typeof prepareLeaderboardSubmission>;
type Course = Parameters<typeof prepareCourseLeaderboardSubmission>;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = (event) => {
  const { id, name, input } = event.data as { id: number; name: string; input: unknown };
  void (async () => {
    switch (name) {
      case 'submission':
        return prepareLeaderboardSubmission(...(input as Single));
      case 'course-submission':
        return prepareCourseLeaderboardSubmission(...(input as Course));
      case 'gzip-json':
        return new Uint8Array(
          await new Response(
            new Blob([JSON.stringify(input)]).stream().pipeThrough(new CompressionStream('gzip')),
          ).arrayBuffer(),
        );
      default:
        return executeBrowserTask(name, input);
    }
  })()
    .then((value) => scope.postMessage({ id, value }, collectWorkerTransferables(value)))
    .catch((error: unknown) =>
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []),
    );
};
