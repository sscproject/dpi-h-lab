-- Practice groups ("Just exploring"): not joinable by code, never linked to an event,
-- left out of exports, and deleted 24 hours after they are created.
ALTER TABLE groups ADD COLUMN practice boolean NOT NULL DEFAULT false;
