import type { MiddlewareHandler } from 'hono';

/** Database calls a request made and the time spent waiting on them (summed: calls made in parallel overlap). */
export interface QueryTally {
  count: number;
  ms: number;
}

const TERMINAL_METHODS = new Set<PropertyKey>(['first', 'all', 'run', 'raw']);

/**
 * Wraps a D1 binding so every call that reaches the database is counted and timed into `tally`: a statement's
 * `first` / `all` / `run` / `raw`, and `batch` / `exec`, which each take one round trip. `batch` is handed the
 * statements the binding prepared, not their wrappers, since D1 checks what it gets.
 */
export function instrumentD1(
  d1: D1Database,
  tally: QueryTally,
  now: () => number = () => performance.now(),
): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  const timed = async <T>(call: () => Promise<T>): Promise<T> => {
    const startedAt = now();
    try {
      return await call();
    } finally {
      tally.count += 1;
      tally.ms += now() - startedAt;
    }
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (key === 'bind') {
          return (...args: unknown[]) => wrapStatement(value.apply(target, args) as D1PreparedStatement);
        }
        if (TERMINAL_METHODS.has(key)) {
          return (...args: unknown[]) => timed(() => value.apply(target, args) as Promise<unknown>);
        }
        return value.bind(target);
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  return new Proxy(d1, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (key === 'prepare') {
        return (query: string) => wrapStatement(value.call(target, query) as D1PreparedStatement);
      }
      if (key === 'batch') {
        return (statements: D1PreparedStatement[]) =>
          timed(
            () =>
              value.call(
                target,
                statements.map((statement) => originals.get(statement) ?? statement),
              ) as Promise<unknown>,
          );
      }
      if (key === 'exec') {
        return (query: string) => timed(() => value.call(target, query) as Promise<unknown>);
      }
      return value.bind(target);
    },
  });
}

/** The `Server-Timing` value for a request: its database calls and the whole handler. */
export function formatServerTiming(tally: QueryTally, totalMs: number): string {
  const queries = `${tally.count} quer${tally.count === 1 ? 'y' : 'ies'}`;
  return `db;dur=${tally.ms.toFixed(1)};desc="${queries}", total;dur=${totalMs.toFixed(1)}`;
}

/**
 * Times each request and its database calls into a `Server-Timing` header, so slow pages show where their time goes
 * (the browser's network panel reads it). The request gets its own instrumented copy of the bindings: the `env`
 * object is shared by every request the isolate serves.
 */
export function serverTiming<E extends { Bindings: { DB: D1Database } }>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const startedAt = performance.now();
    const tally: QueryTally = { count: 0, ms: 0 };
    c.env = { ...c.env, DB: instrumentD1(c.env.DB, tally) };
    await next();
    c.res.headers.append('server-timing', formatServerTiming(tally, performance.now() - startedAt));
  };
}
