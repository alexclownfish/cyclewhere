#!/bin/sh
set -eu

cd /opt/fengji
set -a
. deploy/.env.production
set +a

api_url=${API_URL:-https://cyclewhereapi.alexcld.com}
token_image=${TOKEN_IMAGE:-fengji-api-node:rollback-20260807}
user_id=dddddddd-dddd-4ddd-8ddd-ddddddddddd4
event_id=
route_id=
imported_route_id=
cover_file=/tmp/media-smoke.jpg

cleanup() {
  if [ -n "$event_id" ]; then
    docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DELETE FROM events WHERE id='$event_id';" >/dev/null 2>&1 || true
  fi
  if [ -n "$imported_route_id" ]; then
    docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DELETE FROM roadbook_waypoints WHERE roadbook_id='$imported_route_id'; DELETE FROM roadbooks WHERE id='$imported_route_id';" >/dev/null 2>&1 || true
  fi
  docker exec deploy-api-1 sh -c "rm -f /app/data/avatars/event-${event_id}.*" >/dev/null 2>&1 || true
  rm -f "$cover_file" /tmp/media-smoke-*.json /tmp/media-smoke-*.gpx
}
trap cleanup EXIT INT TERM

token=$(docker run --rm --env-file deploy/.env.production "$token_image" node dist/src/create-demo-token.js "$user_id")
route_id=$(curl -fsS "$api_url/api/v1/routes?limit=1" | jq -r '.data.items[0].id')
test -n "$route_id"

payload=$(jq -nc --arg route "$route_id" '{routeId:$route,title:"Media Smoke Ride",summary:"A media smoke test ride with a clear safety note.",startAt:"2026-10-20T08:00:00.000Z",registrationDeadline:"2026-10-19T18:00:00.000Z",meetingPoint:"Media smoke meeting point",difficulty:"moderate",distanceKm:50,elevationGainM:500,speedMinKph:22,speedMaxKph:28,capacity:4,equipmentRequirements:["头盔"],abilityRequirements:["近期完成 40 公里骑行"],safetyNotice:"遵守交通规则并听从领队安排。"}')
create_code=$(curl -sS -o /tmp/media-smoke-create.json -w '%{http_code}' -X POST "$api_url/api/v1/events" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data "$payload")
test "$create_code" = 201
event_id=$(jq -r '.data.id' /tmp/media-smoke-create.json)

printf '\377\330\377\331' > "$cover_file"
cover_data=$(base64 -w 0 "$cover_file")
cover_code=$(curl -sS -o /tmp/media-smoke-cover.json -w '%{http_code}' -X POST "$api_url/api/v1/events/$event_id/cover/base64" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data "{\"data\":\"$cover_data\"}")
test "$cover_code" = 201
cover_url=$(jq -r '.data.coverUrl' /tmp/media-smoke-cover.json)
test -n "$cover_url"
test "$cover_url" != null
curl -fsS "$cover_url" >/dev/null

cat > /tmp/media-smoke-route.gpx <<'GPX'
<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="30.20" lon="120.10"><ele>20</ele></trkpt><trkpt lat="30.21" lon="120.11"><ele>80</ele></trkpt><trkpt lat="30.22" lon="120.12"><ele>30</ele></trkpt></trkseg></trk></gpx>
GPX
gpx_data=$(jq -Rs . /tmp/media-smoke-route.gpx)
gpx_code=$(curl -sS -o /tmp/media-smoke-gpx.json -w '%{http_code}' -X POST "$api_url/api/v1/routes/import/gpx" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data "{\"gpx\":$gpx_data,\"name\":\"Media Smoke Route\",\"region\":\"杭州\",\"difficulty\":\"moderate\"}")
test "$gpx_code" = 201
imported_route_id=$(jq -r '.data.id' /tmp/media-smoke-gpx.json)

printf 'event=%s cover=%s cover_fetch=200 gpx=%s\n' "$event_id" "$cover_code" "$gpx_code"
