import type { CyclingEvent, Roadbook } from "../src/domain/models.js";
import { SignJWT } from "jose";

export const fixedNow = new Date("2026-08-06T03:00:00.000Z");
export const testAuthSecret = "test-secret-must-be-at-least-thirty-two-characters";

const tokens = new Map<string, Promise<string>>();

export function authHeaders(userId: string): Promise<{ authorization: string }> {
  let token = tokens.get(userId);
  if (!token) {
    token = new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("fengji-api")
      .setAudience("fengji-miniprogram")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testAuthSecret));
    tokens.set(userId, token);
  }
  return token.then((value) => ({ authorization: `Bearer ${value}` }));
}

export function eventFixture(overrides: Partial<CyclingEvent> = {}): CyclingEvent {
  return {
    id: "event-1",
    organizerId: "organizer-1",
    routeId: "route-1",
    title: "周末山地耐力骑行",
    summary: "全程设置等候点，适合具备中长距离骑行经验的骑友。",
    startAt: "2026-08-20T23:00:00.000Z",
    registrationDeadline: "2026-08-19T12:00:00.000Z",
    meetingPoint: "城市广场北门",
    difficulty: "moderate",
    distanceKm: 82,
    elevationGainM: 900,
    speedMinKph: 23,
    speedMaxKph: 28,
    capacity: 10,
    registrationCount: 0,
    equipmentRequirements: ["头盔", "车灯", "补胎工具"],
    abilityRequirements: ["近三个月完成过 60 公里骑行"],
    safetyNotice: "请遵守交通规则，遇恶劣天气活动可能取消。",
    status: "published",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

export function roadbookFixture(overrides: Partial<Roadbook> = {}): Roadbook {
  return {
    id: "route-1",
    ownerId: "organizer-1",
    name: "山湖经典环线",
    description: "串联湖边绿道与经典爬坡路段，沿途有可靠补给。",
    distanceKm: 82,
    elevationGainM: 900,
    estimatedMinutes: 280,
    difficulty: "moderate",
    region: "杭州",
    coordinateSystem: "WGS84",
    track: [
      { longitude: 120.1, latitude: 30.2 },
      { longitude: 120.15, latitude: 30.25 },
      { longitude: 120.1, latitude: 30.2 },
    ],
    elevationProfile: [20, 320, 20],
    maxGradient: 8.6,
    waypoints: [
      { name: "城市广场", type: "start", longitude: 120.1, latitude: 30.2, distanceKm: 0 },
      { name: "城市广场", type: "finish", longitude: 120.1, latitude: 30.2, distanceKm: 82 },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

export const registrationBody = {
  phone: "13800006721",
  emergencyContact: "林先生 13600001048",
  bikeType: "公路车",
  abilityConfirmed: true,
  equipmentConfirmed: true,
  waiverVersion: "v1.0",
} as const;
