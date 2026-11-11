-- A team code can be replaced (leaked or lost). Team sign-ins carry the code generation,
-- so sign-ins made with an old code stop working when the facilitator issues a new one.
ALTER TABLE groups ADD COLUMN code_gen integer NOT NULL DEFAULT 0;
