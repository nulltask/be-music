-- Accounts owns authentication. Keep local player IDs and all score/profile references.
DELETE FROM session;
--> statement-breakpoint
DELETE FROM verification;
--> statement-breakpoint
DELETE FROM account;
--> statement-breakpoint
DELETE FROM passkey;
--> statement-breakpoint
UPDATE user SET name = COALESCE((SELECT display_name FROM profile WHERE profile.user_id = user.id), 'Player'), email = id || '@identity.invalid', email_verified = 0, image = NULL;
