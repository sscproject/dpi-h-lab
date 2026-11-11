-- M3: in-app staff passwords, event groups, time controls.

-- Staff sign in with a password set in the app (decision D1): scrypt hash, never the password.
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

-- A group closed because its event closed reopens with the event (SPEC §4.1).
ALTER TABLE groups ADD COLUMN closed_by_event boolean NOT NULL DEFAULT false;
-- Order of groups within an event (the facilitator's list order).
ALTER TABLE groups ADD COLUMN sort integer NOT NULL DEFAULT 0;

CREATE INDEX groups_state_ends_at ON groups (state, ends_at);
CREATE INDEX events_state_ends_at ON events (state, ends_at);
CREATE INDEX events_facilitator ON events (facilitator_id);
