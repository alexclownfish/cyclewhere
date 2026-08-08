CREATE TABLE IF NOT EXISTS user_phone_bindings (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  phone_hash char(64) NOT NULL UNIQUE,
  phone_encrypted text NOT NULL,
  phone_masked varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_phone_bindings_phone_hash_idx ON user_phone_bindings(phone_hash);
