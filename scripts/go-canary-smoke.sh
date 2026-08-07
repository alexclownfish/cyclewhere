#!/bin/sh
set -eu

cd /opt/fengji
set -a
. deploy/.env.production
set +a

canary_url=${CANARY_URL:-http://127.0.0.1:3001}
production_url=${PRODUCTION_URL:-https://cyclewhereapi.alexcld.com}
organizer_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1
rider_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2
token_image=${TOKEN_IMAGE:-}
restart_container=${RESTART_CONTAINER:-}
event_id=
imported_route_id=

cleanup() {
  if [ -n "$event_id" ]; then
    docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DELETE FROM registration_idempotency WHERE event_id='$event_id'; DELETE FROM registrations WHERE event_id='$event_id'; DELETE FROM events WHERE id='$event_id';" >/dev/null 2>&1 || true
  fi
  if [ -n "$imported_route_id" ]; then
    docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "DELETE FROM roadbook_waypoints WHERE roadbook_id='$imported_route_id'; DELETE FROM roadbooks WHERE id='$imported_route_id';" >/dev/null 2>&1 || true
  fi
  docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "DELETE FROM user_profiles WHERE id IN ('$organizer_id','$rider_id');" >/dev/null 2>&1 || true
  docker exec deploy-api-go-canary sh -c "rm -f /app/data/avatars/${organizer_id}.jpg /app/data/avatars/${organizer_id}.png /app/data/avatars/${organizer_id}.webp" >/dev/null 2>&1 || true
  rm -f /tmp/go-canary-*.json /tmp/go-canary-avatar.jpg /tmp/go-canary-route.gpx /tmp/node-events.sorted /tmp/go-events.sorted
}
trap cleanup EXIT INT TERM

expect_code() {
  expected=$1
  actual=$2
  step=$3
  body=$4
  if [ "$actual" != "$expected" ]; then
    echo "$step expected HTTP $expected, got $actual" >&2
    cat "$body" >&2
    exit 1
  fi
}

if [ -n "$token_image" ]; then
  organizer_token=$(docker run --rm --env-file deploy/.env.production "$token_image" node dist/src/create-demo-token.js "$organizer_id")
  rider_token=$(docker run --rm --env-file deploy/.env.production "$token_image" node dist/src/create-demo-token.js "$rider_id")
else
  organizer_token=$(docker exec deploy-api-1 node dist/src/create-demo-token.js "$organizer_id")
  rider_token=$(docker exec deploy-api-1 node dist/src/create-demo-token.js "$rider_id")
fi
route_id=$(curl -fsS "$canary_url/api/v1/routes?limit=1" | jq -r '.data.items[0].id')
test -n "$route_id"
test "$route_id" != null

curl -fsS "$production_url/api/v1/events?limit=2" | jq -S . > /tmp/node-events.sorted
curl -fsS "$canary_url/api/v1/events?limit=2" | jq -S . > /tmp/go-events.sorted
diff -u /tmp/node-events.sorted /tmp/go-events.sorted >/dev/null

invalid_node=$(curl -sS -o /tmp/go-canary-login-node.json -w '%{http_code}' -X POST "$production_url/api/v1/auth/wechat/login" -H 'Content-Type: application/json' --data '{"code":"invalid-canary-code"}')
invalid_go=$(curl -sS -o /tmp/go-canary-login-go.json -w '%{http_code}' -X POST "$canary_url/api/v1/auth/wechat/login" -H 'Content-Type: application/json' --data '{"code":"invalid-canary-code"}')
test "$invalid_node" = "$invalid_go"
test "$(jq -r '.error.code' /tmp/go-canary-login-node.json)" = "$(jq -r '.error.code' /tmp/go-canary-login-go.json)"

profile_code=$(curl -sS -o /tmp/go-canary-profile.json -w '%{http_code}' -X PUT "$canary_url/api/v1/me/profile" \
  -H "Authorization: Bearer $organizer_token" -H 'Content-Type: application/json' \
  --data '{"nickname":"Go Canary Rider","avatarUrl":null,"gender":null,"country":null,"province":null,"city":"Hangzhou"}')
expect_code 200 "$profile_code" profile /tmp/go-canary-profile.json

printf '\377\330\377\331' > /tmp/go-canary-avatar.jpg
avatar_code=$(curl -sS -o /tmp/go-canary-avatar.json -w '%{http_code}' -X POST "$canary_url/api/v1/me/avatar" \
  -H "Authorization: Bearer $organizer_token" -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-Host: 127.0.0.1:3001' \
  -F file=@/tmp/go-canary-avatar.jpg)
expect_code 201 "$avatar_code" avatar /tmp/go-canary-avatar.json
avatar_url=$(jq -r '.data.profile.avatarUrl' /tmp/go-canary-avatar.json)
if [ -n "$restart_container" ]; then
  docker restart "$restart_container" >/dev/null
  attempts=0
  until curl -fsS "$canary_url/health" >/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 20 ]; then
      echo "API did not recover after restart" >&2
      exit 1
    fi
    sleep 1
  done
fi
curl -fsS "$avatar_url" >/dev/null

cat > /tmp/go-canary-route.gpx <<'GPX'
<?xml version="1.0"?><gpx><trk><name>Go Canary Route</name><trkseg><trkpt lat="30.20" lon="120.10"><ele>20</ele></trkpt><trkpt lat="30.21" lon="120.11"><ele>80</ele></trkpt><trkpt lat="30.22" lon="120.12"><ele>30</ele></trkpt></trkseg></trk></gpx>
GPX
gpx_code=$(curl -sS -o /tmp/go-canary-gpx.json -w '%{http_code}' -X POST "$canary_url/api/v1/routes/import/gpx" \
  -H "Authorization: Bearer $organizer_token" -F file=@/tmp/go-canary-route.gpx)
expect_code 201 "$gpx_code" gpx /tmp/go-canary-gpx.json
imported_route_id=$(jq -r '.data.id' /tmp/go-canary-gpx.json)
test -n "$imported_route_id"
test "$imported_route_id" != null

event_payload=$(jq -nc --arg route "$route_id" '{
  routeId:$route,title:"Go Canary Contract Ride",summary:"Canary contract validation ride for the Go API.",
  startAt:"2026-10-20T08:00:00.000+08:00",registrationDeadline:"2026-10-19T18:00:00.000+08:00",
  meetingPoint:"Canary meeting point",difficulty:"moderate",distanceKm:50,elevationGainM:500,
  speedMinKph:22,speedMaxKph:28,capacity:2,equipmentRequirements:["Helmet","Lights"],
  abilityRequirements:["Completed a recent 40 km ride"],safetyNotice:"Follow traffic rules and ride leader instructions."
}')
create_code=$(curl -sS -o /tmp/go-canary-create.json -w '%{http_code}' -X POST "$canary_url/api/v1/events" \
  -H "Authorization: Bearer $organizer_token" -H 'Content-Type: application/json' --data "$event_payload")
expect_code 201 "$create_code" create /tmp/go-canary-create.json
event_id=$(jq -r '.data.id' /tmp/go-canary-create.json)
test -n "$event_id"
test "$event_id" != null

publish_code=$(curl -sS -o /tmp/go-canary-publish.json -w '%{http_code}' -X POST "$canary_url/api/v1/events/$event_id/publish" \
  -H "Authorization: Bearer $organizer_token" -H 'Content-Type: application/json' --data '{}')
expect_code 200 "$publish_code" publish /tmp/go-canary-publish.json

updated_payload=$(printf '%s' "$event_payload" | jq -c '.title="Go Canary Contract Ride Updated"')
update_code=$(curl -sS -o /tmp/go-canary-update.json -w '%{http_code}' -X PUT "$canary_url/api/v1/events/$event_id" \
  -H "Authorization: Bearer $organizer_token" -H 'Content-Type: application/json' --data "$updated_payload")
expect_code 200 "$update_code" update /tmp/go-canary-update.json

node_detail_code=$(curl -sS -o /tmp/go-canary-node-detail.json -w '%{http_code}' "$production_url/api/v1/events/$event_id")
expect_code 200 "$node_detail_code" node_detail /tmp/go-canary-node-detail.json
test "$(jq -r '.data.title' /tmp/go-canary-node-detail.json)" = "Go Canary Contract Ride Updated"

registration_payload='{"phone":"13800138000","emergencyContact":"Li 13900139000","bikeType":"Road bike","abilityConfirmed":true,"equipmentConfirmed":true,"waiverVersion":"v1.0"}'
register_code=$(curl -sS -o /tmp/go-canary-register.json -w '%{http_code}' -X POST "$canary_url/api/v1/events/$event_id/registrations" \
  -H "Authorization: Bearer $rider_token" -H 'Idempotency-Key: canary-registration-001' -H 'Content-Type: application/json' --data "$registration_payload")
expect_code 201 "$register_code" register /tmp/go-canary-register.json
replay_code=$(curl -sS -o /tmp/go-canary-replay.json -w '%{http_code}' -X POST "$canary_url/api/v1/events/$event_id/registrations" \
  -H "Authorization: Bearer $rider_token" -H 'Idempotency-Key: canary-registration-001' -H 'Content-Type: application/json' --data "$registration_payload")
expect_code 200 "$replay_code" replay /tmp/go-canary-replay.json
test "$(jq -r '.data.replayed' /tmp/go-canary-register.json)" = false
test "$(jq -r '.data.replayed' /tmp/go-canary-replay.json)" = true

status_code=$(curl -sS -o /tmp/go-canary-status.json -w '%{http_code}' "$canary_url/api/v1/events/$event_id/registration-status" -H "Authorization: Bearer $rider_token")
expect_code 200 "$status_code" status /tmp/go-canary-status.json
mine_code=$(curl -sS -o /tmp/go-canary-mine.json -w '%{http_code}' "$canary_url/api/v1/me/registrations" -H "Authorization: Bearer $rider_token")
expect_code 200 "$mine_code" mine /tmp/go-canary-mine.json
test "$(jq --arg id "$event_id" '[.data.items[] | select(.event.id==$id)] | length' /tmp/go-canary-mine.json)" = 1

cancel_code=$(curl -sS -o /tmp/go-canary-cancel.json -w '%{http_code}' -X DELETE "$canary_url/api/v1/events/$event_id/registrations/me" -H "Authorization: Bearer $rider_token")
expect_code 200 "$cancel_code" cancel /tmp/go-canary-cancel.json

printf 'public_parity=ok invalid_login=%s profile=%s avatar=%s gpx=%s create=%s publish=%s update=%s node_detail=%s register=%s replay=%s status=%s mine=%s cancel=%s\n' \
  "$invalid_go" "$profile_code" "$avatar_code" "$gpx_code" "$create_code" "$publish_code" "$update_code" "$node_detail_code" "$register_code" "$replay_code" "$status_code" "$mine_code" "$cancel_code"
