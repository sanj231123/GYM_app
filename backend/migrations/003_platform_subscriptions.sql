-- platform fee subscriptions: tracks the Razorpay subscription of each gym's
-- monthly platform fee (the fee that keeps them active)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS subscription_status TEXT;