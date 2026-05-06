import { clearImmediate, setImmediate } from 'node:timers';

export interface DeferredUiFlushState {
  frame: boolean;
  commands: boolean;
}

export interface DeferredUiFlush {
  markFrameDirty: () => void;
  markCommandsDirty: () => void;
  dispose: () => void;
}

export function createDeferredUiFlush(flush: (state: Readonly<DeferredUiFlushState>) => void): DeferredUiFlush {
  let framePending = false;
  let commandsPending = false;
  let disposed = false;
  let handle: ReturnType<typeof setImmediate> | undefined;

  const run = (): void => {
    handle = undefined;
    if (disposed) {
      return;
    }

    const pendingState: DeferredUiFlushState = {
      frame: framePending,
      commands: commandsPending,
    };
    framePending = false;
    commandsPending = false;

    if (!pendingState.frame && !pendingState.commands) {
      return;
    }

    flush(pendingState);

    if (!disposed && (framePending || commandsPending) && handle === undefined) {
      handle = setImmediate(run);
    }
  };

  const schedule = (): void => {
    if (disposed || handle !== undefined) {
      return;
    }
    handle = setImmediate(run);
  };

  return {
    markFrameDirty: () => {
      framePending = true;
      schedule();
    },
    markCommandsDirty: () => {
      commandsPending = true;
      schedule();
    },
    dispose: () => {
      disposed = true;
      if (handle !== undefined) {
        clearImmediate(handle);
        handle = undefined;
      }
    },
  };
}
