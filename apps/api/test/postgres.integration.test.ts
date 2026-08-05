import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { Pool } from "pg";
import { DomainError } from "../src/domain/errors.js";
import type { CyclingEvent, Roadbook } from "../src/domain/models.js";
import { PostgresRepository } from "../src/infrastructure/postgres-repository.js";

const databaseUrl = process.env.DATABASE_URL;

it("persists roadbooks and prevents PostgreSQL registration oversell", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl!, max: 20 });
  const repository = new PostgresRepository(pool);
  const ownerId = randomUUID();
  const roadbookId = randomUUID();
  const eventId = randomUUID();
  const deadlineEventId = randomUUID();
  const now = new Date("2026-08-06T03:00:00.000Z");
  const roadbook: Roadbook = {
    id: roadbookId,
    ownerId,
    name: "PostGIS integration route",
    description: "Persistent route used only by the isolated integration test.",
    distanceKm: 80,
    elevationGainM: 900,
    estimatedMinutes: 260,
    difficulty: "moderate",
    region: "Beijing",
    coordinateSystem: "WGS84",
    track: [
      { longitude: 116.2, latitude: 39.9 },
      { longitude: 116.25, latitude: 39.95 },
      { longitude: 116.3, latitude: 40 },
    ],
    elevationProfile: [40, 380, 70],
    maxGradient: 9.4,
    waypoints: [
      { name: "Start", type: "start", longitude: 116.2, latitude: 39.9, distanceKm: 0 },
      { name: "Finish", type: "finish", longitude: 116.3, latitude: 40, distanceKm: 80 },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const event: CyclingEvent = {
    id: eventId,
    organizerId: ownerId,
    routeId: roadbookId,
    title: "PostgreSQL capacity integration",
    summary: "Exercises the durable row-lock path with competing registration requests.",
    startAt: "2026-09-01T02:00:00.000Z",
    registrationDeadline: "2026-08-30T02:00:00.000Z",
    meetingPoint: "Integration test start",
    difficulty: "moderate",
    distanceKm: 80,
    elevationGainM: 900,
    speedMinKph: 23,
    speedMaxKph: 28,
    capacity: 3,
    registrationCount: 0,
    equipmentRequirements: ["helmet"],
    abilityRequirements: ["60km recent ride"],
    safetyNotice: "Integration test record; never expose this event to users.",
    status: "published",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    version: 1,
  };
  try {
    await repository.createRoadbook(roadbook);
    await repository.createEvent(event);
    await repository.createEvent({
      ...event,
      id: deadlineEventId,
      title: "PostgreSQL deadline boundary integration",
      registrationDeadline: now.toISOString(),
    });
    await assert.rejects(
      repository.registerAtomically({
        eventId: deadlineEventId,
        userId: randomUUID(),
        idempotencyKey: "postgres-deadline-boundary",
        abilityConfirmed: true,
        equipmentConfirmed: true,
        waiverVersion: "v1.0",
        phoneEncrypted: "v1.integration-test-ciphertext",
        emergencyContactEncrypted: "v1.integration-test-ciphertext",
        bikeType: "road",
        now,
      }),
      (error: unknown) => error instanceof DomainError && error.code === "REGISTRATION_CLOSED",
    );
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) => repository.registerAtomically({
        eventId,
        userId: randomUUID(),
        idempotencyKey: `postgres-concurrent-${index}`,
        abilityConfirmed: true,
        equipmentConfirmed: true,
        waiverVersion: "v1.0",
        phoneEncrypted: "v1.integration-test-ciphertext",
        emergencyContactEncrypted: "v1.integration-test-ciphertext",
        bikeType: "road",
        now,
      })),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    assert.equal(results.filter((result) => result.status === "rejected").length, 9);
    assert.equal((await repository.getEvent(eventId))?.registrationCount, 3);
    assert.equal((await repository.getEvent(eventId))?.status, "full");
    const persistedRoadbook = await repository.getRoadbook(roadbookId);
    assert.equal(persistedRoadbook?.waypoints.length, 2);
    assert.deepEqual(persistedRoadbook?.track, roadbook.track);
    assert.deepEqual(persistedRoadbook?.elevationProfile, roadbook.elevationProfile);
    assert.equal(persistedRoadbook?.maxGradient, roadbook.maxGradient);
  } finally {
    await pool.query("DELETE FROM registration_idempotency WHERE event_id = ANY($1::uuid[])", [[eventId, deadlineEventId]]);
    await pool.query("DELETE FROM registrations WHERE event_id = ANY($1::uuid[])", [[eventId, deadlineEventId]]);
    await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [[eventId, deadlineEventId]]);
    await pool.query("DELETE FROM roadbooks WHERE id=$1", [roadbookId]);
    await pool.end();
  }
});
