import { yieldToTask } from './yield.ts';

/** A bounded, lazy pool shared by loading, audio preparation, and submission tasks. */
export interface TaskWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
interface Job {
  id: number;
  name: string;
  input: unknown;
  fallback: () => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}
interface Slot {
  worker: TaskWorker;
  job?: Job;
}
export class BrowserTaskPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private localJobs = new Set<Job>();
  private unavailable = false;
  private closed = false;
  private size: number;
  private factory: (() => TaskWorker) | undefined;
  public constructor(size: number, factory?: () => TaskWorker) {
    this.size = size;
    this.factory = factory;
  }
  public resize(size: number): void {
    this.size = size;
    this.trim();
    this.drain();
  }
  public run<T>(name: string, input: unknown, fallback: () => T | Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Worker pool is closed'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, name, input, fallback, resolve: (value) => resolve(value as T), reject });
      this.drain();
    });
  }
  public dispose(): void {
    this.closed = true;
    const error = new Error('Worker pool is closed');
    for (const slot of this.slots) {
      slot.worker.terminate();
      slot.job?.reject(error);
    }
    for (const job of this.queue) job.reject(error);
    for (const job of this.localJobs) job.reject(error);
    this.localJobs.clear();
    this.slots = [];
    this.queue = [];
  }
  private trim(): void {
    for (let i = this.slots.length - 1; i >= 0 && this.slots.length > this.size; i--) {
      const slot = this.slots[i]!;
      if (!slot.job) {
        slot.worker.terminate();
        this.slots.splice(i, 1);
      }
    }
  }
  private create(): Slot | undefined {
    if (!this.factory || this.unavailable) return undefined;
    try {
      const slot: Slot = { worker: this.factory() };
      slot.worker.onmessage = (event) => {
        const result = event.data as { id: number; value?: unknown; error?: string };
        const job = slot.job;
        if (!job || result.id !== job.id) return;
        slot.job = undefined;
        if (result.error !== undefined) job.reject(new Error(result.error));
        else job.resolve(result.value);
        this.trim();
        this.drain();
      };
      const failed = () => {
        // Infrastructure failures use the untouched input locally. Task errors arrive as messages instead.
        const job = slot.job;
        slot.job = undefined;
        slot.worker.terminate();
        this.slots = this.slots.filter((value) => value !== slot);
        this.unavailable = true;
        if (job) this.local(job);
        this.drain();
      };
      slot.worker.onerror = failed;
      slot.worker.onmessageerror = failed;
      this.slots.push(slot);
      return slot;
    } catch {
      this.unavailable = true;
      return undefined;
    }
  }
  private local(job: Job): void {
    // Yield before the fallback so a loading indicator can paint, including in non-Worker hosts.
    this.localJobs.add(job);
    void yieldToTask()
      .then(() => {
        if (this.closed) throw new Error('Worker pool is closed');
        return job.fallback();
      })
      .then(
        (value) => {
          this.localJobs.delete(job);
          job.resolve(value);
        },
        (error) => {
          this.localJobs.delete(job);
          job.reject(error);
        },
      );
  }
  private drain(): void {
    while (this.queue.length) {
      let slot = this.slots.find((value) => !value.job);
      if (!slot && this.slots.length < this.size) slot = this.create();
      if (!slot) {
        if (!this.factory || this.unavailable) {
          this.local(this.queue.shift()!);
          continue;
        }
        return;
      }
      const job = this.queue.shift()!;
      slot.job = job;
      try {
        slot.worker.postMessage({ id: job.id, name: job.name, input: job.input });
      } catch (error) {
        slot.job = undefined;
        job.reject(error);
      }
    }
  }
}
