-- Sessions: a dated workshop or an open (ongoing) session, with one team or several.
-- Facilitators set each team up (a country, or any team name); teams join only with a
-- workshop code (pick their team) or a team code.
ALTER TABLE events ADD COLUMN kind text NOT NULL DEFAULT 'workshop' CHECK (kind IN ('workshop', 'open'));
ALTER TABLE events ADD COLUMN scope text NOT NULL DEFAULT 'multi' CHECK (scope IN ('single', 'multi'));
