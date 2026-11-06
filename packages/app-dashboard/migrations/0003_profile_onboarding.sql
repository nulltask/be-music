-- When the player finished (or skipped) the welcome after signing up; null shows it on the next visit. Profiles that
-- exist already count as onboarded, so only accounts made from now on see it.
ALTER TABLE profile ADD COLUMN onboarded_at INTEGER;
--> statement-breakpoint
UPDATE profile SET onboarded_at = updated_at;
