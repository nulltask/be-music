export {};
// One-time expand/copy migration. Never prints rows, credentials, SQL dumps or tokens.
const preview = process.argv.includes('--preview');
const apply = process.argv.includes('--apply');
const accountId = '80d4b5fd75f07e61a637b6bb9774186e';
const source = preview ? '046723a8-244b-42ca-ad49-01c1914333f1' : '2cb01ebf-4a70-4582-bb38-4e2e925bff61';
const destination = preview ? '3fc82533-baf9-4e50-99dc-9fb38b80b0a7' : '4b5b02cc-a446-4026-b72d-4f973fc7a8fe';
const issuer = `https://accounts.${preview ? 'preview.' : ''}be-music.app/api/auth`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');
async function query(database: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = (await response.json()) as { success: boolean; result: { results: Record<string, unknown>[] }[] };
  if (!response.ok || !body.success) throw new Error(`D1 operation failed (${response.status}); no row data logged`);
  return body.result[0].results;
}
for (const table of ['user', 'account', 'passkey']) {
  const columns = (await query(destination, `PRAGMA table_info("${table}")`)).map((row) => String(row.name));
  const rows = await query(source, `SELECT ${columns.map((c) => `"${c}"`).join(',')} FROM "${table}"`);
  if (apply) {
    for (const row of rows) {
      await query(
        destination,
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO NOTHING`,
        columns.map((c) => row[c]),
      );
      const copied = await query(destination, `SELECT id FROM "${table}" WHERE id = ?`, [row.id]);
      if (copied.length !== 1) throw new Error('Identity copy verification failed');
      if (table === 'user') {
        const existing = await query(source, 'SELECT user_id FROM oidc_identity WHERE issuer = ? AND subject = ?', [
          issuer,
          row.id,
        ]);
        if (existing.length && existing[0].user_id !== row.id)
          throw new Error('Existing identity mapping conflicts; refusing to overwrite');
        await query(
          source,
          'INSERT INTO oidc_identity (issuer,subject,user_id) VALUES (?,?,?) ON CONFLICT DO NOTHING',
          [issuer, row.id, row.id],
        );
      }
    }
  }
  console.log(
    `${apply ? 'Verified' : 'Would copy'} ${table}: ${rows.length} rows (${preview ? 'preview' : 'production'})`,
  );
}
console.log('Source authentication tables retained for rollback; sessions and verification challenges are not copied.');
