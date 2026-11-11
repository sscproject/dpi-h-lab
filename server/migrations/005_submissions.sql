-- Submit (Summary step): each submission keeps a dated copy of the team's answers and the
-- team's sharing choice, so a country's progress can be compared across submissions.
CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by text,
  -- Ticked "I consent to share our country's DPI-H snapshot".
  share boolean NOT NULL,
  country_code text,
  content_version text,
  worksheet jsonb NOT NULL
);
CREATE INDEX submissions_group ON submissions (group_id, submitted_at DESC);

-- The latest submission, for dashboards and the Teams list.
ALTER TABLE groups ADD COLUMN submitted_at timestamptz;
