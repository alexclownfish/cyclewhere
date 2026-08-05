import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { InMemoryRepository } from "../src/infrastructure/in-memory-repository.js";
import { authHeaders, eventFixture, fixedNow, roadbookFixture, testAuthSecret } from "./helpers.js";

const createEventBody = {
  routeId: "route-1",
  title: "钱塘江周末耐力骑",
  summary: "沿江稳定巡航，设置固定等候与补给点，适合中长距离训练。",
  startAt: "2026-08-29T23:00:00.000Z",
  registrationDeadline: "2026-08-28T12:00:00.000Z",
  meetingPoint: "钱江新城城市阳台",
  difficulty: "moderate",
  distanceKm: 92,
  elevationGainM: 450,
  speedMinKph: 24,
  speedMaxKph: 29,
  capacity: 30,
  equipmentRequirements: ["头盔", "前后车灯", "备用内胎"],
  abilityRequirements: ["近三个月完成过 80 公里骑行"],
  safetyNotice: "遵守交通规则，恶劣天气会取消活动，路书仅供参考。",
} as const;

describe("event and roadbook APIs", () => {
  it("lists and returns public events and roadbooks", async () => {
    const repository = new InMemoryRepository({
      events: [
        eventFixture(),
        eventFixture({ id: "event-draft", title: "未发布活动", status: "draft" }),
      ],
      roadbooks: [roadbookFixture()],
    });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const events = await app.inject({ method: "GET", url: "/api/v1/events?limit=10" });
    const eventDetail = await app.inject({ method: "GET", url: "/api/v1/events/event-1" });
    const routes = await app.inject({ method: "GET", url: "/api/v1/routes" });
    const routeDetail = await app.inject({ method: "GET", url: "/api/v1/routes/route-1" });

    assert.equal(events.statusCode, 200);
    assert.deepEqual(events.json().data.items.map((item: { id: string }) => item.id), ["event-1"]);
    assert.equal(eventDetail.json().data.title, "周末山地耐力骑行");
    assert.equal(routes.json().data.items.length, 1);
    assert.equal(routeDetail.json().data.coordinateSystem, "WGS84");
    assert.equal(routeDetail.json().data.track.length, 3);
    assert.deepEqual(routeDetail.json().data.elevationProfile, [20, 320, 20]);
    assert.equal(routeDetail.json().data.maxGradient, 8.6);

    const hiddenDraft = await app.inject({
      method: "GET",
      url: "/api/v1/events/event-draft",
    });
    const organizerDraft = await app.inject({
      method: "GET",
      url: "/api/v1/events/event-draft",
      headers: await authHeaders("organizer-1"),
    });
    assert.equal(hiddenDraft.statusCode, 404);
    assert.equal(organizerDraft.statusCode, 200);
    await app.close();
  });

  it("publishes only for the JWT organizer and ignores a spoofed user-id header", async () => {
    const repository = new InMemoryRepository({ roadbooks: [roadbookFixture()] });
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: await authHeaders("organizer-1"),
      payload: createEventBody,
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().data.status, "draft");
    const id = created.json().data.id as string;

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/events/${id}/publish`,
      headers: { ...(await authHeaders("other-user")), "x-user-id": "organizer-1" },
    });
    assert.equal(forbidden.statusCode, 403);

    const published = await app.inject({
      method: "POST",
      url: `/api/v1/events/${id}/publish`,
      headers: await authHeaders("organizer-1"),
    });
    assert.equal(published.statusCode, 200);
    assert.equal(published.json().data.status, "published");
    assert.equal(published.json().data.version, 2);
    await app.close();
  });

  it("returns structured validation and not-found errors", async () => {
    const repository = new InMemoryRepository();
    const app = await buildApp({ repository, clock: () => fixedNow, authSecret: testAuthSecret });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: await authHeaders("organizer-1"),
      payload: { ...createEventBody, speedMinKph: 35, speedMaxKph: 20 },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "VALIDATION_ERROR");

    const missing = await app.inject({ method: "GET", url: "/api/v1/routes/missing" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "NOT_FOUND");
    await app.close();
  });
});
