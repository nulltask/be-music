import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------------------------------------------------
// Better Auth (core tables, the anonymous plugin's `is_anonymous`, and the passkey plugin's table)
// ---------------------------------------------------------------------------------------------------------------------

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  isAnonymous: integer('is_anonymous', { mode: 'boolean' }).default(false),
  ...timestamps,
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
    transports: text('transports'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    aaguid: text('aaguid'),
  },
  (table) => [index('passkey_user_id_idx').on(table.userId), index('passkey_credential_id_idx').on(table.credentialID)],
);

// OAuth/JWT tables match the pinned Better Auth plugin schemas.
export const oauthClient = sqliteTable('oauthClient', {
  id: text('id').primaryKey(),
  clientId: text('clientId').notNull().unique(),
  clientSecret: text('clientSecret'),
  clientDiscoveryId: text('clientDiscoveryId'),
  disabled: integer('disabled', { mode: 'boolean' }),
  skipConsent: integer('skipConsent', { mode: 'boolean' }),
  enableEndSession: integer('enableEndSession', { mode: 'boolean' }),
  subjectType: text('subjectType'),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
  clientCredentialsScopes: text('clientCredentialsScopes', { mode: 'json' }).$type<string[]>(),
  userId: text('userId'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: text('contacts', { mode: 'json' }).$type<string[]>(),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('softwareId'),
  softwareVersion: text('softwareVersion'),
  softwareStatement: text('softwareStatement'),
  redirectUris: text('redirectUris', { mode: 'json' }).$type<string[]>().notNull(),
  postLogoutRedirectUris: text('postLogoutRedirectUris', { mode: 'json' }).$type<string[]>(),
  backchannelLogoutUri: text('backchannelLogoutUri'),
  backchannelLogoutSessionRequired: integer('backchannelLogoutSessionRequired', { mode: 'boolean' }),
  tokenEndpointAuthMethod: text('tokenEndpointAuthMethod'),
  applicationType: text('applicationType'),
  jwks: text('jwks'),
  jwksUri: text('jwksUri'),
  grantTypes: text('grantTypes', { mode: 'json' }).$type<string[]>(),
  responseTypes: text('responseTypes', { mode: 'json' }).$type<string[]>(),
  requirePKCE: integer('requirePKCE', { mode: 'boolean' }),
  dpopBoundAccessTokens: integer('dpopBoundAccessTokens', { mode: 'boolean' }),
  referenceId: text('referenceId'),
  metadata: text('metadata', { mode: 'json' }),
});
export const oauthResource = sqliteTable('oauthResource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('accessTokenTtl'),
  refreshTokenTtl: integer('refreshTokenTtl'),
  signingAlgorithm: text('signingAlgorithm'),
  signingKeyId: text('signingKeyId'),
  allowedScopes: text('allowedScopes', { mode: 'json' }).$type<string[]>(),
  customClaims: text('customClaims', { mode: 'json' }),
  dpopBoundAccessTokensRequired: integer('dpopBoundAccessTokensRequired', { mode: 'boolean' }),
  disabled: integer('disabled', { mode: 'boolean' }),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
  policyVersion: integer('policyVersion'),
  metadata: text('metadata', { mode: 'json' }),
});
export const oauthClientResource = sqliteTable('oauthClientResource', {
  id: text('id').primaryKey(),
  clientId: text('clientId').notNull(),
  resourceId: text('resourceId').notNull(),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
});
export const oauthRefreshToken = sqliteTable('oauthRefreshToken', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  clientId: text('clientId').notNull(),
  sessionId: text('sessionId'),
  userId: text('userId').notNull(),
  referenceId: text('referenceId'),
  authorizationCodeId: text('authorizationCodeId'),
  resources: text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: text('requestedUserInfoClaims', { mode: 'json' }).$type<string[]>(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  revoked: integer('revoked', { mode: 'timestamp_ms' }),
  rotatedAt: integer('rotatedAt', { mode: 'timestamp_ms' }),
  rotationReplayResponse: text('rotationReplayResponse'),
  rotationReplayExpiresAt: integer('rotationReplayExpiresAt', { mode: 'timestamp_ms' }),
  authTime: integer('authTime', { mode: 'timestamp_ms' }),
  confirmation: text('confirmation', { mode: 'json' }),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
});
export const oauthAccessToken = sqliteTable('oauthAccessToken', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  clientId: text('clientId').notNull(),
  sessionId: text('sessionId'),
  userId: text('userId'),
  referenceId: text('referenceId'),
  authorizationCodeId: text('authorizationCodeId'),
  resources: text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: text('requestedUserInfoClaims', { mode: 'json' }).$type<string[]>(),
  refreshId: text('refreshId'),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  revoked: integer('revoked', { mode: 'timestamp_ms' }),
  confirmation: text('confirmation', { mode: 'json' }),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
});
export const oauthConsent = sqliteTable('oauthConsent', {
  id: text('id').primaryKey(),
  clientId: text('clientId').notNull(),
  userId: text('userId'),
  referenceId: text('referenceId'),
  resources: text('resources', { mode: 'json' }).$type<string[]>(),
  requestedUserInfoClaims: text('requestedUserInfoClaims', { mode: 'json' }).$type<string[]>(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
export const oauthClientAssertion = sqliteTable('oauthClientAssertion', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
});
export const jwks = sqliteTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('publicKey').notNull(),
  privateKey: text('privateKey').notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }),
  alg: text('alg'),
  crv: text('crv'),
});

export const identityLink = sqliteTable('identity_link', {
  fromUserId: text('from_user_id').primaryKey(),
  toUserId: text('to_user_id').notNull(),
});

export const profile = sqliteTable('profile', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  /** R2 key of the uploaded icon (`avatars/{userId}/{sha256}.{ext}`); null shows the generated one. */
  avatarKey: text('avatar_key'),
  ...timestamps,
});

/**
 * Handles an account used before. They stay reserved for that account, and their URLs redirect to its current handle.
 */
export const handleHistory = sqliteTable(
  'handle_history',
  {
    handle: text('handle').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  // A player's former handles.
  (table) => [index('handle_history_user_idx').on(table.userId)],
);

export const profileSync = sqliteTable('profile_sync', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  revision: text('revision').notNull(),
});
