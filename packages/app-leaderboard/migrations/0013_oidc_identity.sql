CREATE TABLE oidc_identity (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  PRIMARY KEY (issuer, subject)
);
--> statement-breakpoint
ALTER TABLE user ADD COLUMN passkey_count INTEGER;
