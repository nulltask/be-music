// isoworker has bundled .d.ts, but package exports do not expose them for TS moduleResolution.
// @ts-expect-error upstream package export map typing issue
import { workerize as workerizeUntyped } from 'isoworker';
import { isSea } from 'node:sea';
import { createAbortError, throwIfAborted } from './abort.ts';

type AnyFunction = (...args: any[]) => any;

export type WorkerizedFunction<T extends AnyFunction> = ((
  ...args: [...Parameters<T>, callback: (error: unknown, result: Awaited<ReturnType<T>>) => void]
) => void) & { close: () => void };

export interface WorkerizeFunction {
  <T extends AnyFunction>(
    fn: T,
    dependencies: () => unknown[],
    serializeArgumentsAndReturnValues?: boolean,
  ): WorkerizedFunction<T>;
}

export interface InvokeWorkerizedFunctionOptions {
  signal?: AbortSignal;
  onAbort?: () => void;
}

function createInlineWorkerizedFunction<T extends AnyFunction>(fn: T): WorkerizedFunction<T> {
  return Object.assign(
    (...args: [...Parameters<T>, callback: (error: unknown, result: Awaited<ReturnType<T>>) => void]) => {
      const callback = args[args.length - 1] as (error: unknown, result: Awaited<ReturnType<T>>) => void;
      const fnArgs = args.slice(0, -1) as Parameters<T>;
      Promise.resolve()
        .then(() => fn(...fnArgs))
        .then(
          (result) => {
            callback(undefined, result as Awaited<ReturnType<T>>);
          },
          (error: unknown) => {
            callback(error, undefined as Awaited<ReturnType<T>>);
          },
        );
    },
    {
      close: () => {},
    },
  );
}

export const workerize: WorkerizeFunction = (<T extends AnyFunction>(
  fn: T,
  dependencies: () => unknown[],
  serializeArgumentsAndReturnValues?: boolean,
) => {
  if (isSea()) {
    return createInlineWorkerizedFunction(fn);
  }
  return workerizeUntyped(fn, dependencies, serializeArgumentsAndReturnValues) as WorkerizedFunction<T>;
}) satisfies WorkerizeFunction;

export async function invokeWorkerizedFunction<TArgs extends unknown[], TResult>(
  worker: ((...args: [...TArgs, callback: (error: unknown, result: TResult) => void]) => void) & { close: () => void },
  args: TArgs,
  options: InvokeWorkerizedFunctionOptions = {},
): Promise<TResult> {
  throwIfAborted(options.signal);
  if (!options.signal && !options.onAbort) {
    return new Promise<TResult>((resolve, reject) => {
      worker(...args, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }
  return new Promise<TResult>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      options.onAbort?.();
      reject(createAbortError());
    };
    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (settled) {
      return;
    }
    worker(...args, (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}
