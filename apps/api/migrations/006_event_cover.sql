ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_url text;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_cover_url_length;

ALTER TABLE events
  ADD CONSTRAINT events_cover_url_length
  CHECK (cover_url IS NULL OR length(cover_url) <= 500);
