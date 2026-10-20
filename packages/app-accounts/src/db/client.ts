import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../schema.ts';

export type Database = DrizzleD1Database<typeof schema>;

export function openDatabase(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
