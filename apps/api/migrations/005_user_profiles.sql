CREATE TABLE user_profiles (
  id uuid PRIMARY KEY,
  nickname varchar(100),
  avatar_url varchar(500),
  gender smallint CHECK (gender IS NULL OR gender BETWEEN 0 AND 2),
  country varchar(100),
  province varchar(100),
  city varchar(100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
