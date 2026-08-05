import type { CyclingEvent, Roadbook } from "../domain/models.js";

const createdAt = "2026-08-01T00:00:00.000Z";

export const demoRoadbooks: Roadbook[] = [
  {
    id: "route-west-lake-loop",
    ownerId: "organizer-demo",
    name: "西湖群山爬坡环线",
    description: "从龙井出发，串联梅灵路与周边经典爬坡路段，补给点清晰。",
    distanceKm: 68.4,
    elevationGainM: 1060,
    estimatedMinutes: 240,
    difficulty: "challenging",
    region: "杭州",
    coordinateSystem: "WGS84",
    track: [
      { longitude: 120.104, latitude: 30.222 },
      { longitude: 120.087, latitude: 30.191 },
      { longitude: 120.104, latitude: 30.222 },
    ],
    elevationProfile: [52, 410, 52],
    maxGradient: 11.8,
    waypoints: [
      { name: "龙井集合点", type: "start", longitude: 120.104, latitude: 30.222, distanceKm: 0 },
      { name: "梅家坞补水", type: "water", longitude: 120.087, latitude: 30.191, distanceKm: 23.6 },
      { name: "龙井集合点", type: "finish", longitude: 120.104, latitude: 30.222, distanceKm: 68.4 },
    ],
    createdAt,
    updatedAt: createdAt,
  },
];

export const demoEvents: CyclingEvent[] = [
  {
    id: "event-west-lake-climb",
    organizerId: "organizer-demo",
    routeId: "route-west-lake-loop",
    title: "西湖群山晨间爬坡",
    summary: "稳定拉练，设置等候点，适合有连续爬坡经验的公路车骑友。",
    startAt: "2026-09-12T23:00:00.000Z",
    registrationDeadline: "2026-09-11T12:00:00.000Z",
    meetingPoint: "杭州龙井路停车场入口",
    difficulty: "challenging",
    distanceKm: 68.4,
    elevationGainM: 1060,
    speedMinKph: 24,
    speedMaxKph: 29,
    capacity: 20,
    registrationCount: 0,
    equipmentRequirements: ["头盔", "前后车灯", "补胎工具", "备用内胎"],
    abilityRequirements: ["近三个月完成过 60 公里骑行", "可连续完成 800 米累计爬升"],
    safetyNotice: "遵守交通规则，路线可能因天气或临时封路调整，路书仅供参考。",
    status: "published",
    createdAt,
    updatedAt: createdAt,
    version: 1,
  },
];
