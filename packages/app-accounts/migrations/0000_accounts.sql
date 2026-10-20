CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credential_id_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`is_anonymous` integer DEFAULT false,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TABLE "oauthClient" (id TEXT PRIMARY KEY NOT NULL, "clientId" TEXT NOT NULL UNIQUE, "clientSecret" TEXT, "clientDiscoveryId" TEXT, "disabled" INTEGER, "skipConsent" INTEGER, "enableEndSession" INTEGER, "subjectType" TEXT, "scopes" TEXT, "clientCredentialsScopes" TEXT, "userId" TEXT, "createdAt" INTEGER, "updatedAt" INTEGER, "name" TEXT, "uri" TEXT, "icon" TEXT, "contacts" TEXT, "tos" TEXT, "policy" TEXT, "softwareId" TEXT, "softwareVersion" TEXT, "softwareStatement" TEXT, "redirectUris" TEXT NOT NULL, "postLogoutRedirectUris" TEXT, "backchannelLogoutUri" TEXT, "backchannelLogoutSessionRequired" INTEGER, "tokenEndpointAuthMethod" TEXT, "applicationType" TEXT, "jwks" TEXT, "jwksUri" TEXT, "grantTypes" TEXT, "responseTypes" TEXT, "requirePKCE" INTEGER, "dpopBoundAccessTokens" INTEGER, "referenceId" TEXT, "metadata" TEXT);

--> statement-breakpoint
CREATE TABLE "oauthResource" (id TEXT PRIMARY KEY NOT NULL, "identifier" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "accessTokenTtl" INTEGER, "refreshTokenTtl" INTEGER, "signingAlgorithm" TEXT, "signingKeyId" TEXT, "allowedScopes" TEXT, "customClaims" TEXT, "dpopBoundAccessTokensRequired" INTEGER, "disabled" INTEGER, "createdAt" INTEGER, "updatedAt" INTEGER, "policyVersion" INTEGER, "metadata" TEXT);

--> statement-breakpoint
CREATE TABLE "oauthClientResource" (id TEXT PRIMARY KEY NOT NULL, "clientId" TEXT NOT NULL, "resourceId" TEXT NOT NULL, "metadata" TEXT, "createdAt" INTEGER);

--> statement-breakpoint
CREATE TABLE "oauthRefreshToken" (id TEXT PRIMARY KEY NOT NULL, "token" TEXT NOT NULL UNIQUE, "clientId" TEXT NOT NULL, "sessionId" TEXT, "userId" TEXT NOT NULL, "referenceId" TEXT, "authorizationCodeId" TEXT, "resources" TEXT, "requestedUserInfoClaims" TEXT, "expiresAt" INTEGER NOT NULL, "createdAt" INTEGER NOT NULL, "revoked" INTEGER, "rotatedAt" INTEGER, "rotationReplayResponse" TEXT, "rotationReplayExpiresAt" INTEGER, "authTime" INTEGER, "confirmation" TEXT, "scopes" TEXT NOT NULL);

--> statement-breakpoint
CREATE TABLE "oauthAccessToken" (id TEXT PRIMARY KEY NOT NULL, "token" TEXT NOT NULL UNIQUE, "clientId" TEXT NOT NULL, "sessionId" TEXT, "userId" TEXT, "referenceId" TEXT, "authorizationCodeId" TEXT, "resources" TEXT, "requestedUserInfoClaims" TEXT, "refreshId" TEXT, "expiresAt" INTEGER NOT NULL, "createdAt" INTEGER NOT NULL, "revoked" INTEGER, "confirmation" TEXT, "scopes" TEXT NOT NULL);

--> statement-breakpoint
CREATE TABLE "oauthConsent" (id TEXT PRIMARY KEY NOT NULL, "clientId" TEXT NOT NULL, "userId" TEXT, "referenceId" TEXT, "resources" TEXT, "requestedUserInfoClaims" TEXT, "scopes" TEXT NOT NULL, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL);

--> statement-breakpoint
CREATE TABLE "oauthClientAssertion" (id TEXT PRIMARY KEY NOT NULL, "expiresAt" INTEGER NOT NULL);

--> statement-breakpoint
CREATE TABLE "jwks" (id TEXT PRIMARY KEY NOT NULL, "publicKey" TEXT NOT NULL, "privateKey" TEXT NOT NULL, "createdAt" INTEGER NOT NULL, "expiresAt" INTEGER, "alg" TEXT, "crv" TEXT);

--> statement-breakpoint
CREATE TABLE identity_link (from_user_id TEXT PRIMARY KEY NOT NULL, to_user_id TEXT NOT NULL);
