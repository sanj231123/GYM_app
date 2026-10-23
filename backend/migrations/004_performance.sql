-- 004: performance hardening for high concurrency
-- composite indexes for the dashboard/analytics hot paths
CREATE INDEX IF NOT EXISTS idx_payments_gym_paid     ON payments(gym_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_users_gym_expiry      ON users(gym_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_attendance_user_time  ON attendance(user_id, checkin_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_gym_time   ON attendance(gym_id, checkin_at DESC);