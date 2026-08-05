CREATE INDEX registrations_user_updated_idx
  ON registrations (user_id, updated_at DESC);
