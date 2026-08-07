#!/bin/sh
set -eu

cd /opt/fengji
set -a
. deploy/.env.production
set +a

api_url=${API_URL:-https://cyclewhereapi.alexcld.com}
token_image=${TOKEN_IMAGE:-fengji-api-node:rollback-20260807}
user_id=cccccccc-cccc-4ccc-8ccc-ccccccccccc3
avatar_file=/tmp/avatar-base64-smoke.jpg

cleanup() {
  docker exec deploy-postgres-1 psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "DELETE FROM user_profiles WHERE id='$user_id';" >/dev/null 2>&1 || true
  docker exec deploy-api-1 sh -c "rm -f /app/data/avatars/${user_id}.jpg /app/data/avatars/${user_id}.png /app/data/avatars/${user_id}.webp" >/dev/null 2>&1 || true
  rm -f "$avatar_file" /tmp/avatar-base64-*.json
}
trap cleanup EXIT INT TERM

token=$(docker run --rm --env-file deploy/.env.production "$token_image" node dist/src/create-demo-token.js "$user_id")

profile_code=$(curl -sS -o /tmp/avatar-base64-profile.json -w '%{http_code}' -X PUT "$api_url/api/v1/me/profile" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  --data '{"nickname":"Avatar Smoke Rider","avatarUrl":null,"gender":null,"country":null,"province":null,"city":null}')
test "$profile_code" = 200

printf '\377\330\377\331' > "$avatar_file"
avatar_data=$(base64 -w 0 "$avatar_file")
avatar_code=$(curl -sS -o /tmp/avatar-base64-upload.json -w '%{http_code}' -X POST "$api_url/api/v1/me/avatar/base64" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  --data "{\"data\":\"$avatar_data\"}")
test "$avatar_code" = 201

avatar_url=$(jq -r '.data.profile.avatarUrl' /tmp/avatar-base64-upload.json)
test -n "$avatar_url"
test "$avatar_url" != null
curl -fsS "$avatar_url" >/dev/null

printf 'profile=%s avatar_base64=%s avatar_fetch=200\n' "$profile_code" "$avatar_code"
