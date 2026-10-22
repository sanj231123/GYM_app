-- Jaini Fitness Center — PostgreSQL database schema
-- Use this file to create the database on any cloud (AWS RDS, Azure DB, K8s Postgres, etc.)
-- Run: psql "$DATABASE_URL" -f schema.sql

-- Membership plans (Monthly / Quarterly / Yearly ...)
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration_days INT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  specialty TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Members (role='member') and the admin (role='admin') live here
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  plan_id INT REFERENCES plans(id) ON DELETE SET NULL,
  trainer_id INT REFERENCES trainers(id) ON DELETE SET NULL,
  join_date DATE,
  expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  photo TEXT  -- member photo as dataURL (base64), max 2MB
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT, -- cash / upi / card
  note TEXT,
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages sent to members (email / whatsapp), with delivery status
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT,
  dest TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,  -- sent / failed / ready / skipped
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Membership inquiries from the website contact form
CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  pin_code TEXT,
  plan_id INT,          -- chosen plan (attached in the join flow)
  pay_mode TEXT,        -- 'online' (Razorpay) or 'gym' (pay at the gym)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes used by the app's dashboard / reports queries
CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_time ON attendance(checkin_at);
CREATE INDEX IF NOT EXISTS idx_users_role      ON users(role);

-- Default seed data (same rows the app creates on first run)
INSERT INTO plans (name, duration_days, price) VALUES
  ('Monthly',   30,  1500),
  ('Quarterly', 90,  4000),
  ('Yearly',   365, 15000)
ON CONFLICT DO NOTHING;