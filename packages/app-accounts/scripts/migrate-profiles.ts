export {};
// Copies profile ownership by the existing OIDC identity mapping, never by email. Logs counts only.
const preview = process.argv.includes('--preview');
const apply = process.argv.includes('--apply');
const project = process.argv.includes('--project');
const accountId = '80d4b5fd75f07e61a637b6bb9774186e';
const source = preview ? '046723a8-244b-42ca-ad49-01c1914333f1' : '2cb01ebf-4a70-4582-bb38-4e2e925bff61';
const destination = preview ? '3fc82533-baf9-4e50-99dc-9fb38b80b0a7' : '4b5b02cc-a446-4026-b72d-4f973fc7a8fe';
const origin = `https://accounts.${preview ? 'preview.' : ''}be-music.app`;
const issuer = origin + '/api/auth';
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
  const data = (await response.json()) as { success: boolean; result: { results: Record<string, unknown>[] }[] };
  if (!response.ok || !data.success) throw new Error(`D1 operation failed (${response.status}); no row data logged`);
  return data.result[0].results;
}
const profiles = await query(source, 'SELECT * FROM profile');
for (const row of profiles) {
  const mappings = await query(source, 'SELECT subject FROM oidc_identity WHERE issuer = ? AND user_id = ?', [
    issuer,
    row.user_id,
  ]);
  if (mappings.length !== 1) throw new Error('Profile needs an unambiguous Accounts identity; refusing data loss');
  const subject = mappings[0].subject;
  if ((await query(destination, 'SELECT id FROM user WHERE id = ?', [subject])).length !== 1)
    throw new Error('Accounts user missing');
  const existing = await query(destination, 'SELECT * FROM profile WHERE user_id = ?', [subject]);
  if (existing.length && (existing[0].handle !== row.handle || existing[0].display_name !== row.display_name))
    throw new Error('Profile already edited in Accounts; refusing to overwrite');
  if (apply && !project) {
    await query(
      destination,
      'INSERT INTO profile (user_id,handle,display_name,avatar_key,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING',
      [
        subject,
        row.handle,
        row.display_name,
        typeof row.avatar_key === 'string' && !row.avatar_key.startsWith('https://') ? row.avatar_key : null,
        row.created_at,
        row.updated_at,
      ],
    );
    for (const history of await query(source, 'SELECT handle,created_at FROM handle_history WHERE user_id = ?', [
      row.user_id,
    ]))
      await query(
        destination,
        'INSERT INTO handle_history (handle,user_id,created_at) VALUES (?,?,?) ON CONFLICT(handle) DO NOTHING',
        [history.handle, subject, history.created_at],
      );
    await query(destination, 'UPDATE user SET name = ? WHERE id = ?', [row.display_name, subject]);
    const copied = await query(destination, 'SELECT handle,display_name,avatar_key FROM profile WHERE user_id = ?', [
      subject,
    ]);
    if (
      copied[0]?.handle !== row.handle ||
      copied[0]?.display_name !== row.display_name ||
      copied[0]?.avatar_key !== row.avatar_key
    )
      throw new Error('Profile copy verification failed');
  }
  if (apply && project) {
    if (!existing.length) throw new Error('Copy profiles before projecting');
    const key = existing[0].avatar_key;
    const version = typeof key === 'string' ? (/\/([0-9a-f]{16})[0-9a-f]*\.\w+$/.exec(key)?.[1] ?? 'u') : 'g';
    const avatarURL = `${origin}/profiles/${encodeURIComponent(String(row.handle))}/avatar?v=${version}`;
    await query(source, 'UPDATE profile SET avatar_key = ? WHERE user_id = ?', [avatarURL, row.user_id]);
  }
}
// Verify migrated credentials before allowing the separate legacy-data cleanup migration.
for (const key of await query(source, 'SELECT credential_id FROM passkey')) {
  if ((await query(destination, 'SELECT id FROM passkey WHERE credential_id = ?', [key.credential_id])).length !== 1)
    throw new Error('Passkey not yet migrated; do not clear legacy auth');
}
console.log(
  `${apply ? 'Verified' : 'Would copy'} ${profiles.length} profiles (${preview ? 'preview' : 'production'}${project ? ', projection' : ''})`,
);
