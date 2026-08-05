ALTER TABLE roadbooks
  ADD COLUMN IF NOT EXISTS elevation_profile jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_gradient numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE roadbooks
  ADD CONSTRAINT roadbooks_max_gradient_range
  CHECK (max_gradient >= 0 AND max_gradient <= 100);
