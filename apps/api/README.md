# Fengji MVP API

Node.js 24 + TypeScript API for activities, roadbooks and registrations. NestJS is the modular application framework and uses the Fastify adapter; domain services and the repository contract remain framework-independent boundaries. See [ADR 001](./docs/adr/001-nestjs-fastify-modular-monolith.md).

## Run

```sh
cd apps/api
npm install
npm run typecheck
```

For a local, non-durable demonstration in PowerShell:

```powershell
$env:DEMO_MODE="true"
$env:JWT_SECRET="replace-with-a-local-secret-of-at-least-32-characters"
$env:FIELD_ENCRYPTION_KEY="use-a-different-local-secret-of-at-least-32-characters"
npm run dev
```

Demo mode uses seeded in-memory data and may leave WeChat login disabled; use `npm run token:demo -- rider-demo` to create a local Bearer token. The server listens on `http://localhost:3000`; override with `PORT` and `HOST`.

For PostgreSQL/PostGIS production-style startup, configure the required environment and migrate before starting:

```powershell
$env:DATABASE_URL="<injected-by-secret-manager>"
$env:JWT_SECRET="replace-with-a-production-secret-of-at-least-32-characters"
$env:FIELD_ENCRYPTION_KEY="use-a-separate-production-secret-of-at-least-32-characters"
$env:WECHAT_APP_ID="wx..."
$env:WECHAT_APP_SECRET="..."
npm run migrate
npm run build
npm start
```

When `DEMO_MODE` is not `true`, startup fails fast if `DATABASE_URL`, `WECHAT_APP_ID`, or `WECHAT_APP_SECRET` is absent. `DATABASE_POOL_SIZE` defaults to 10. The migration role must be allowed to create the `pgcrypto` and `postgis` extensions.

```sh
npm run typecheck
npm test
npm run build
```

Protected endpoints require a verified HS256 Bearer JWT with issuer `fengji-api`, audience `fengji-miniprogram`, expiry and user id in `sub`. In production the mini program calls `wx.login`, then sends the returned code to `POST /api/v1/auth/wechat/login`; the API exchanges it with WeChat `jscode2session` and signs the token. Generate a local token with the same `JWT_SECRET` only for demo development:

```sh
npm run token:demo -- rider-demo
```

## API

All business endpoints use `/api/v1`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/wechat/login` | Exchange a WeChat login code for a seven-day Bearer token |
| GET | `/events` | Public event list; filters: `status`, `difficulty`, `cursor`, `limit` |
| POST | `/events` | Create a draft activity |
| GET | `/events/:id` | Activity details |
| POST | `/events/:id/publish` | Publish an organizer-owned draft |
| GET | `/routes` | Roadbook list |
| POST | `/routes` | Create a WGS84 roadbook |
| GET | `/routes/:id` | Roadbook details |
| POST | `/events/:id/registrations` | Register atomically; requires `Idempotency-Key` |
| DELETE | `/events/:id/registrations/me` | Cancel current user's registration |
| GET | `/events/:id/registration-status` | Current user's registration state |
| GET | `/me/registrations` | JWT user's complete active, cancelled, and historical registration list |

Controllers never trust a client-supplied user id. The JWT guard verifies the token and injects its `sub`; organizer ownership and registration ownership use only that verified identity. Responses are `{ "data": ... }`; errors are `{ "error": { "code", "message", "details" } }`.

## Persistence boundary

`PostgresRepository` is the durable adapter selected whenever `DATABASE_URL` is configured. Registration and cancellation lock the event row and update the registration, capacity, activity state, and idempotency response in one transaction. The schema is [migrations/001_initial.sql](./migrations/001_initial.sql), and `npm run migrate` records applied files in `schema_migrations`.

The migration runner owns `BEGIN`, `COMMIT`, and `ROLLBACK`; individual SQL migration files must not contain transaction-control statements. This keeps each schema change and its `schema_migrations` record atomic. [migrations/README.md](./migrations/README.md) documents the row-lock order and operational requirements.

`InMemoryRepository` remains available only for explicit demo mode and deterministic tests. It uses the same repository contract and serializes capacity mutations with a mutex, but it is neither durable nor horizontally scalable.

## Production gaps

- Login throttling is process-local; production still needs a shared Redis-backed limiter and upstream abuse controls.
- Administrative audit logs, content moderation, key rotation, secrets management, backups, and migration rollback procedures remain operational work.
- Event editing/cancellation and private organizer lists are outside this delivered slice.
- The PostgreSQL integration suite requires a disposable migrated database and runs through `npm run test:postgres`.
