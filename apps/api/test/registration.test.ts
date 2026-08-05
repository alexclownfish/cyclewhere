import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { InMemoryRepository } from "../src/infrastructure/in-memory-repository.js";
import { authHeaders, eventFixture, fixedNow, registrationBody, testAuthSecret } from "./helpers.js";

describe("registration capacity and idempotency", () => {
  it("replays idempotently and prevents cross-user cancellation despite a spoofed header", async () => {
    const repository = new InMemoryRepository({ events: [eventFixture()] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const request = async () =>
      app.inject({
        method: "POST",
        url: "/api/v1/events/event-1/registrations",
        headers: { ...(await authHeaders("rider-1")), "idempotency-key": "register-key-001" },
        payload: registrationBody,
      });
    const first = await request();
    const replay = await request();

    assert.equal(first.statusCode, 201);
    assert.equal(first.body.includes(registrationBody.phone), false);
    assert.equal(first.body.includes(registrationBody.emergencyContact), false);
    assert.equal(replay.statusCode, 200);
    assert.equal(first.json().data.registration.id, replay.json().data.registration.id);
    assert.equal(replay.json().data.replayed, true);
    assert.equal((await repository.getEvent("event-1"))?.registrationCount, 1);

    const attackerCancellation = await app.inject({
      method: "DELETE",
      url: "/api/v1/events/event-1/registrations/me",
      headers: { ...(await authHeaders("rider-2")), "x-user-id": "rider-1" },
    });
    assert.equal(attackerCancellation.statusCode, 404);
    assert.equal((await repository.getRegistration("event-1", "rider-1"))?.status, "active");
    assert.equal((await repository.getEvent("event-1"))?.registrationCount, 1);
    await app.close();
  });

  it("rejects a duplicate registration made with a different key", async () => {
    const repository = new InMemoryRepository({ events: [eventFixture()] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });
    const makeRequest = async (key: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/events/event-1/registrations",
        headers: { ...(await authHeaders("rider-1")), "idempotency-key": key },
        payload: registrationBody,
      });

    assert.equal((await makeRequest("register-key-001")).statusCode, 201);
    const duplicate = await makeRequest("register-key-002");
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, "ALREADY_REGISTERED");
    await app.close();
  });

  it("does not oversell under concurrent requests", async () => {
    const repository = new InMemoryRepository({ events: [eventFixture({ capacity: 3 })] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const responses = await Promise.all(
      Array.from({ length: 30 }, async (_, index) =>
        app.inject({
          method: "POST",
          url: "/api/v1/events/event-1/registrations",
          headers: {
            ...(await authHeaders(`rider-${index}`)),
            "idempotency-key": `concurrent-key-${index}`,
          },
          payload: registrationBody,
        }),
      ),
    );
    const successful = responses.filter((response) => response.statusCode === 201);
    const rejected = responses.filter((response) => response.statusCode === 409);
    const event = await repository.getEvent("event-1");

    assert.equal(successful.length, 3);
    assert.equal(rejected.length, 27);
    assert.ok(rejected.every((response) => response.json().error.code === "EVENT_FULL"));
    assert.equal(event?.registrationCount, 3);
    assert.equal(event?.status, "full");
    await app.close();
  });

  it("releases capacity once when cancellation is retried", async () => {
    const repository = new InMemoryRepository({ events: [eventFixture({ capacity: 1 })] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });
    await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: { ...(await authHeaders("rider-1")), "idempotency-key": "register-key-001" },
      payload: registrationBody,
    });

    const cancellation = async () =>
      app.inject({
        method: "DELETE",
        url: "/api/v1/events/event-1/registrations/me",
        headers: await authHeaders("rider-1"),
      });
    const first = await cancellation();
    const replay = await cancellation();
    const event = await repository.getEvent("event-1");

    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.replayed, true);
    assert.equal(event?.registrationCount, 0);
    assert.equal(event?.status, "published");

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/events/event-1/registration-status",
      headers: await authHeaders("rider-1"),
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().data.status, "cancelled");

    const nextRider = await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: { ...(await authHeaders("rider-2")), "idempotency-key": "register-key-002" },
      payload: registrationBody,
    });
    assert.equal(nextRider.statusCode, 201);
    await app.close();
  });

  it("enforces deadline, acknowledgements and required headers", async () => {
    const repository = new InMemoryRepository({
      events: [eventFixture({ registrationDeadline: "2026-08-05T12:00:00.000Z" })],
    });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: { ...(await authHeaders("rider-1")), "idempotency-key": "register-key-001" },
      payload: registrationBody,
    });
    assert.equal(closed.statusCode, 409);
    assert.equal(closed.json().error.code, "REGISTRATION_CLOSED");

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: { ...(await authHeaders("rider-1")), "idempotency-key": "register-key-002" },
      payload: { ...registrationBody, equipmentConfirmed: false },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "VALIDATION_ERROR");

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: {
        authorization: "Bearer forged-token",
        "x-user-id": "rider-1",
        "idempotency-key": "register-key-003",
      },
      payload: registrationBody,
    });
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
  });

  it("closes registration exactly at the deadline", async () => {
    const repository = new InMemoryRepository({
      events: [eventFixture({ registrationDeadline: fixedNow.toISOString() })],
    });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events/event-1/registrations",
      headers: { ...(await authHeaders("deadline-rider")), "idempotency-key": "deadline-key-001" },
      payload: registrationBody,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "REGISTRATION_CLOSED");
    assert.equal((await repository.getEvent("event-1"))?.registrationCount, 0);
    await app.close();
  });

  it("returns all of the JWT user's active, cancelled and historical registrations", async () => {
    const first = eventFixture({ id: "event-first", startAt: "2026-08-20T23:00:00.000Z" });
    const historical = eventFixture({
      id: "event-historical",
      startAt: "2026-09-20T23:00:00.000Z",
    });
    const other = eventFixture({ id: "event-other", startAt: "2026-10-20T23:00:00.000Z" });
    const repository = new InMemoryRepository({ events: [first, historical, other] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });
    const mine = await authHeaders("history-rider");

    for (const [eventId, key] of [
      ["event-first", "history-key-001"],
      ["event-historical", "history-key-002"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/events/${eventId}/registrations`,
        headers: { ...mine, "idempotency-key": key },
        payload: registrationBody,
      });
      assert.equal(response.statusCode, 201);
    }
    await app.inject({
      method: "POST",
      url: "/api/v1/events/event-other/registrations",
      headers: { ...(await authHeaders("other-history-rider")), "idempotency-key": "history-key-003" },
      payload: registrationBody,
    });
    await app.inject({
      method: "DELETE",
      url: "/api/v1/events/event-first/registrations/me",
      headers: mine,
    });
    await repository.updateEvent({
      ...(await repository.getEvent("event-historical"))!,
      status: "completed",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me/registrations",
      headers: mine,
    });
    const items = response.json().data.items as Array<{
      registration: { status: string };
      event: { id: string; status: string };
    }>;

    assert.equal(response.statusCode, 200);
    assert.deepEqual(items.map((item) => item.event.id), ["event-historical", "event-first"]);
    assert.deepEqual(items.map((item) => item.registration.status), ["active", "cancelled"]);
    assert.deepEqual(items.map((item) => item.event.status), ["completed", "published"]);

    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/me/registrations" });
    assert.equal(unauthorized.statusCode, 401);
    await app.close();
  });
});
