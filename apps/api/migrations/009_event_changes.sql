ALTER TABLE events
  ADD COLUMN change_count integer NOT NULL DEFAULT 0
  CHECK (change_count >= 0 AND change_count <= 3);

CREATE TABLE event_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  summary varchar(80) NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 80),
  change_number integer NOT NULL CHECK (change_number BETWEEN 1 AND 3),
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, change_number)
);

CREATE INDEX event_changes_event_created_idx
  ON event_changes (event_id, change_number DESC);
