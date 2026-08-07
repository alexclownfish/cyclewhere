-- Idempotent starter catalog for a fresh production deployment.
-- These records make the first install usable; user-created records are untouched.
INSERT INTO roadbooks (
  id, owner_id, name, description, distance_km, elevation_gain_m, estimated_minutes,
  difficulty, region, coordinate_system, track, elevation_profile, max_gradient,
  created_at, updated_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  '西湖群山爬坡环线',
  '从龙井出发，串联梅灵路与经典爬坡路段，补给点清晰。',
  68.4, 1060, 240, 'challenging', '杭州', 'WGS84',
  ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[120.104,30.222],[120.087,30.191],[120.104,30.222]]}'), 4326)::geography,
  '[52,410,52]'::jsonb, 11.8,
  '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO roadbook_waypoints (roadbook_id, name, waypoint_type, location, distance_km, sort_order)
VALUES
  ('11111111-1111-4111-8111-111111111111', '龙井集合点', 'start', ST_SetSRID(ST_MakePoint(120.104, 30.222), 4326)::geography, 0, 0),
  ('11111111-1111-4111-8111-111111111111', '梅家坞补水', 'water', ST_SetSRID(ST_MakePoint(120.087, 30.191), 4326)::geography, 23.6, 1),
  ('11111111-1111-4111-8111-111111111111', '龙井集合点', 'finish', ST_SetSRID(ST_MakePoint(120.104, 30.222), 4326)::geography, 68.4, 2)
ON CONFLICT (roadbook_id, sort_order) DO NOTHING;

INSERT INTO events (
  id, organizer_id, roadbook_id, title, summary, start_at, registration_deadline,
  meeting_point, difficulty, distance_km, elevation_gain_m, speed_min_kph, speed_max_kph,
  capacity, registration_count, equipment_requirements, ability_requirements, safety_notice,
  status, version, created_at, updated_at
) VALUES (
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '西湖群山晨间爬坡',
  '稳定拉练，设置等候点，适合有连续爬坡经验的公路车骑友。',
  '2026-08-15T00:30:00Z', '2026-08-14T12:30:00Z',
  '杭州龙井路停车场入口', 'challenging', 68.4, 1060, 24, 29,
  20, 0,
  '["头盔","前后车灯","补胎工具","备用内胎"]'::jsonb,
  '["近三个月完成过 60 公里骑行","可连续完成 800 米累计爬升"]'::jsonb,
  '遵守交通规则，路线可能因天气或临时封路调整，路书仅供参考。',
  'published', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;
