import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes SQL migrations here; `cf d1 migrations apply` applies them (see package.json).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
