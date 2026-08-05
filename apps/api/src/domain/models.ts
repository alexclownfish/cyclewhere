export const eventStatuses = ["draft", "published", "full", "completed", "cancelled"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const difficultyLevels = ["easy", "moderate", "challenging", "expert"] as const;
export type Difficulty = (typeof difficultyLevels)[number];

export interface CyclingEvent {
  id: string;
  organizerId: string;
  routeId: string | null;
  title: string;
  summary: string;
  startAt: string;
  registrationDeadline: string;
  meetingPoint: string;
  difficulty: Difficulty;
  distanceKm: number;
  elevationGainM: number;
  speedMinKph: number;
  speedMaxKph: number;
  capacity: number;
  registrationCount: number;
  equipmentRequirements: string[];
  abilityRequirements: string[];
  safetyNotice: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RoadbookWaypoint {
  name: string;
  type: "start" | "finish" | "water" | "supply" | "danger" | "viewpoint";
  longitude: number;
  latitude: number;
  distanceKm: number;
}

export interface RoadbookTrackPoint {
  longitude: number;
  latitude: number;
}

export interface Roadbook {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  distanceKm: number;
  elevationGainM: number;
  estimatedMinutes: number;
  difficulty: Difficulty;
  region: string;
  coordinateSystem: "WGS84";
  track: RoadbookTrackPoint[];
  elevationProfile: number[];
  maxGradient: number;
  waypoints: RoadbookWaypoint[];
  createdAt: string;
  updatedAt: string;
}

export interface Registration {
  id: string;
  eventId: string;
  userId: string;
  status: "active" | "cancelled";
  abilityConfirmed: boolean;
  equipmentConfirmed: boolean;
  waiverVersion: string;
  waiverAcceptedAt: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface RegistrationResult {
  registration: Registration;
  event: CyclingEvent;
  replayed: boolean;
}

export interface UserRegistrationItem {
  registration: Registration;
  event: CyclingEvent;
}
