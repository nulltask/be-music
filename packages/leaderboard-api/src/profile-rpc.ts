import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { syncAccountProfile } from './profile-sync.ts';

/** Bound only by Accounts. No public HTTP route accepts profile mutations. */
export class ProfileSync extends WorkerEntrypoint<Env> {
  async syncProfile(subject: string): Promise<void> {
    await syncAccountProfile(this.env, subject);
  }
}
