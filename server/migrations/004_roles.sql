-- Roles: Super Admin (also manages admins), Admin (all workshops, teams and facilitators),
-- Facilitator (own workshops). Existing admins become Super Admins.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'super_admin' WHERE role = 'admin';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'facilitator'));

-- A password set by someone else (new account or reset) must be changed at the next sign-in.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- Co-facilitators: other staff who can run a workshop alongside its facilitator.
CREATE TABLE event_facilitators (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_facilitators_user ON event_facilitators (user_id);

-- "All teams represent" a country (ISO 3166-1 alpha-3): pre-fills each team's country.
ALTER TABLE events ADD COLUMN country_code text;
