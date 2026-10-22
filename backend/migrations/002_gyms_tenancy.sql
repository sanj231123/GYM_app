-- 002 — multi-tenancy: gyms table + gym_id on every domain table.
-- All columns are added nullable: existing data stays valid; a later
-- migration flips NOT NULL after every row has a gym_id.

CREATE TABLE IF NOT EXISTS gyms (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,                 -- subdomain label + /g/:slug fallback
  name TEXT NOT NULL,
  owner_user_id INT,                         -- set after the owning user exists (no FK: gyms<->users are mutual)
  status TEXT NOT NULL DEFAULT 'active',     -- trial | active | suspended
  trial_ends_at TIMESTAMPTZ,
  paid_until TIMESTAMPTZ,
  logo TEXT,
  primary_color TEXT,
  address TEXT,
  phone TEXT,
  hours TEXT,
  map_url TEXT,
  razorpay_key_id TEXT,                      -- per-tenant keys (env used as fallback)
  razorpay_key_secret TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plans         ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE trainers      ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE users         ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE payments      ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE attendance    ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE inquiries     ADD COLUMN IF NOT EXISTS gym_id INT REFERENCES gyms(id) ON DELETE CASCADE;

-- Email uniqueness becomes per-gym: two different gyms may both have a
-- member with the same email. Legacy rows (gym_id NULL) keep working.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key') THEN
    ALTER TABLE users DROP CONSTRAINT users_email_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_gym_email_key ON users (gym_id, email);

CREATE INDEX IF NOT EXISTS idx_gym_users          ON users(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_plans          ON plans(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_trainers       ON trainers(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_payments       ON payments(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_attendance     ON attendance(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_notifications  ON notifications(gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_inquiries      ON inquiries(gym_id);