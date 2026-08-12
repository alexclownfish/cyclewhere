ALTER TABLE events
  ADD COLUMN meeting_latitude double precision,
  ADD COLUMN meeting_longitude double precision,
  ADD CONSTRAINT events_meeting_location_pair CHECK (
    (meeting_latitude IS NULL AND meeting_longitude IS NULL)
    OR
    (meeting_latitude IS NOT NULL AND meeting_longitude IS NOT NULL
      AND meeting_latitude BETWEEN -90 AND 90
      AND meeting_longitude BETWEEN -180 AND 180)
  );
