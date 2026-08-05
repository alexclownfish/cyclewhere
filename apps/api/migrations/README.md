# PostgreSQL migration and transaction notes

Apply migrations with a role allowed to create `pgcrypto` and `postgis`:

```sh
npm run migrate
```

`src/migrate.ts` owns one transaction per migration and inserts the corresponding `schema_migrations` row before committing. SQL migration files must not include `BEGIN`, `COMMIT`, or `ROLLBACK`; otherwise the schema change and migration record would not be atomic. `test/migrations.test.ts` enforces this contract.

Production registration must execute in one transaction:

1. Lock the activity using `SELECT ... FROM events WHERE id = $1 FOR UPDATE`.
2. Select `(user_id, event_id, idempotency_key)` from `registration_idempotency`. If it exists, return its stored response.
3. Validate status, deadline and `registration_count < capacity` while holding that row lock.
4. Insert the unique `(event_id, user_id)` registration, or reactivate its cancelled row.
5. Increment `registration_count`, derive `published/full`, and insert the response in the idempotency table.
6. Commit. Roll back every write on any error.

Requests for the same event are serialized by the event row lock, so a concurrent retry sees the committed idempotency response before it can mutate capacity. Cancellation follows the same row lock order (`events` then `registrations`) and decrements the counter once. The consistent lock order prevents deadlocks. The in-memory repository follows this contract with a mutex and is intended only for local development and automated tests.

Rollback before production data exists:

```sql
DROP TABLE IF EXISTS registration_idempotency, registrations, events, roadbook_waypoints, roadbooks CASCADE;
DROP TYPE IF EXISTS registration_status, event_status, difficulty_level;
```

After production data exists, use a forward compensating migration instead of dropping tables.
