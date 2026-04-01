import readline from 'node:readline';

export interface RawInputCapture {
  stdin: NodeJS.ReadStream & { isRaw?: boolean };
  restore: () => void;
}

interface SharedRawInputCaptureState {
  stdin: NodeJS.ReadStream & { isRaw?: boolean };
  wasRawMode: boolean;
  refCount: number;
}

let sharedRawInputCaptureState: SharedRawInputCaptureState | undefined;

export function beginSharedRawInputCapture(options: {
  forceResetRawMode?: boolean;
} = {}): RawInputCapture {
  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  if (!stdin.isTTY) {
    return {
      stdin,
      restore: () => undefined,
    };
  }

  if (!sharedRawInputCaptureState) {
    sharedRawInputCaptureState = {
      stdin,
      wasRawMode: Boolean(stdin.isRaw),
      refCount: 0,
    };
    readline.emitKeypressEvents(process.stdin);
    if (options.forceResetRawMode && stdin.isRaw) {
      stdin.setRawMode(false);
    }
    stdin.setRawMode(true);
    stdin.resume();
  }

  sharedRawInputCaptureState.refCount += 1;
  let restored = false;

  return {
    stdin,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      const activeState = sharedRawInputCaptureState;
      if (!activeState) {
        return;
      }
      activeState.refCount -= 1;
      if (activeState.refCount > 0) {
        return;
      }
      activeState.stdin.setRawMode(activeState.wasRawMode);
      sharedRawInputCaptureState = undefined;
    },
  };
}
