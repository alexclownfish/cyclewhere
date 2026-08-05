CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE event_status AS ENUM ('draft', 'published', 'full', 'completed', 'cancelled');
CREATE TYPE registration_status AS ENUM ('active', 'cancelled');
CREATE TYPE difficulty_level AS ENUM ('easy', 'moderate', 'challenging', 'expert');

CREATE TABLE roadbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  description varchar(1000) NOT NULL,
  distance_km numeric(7,2) NOT NULL CHECK (distance_km > 0),
  elevation_gain_m integer NOT NULL CHECK (elevation_gain_m >= 0),
  estimated_minutes integer NOT NULL CHECK (estimated_minutes > 0),
  difficulty difficulty_level NOT NULL,
  region varchar(100) NOT NULL,
  coordinate_system varchar(10) NOT NULL DEFAULT 'WGS84' CHECK (coordinate_system = 'WGS84'),
  track geography(LINESTRING, 4326) NOT NULL,
  elevation_profile jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_gradient numeric(5,2) NOT NULL DEFAULT 0 CHECK (max_gradient >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roadbook_waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadbook_id uuid NOT NULL REFERENCES roadbooks(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  waypoint_type varchar(20) NOT NULL CHECK (waypoint_type IN ('start', 'finish', 'water', 'supply', 'danger', 'viewpoint')),
  location geography(POINT, 4326) NOT NULL,
  distance_km numeric(7,2) NOT NULL CHECK (distance_km >= 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  UNIQUE (roadbook_id, sort_order)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL,
  roadbook_id uuid REFERENCES roadbooks(id) ON DELETE SET NULL,
  title varchar(80) NOT NULL,
  summary varchar(1000) NOT NULL,
  start_at timestamptz NOT NULL,
  registration_deadline timestamptz NOT NULL,
  meeting_point varchar(200) NOT NULL,
  difficulty difficulty_level NOT NULL,
  distance_km numeric(7,2) NOT NULL CHECK (distance_km > 0),
  elevation_gain_m integer NOT NULL CHECK (elevation_gain_m >= 0),
  speed_min_kph numeric(5,2) NOT NULL CHECK (speed_min_kph > 0),
  speed_max_kph numeric(5,2) NOT NULL CHECK (speed_max_kph >= speed_min_kph),
  capacity integer NOT NULL CHECK (capacity > 0 AND capacity <= 1000),
  registration_count integer NOT NULL DEFAULT 0 CHECK (registration_count >= 0 AND registration_count <= capacity),
  equipment_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ability_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_notice varchar(2000) NOT NULL,
  status event_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_deadline < start_at)
);

CREATE INDEX events_public_list_idx ON events (status, start_at, id);
CREATE INDEX events_organizer_idx ON events (organizer_id, created_at DESC);

CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  user_id uuid NOT NULL,
  status registration_status NOT NULL DEFAULT 'active',
  phone_encrypted text NOT NULL,
  emergency_contact_encrypted text NOT NULL,
  bike_type varchar(30) NOT NULL,
  ability_confirmed boolean NOT NULL CHECK (ability_confirmed),
  equipment_confirmed boolean NOT NULL CHECK (equipment_confirmed),
  waiver_version varchar(30) NOT NULL,
  waiver_accepted_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id),
  CHECK ((status = 'active' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
);

CREATE INDEX registrations_event_active_idx ON registrations (event_id) WHERE status = 'active';

CREATE TABLE registration_idempotency (
  user_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id),
  idempotency_key varchar(128) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id, idempotency_key)
);
