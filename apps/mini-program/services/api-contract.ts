import type { PublishEventInput, Registration, RideEvent, RideRoute } from '../types/domain';
import { wgs84ToGcj02 } from '../utils/coordinates';

export type BackendDifficulty = 'easy' | 'moderate' | 'challenging' | 'expert';
export type BackendEventStatus = 'draft' | 'published' | 'full' | 'completed' | 'cancelled';

export interface BackendPage<T> { items: T[]; nextCursor: string | null; }
export interface BackendEvent {
  id: string; organizerId?: string; routeId: string | null; title: string; summary: string; coverUrl?: string | null; startAt: string;
  registrationDeadline: string; meetingPoint: string; difficulty: BackendDifficulty; distanceKm: number;
  elevationGainM: number; speedMinKph: number; speedMaxKph: number; capacity: number; registrationCount: number;
  equipmentRequirements: string[]; abilityRequirements: string[]; safetyNotice: string; status: BackendEventStatus;
  createdAt: string; updatedAt: string; version: number;
  organizerProfile?: { nickname: string | null; avatarUrl: string | null } | null;
  ownedByMe?: boolean;
}
export interface BackendWaypoint {
  name: string; type: 'start' | 'finish' | 'water' | 'supply' | 'danger' | 'viewpoint';
  longitude: number; latitude: number; distanceKm: number;
}
export interface BackendRoadbook {
  id: string; ownerId: string; name: string; description: string; distanceKm: number; elevationGainM: number;
  estimatedMinutes: number; difficulty: BackendDifficulty; region: string; coordinateSystem: 'WGS84';
  track: Array<{ longitude: number; latitude: number }>; elevationProfile: number[]; maxGradient: number;
  waypoints: BackendWaypoint[]; createdAt: string; updatedAt: string;
}
export interface BackendRegistration {
  id: string; eventId: string; userId: string; status: 'active' | 'cancelled'; abilityConfirmed: boolean;
  equipmentConfirmed: boolean; waiverVersion: string; waiverAcceptedAt: string; createdAt: string;
  updatedAt: string; cancelledAt: string | null;
}
export interface BackendRegistrationResult { registration: BackendRegistration; event: BackendEvent; replayed: boolean; }
export interface BackendUserRegistration { registration: BackendRegistration; event: BackendEvent; }
export interface BackendEventParticipant {
  nickname: string | null;
  avatarUrl: string | null;
  isOrganizer: boolean;
  contactId?: string;
}
export interface CreateBackendEvent {
  routeId: string | null; title: string; summary: string; startAt: string; registrationDeadline: string;
  meetingPoint: string; difficulty: BackendDifficulty; distanceKm: number; elevationGainM: number;
  speedMinKph: number; speedMaxKph: number; capacity: number; equipmentRequirements: string[];
  abilityRequirements: string[]; safetyNotice: string;
}

const difficultyToClient: Record<BackendDifficulty, RideRoute['difficulty']> = {
  easy: '轻松', moderate: '中等', challenging: '进阶', expert: '进阶',
};
const difficultyToBackend: Record<RideRoute['difficulty'], BackendDifficulty> = {
  轻松: 'easy', 中等: 'moderate', 进阶: 'challenging',
};

function abilityNumber(items: string[], keyword: string): number {
  const text = items.flatMap((item) => item.split(/[；;]/)).find((item) => item.includes(keyword));
  return Number(text?.match(/\d+(?:\.\d+)?/)?.[0] || 0);
}

const disciplineLabels = ['听从领队指挥', '保持安全车距', '下坡禁止超车', '掉队原地等收队'];

function parseAbilityRequirements(items: string[]) {
  const segments = items.flatMap((item) => item.split(/[；;]/)).map((item) => item.trim()).filter(Boolean);
  const bikeLine = segments.find((item) => /^允许车型[:：]/.test(item));
  const bikeTypes = bikeLine
    ? bikeLine.replace(/^允许车型[:：]\s*/, '').split(/[、,，/]/).map((item) => item.trim()).filter(Boolean)
    : [];
  const disciplines = disciplineLabels.filter((label) => segments.includes(label));
  const generated = (item: string) => /^近\s*\d+\s*天完成过\s*\d+(?:\.\d+)?\s*公里骑行$/.test(item)
    || /^近\s*\d+\s*天累计爬升\s*\d+(?:\.\d+)?\s*米$/.test(item)
    || /^允许车型[:：]/.test(item)
    || disciplineLabels.includes(item);
  const customNote = [...new Set(segments.filter((item) => !generated(item)))].join('；').slice(0, 200);
  return {
    bikeTypes: bikeTypes.length ? [...new Set(bikeTypes)] : ['公路车'],
    disciplines: disciplines.length ? disciplines : disciplineLabels.slice(0, 2),
    customNote,
  };
}

export function mapRoadbook(roadbook: BackendRoadbook): RideRoute {
  const track = roadbook.track.map((item) => wgs84ToGcj02(item));
  return {
    id: roadbook.id, name: roadbook.name, city: roadbook.region, distanceKm: roadbook.distanceKm,
    elevationGainM: roadbook.elevationGainM, durationMinutes: roadbook.estimatedMinutes, maxGradient: roadbook.maxGradient,
    difficulty: difficultyToClient[roadbook.difficulty], cover: '/assets/route-mountain.jpg', track,
    elevationProfile: roadbook.elevationProfile,
    pois: roadbook.waypoints.map((item, index) => {
      const coordinate = wgs84ToGcj02(item);
      const kind = item.type === 'start' ? 'meeting' : item.type === 'danger' ? 'risk' : item.type === 'finish' ? 'finish' : 'supply';
      return { id: `${roadbook.id}-poi-${index}`, name: item.name, distanceKm: item.distanceKm, note: item.type === 'danger' ? '风险点，请控制速度' : '路书关键点', kind, ...coordinate };
    }),
  };
}

export function fallbackRoute(event: BackendEvent): RideRoute {
  return {
    id: event.routeId || `event-route-${event.id}`, name: '活动路线', city: event.meetingPoint,
    distanceKm: event.distanceKm, elevationGainM: event.elevationGainM, durationMinutes: Math.max(1, Math.round(event.distanceKm / Math.max(event.speedMinKph, 1) * 60)),
    maxGradient: 0, difficulty: difficultyToClient[event.difficulty], cover: '/assets/ride-group.jpg',
    track: [], elevationProfile: [0, event.elevationGainM, 0], pois: [],
  };
}

export function mapEvent(event: BackendEvent, route: RideRoute | undefined, currentUserId: string): RideEvent {
  const parsedRequirements = parseAbilityRequirements(event.abilityRequirements);
  return {
    id: event.id, title: event.title, coverUrl: event.coverUrl || null,
    organizer: event.organizerProfile?.nickname || '活动组织者', organizerAvatarUrl: event.organizerProfile?.avatarUrl || null,
    startAt: event.startAt, registrationDeadline: event.registrationDeadline, meetingPoint: event.meetingPoint,
    routeId: event.routeId || '', route: route || fallbackRoute(event), capacity: event.capacity,
    registeredCount: event.registrationCount, speedRange: `${event.speedMinKph}-${event.speedMaxKph} km/h`,
    status: event.status === 'draft' ? 'published' : event.status, approvalRequired: false,
    description: event.summary,
    requirements: {
      equipment: event.equipmentRequirements, recentDistanceKm: abilityNumber(event.abilityRequirements, '公里'),
      recentElevationM: abilityNumber(event.abilityRequirements, '爬升'), bikeTypes: parsedRequirements.bikeTypes,
      disciplines: parsedRequirements.disciplines, customNote: parsedRequirements.customNote,
    },
    ownedByMe: event.ownedByMe ?? (Boolean(currentUserId) && event.organizerId === currentUserId),
  };
}

export function mapRegistration(item: BackendRegistration): Registration {
  return { id: item.id, eventId: item.eventId, status: item.status === 'active' ? 'approved' : 'cancelled', phoneMasked: '', bikeType: '', createdAt: item.createdAt };
}

export function toCreateEvent(input: PublishEventInput, route?: RideRoute): CreateBackendEvent {
  const startAt = new Date(`${input.date}T${input.time}:00+08:00`);
  const registrationDeadline = new Date(startAt.getTime() - 12 * 60 * 60 * 1000);
  const speeds = input.speedRange.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  const abilityRequirements = [...new Set([
    `近 30 天完成过 ${input.requirements.recentDistanceKm} 公里骑行`,
    `近 30 天累计爬升 ${input.requirements.recentElevationM} 米`,
    `允许车型：${input.requirements.bikeTypes.join('、')}`,
    ...input.requirements.disciplines,
  ])];
  const customNote = input.requirements.customNote?.trim().slice(0, 200);
  if (customNote && !abilityRequirements.includes(customNote)) abilityRequirements.push(customNote);
  return {
    routeId: input.routeId || null, title: input.title.trim(), summary: input.description.trim(),
    startAt: startAt.toISOString(), registrationDeadline: registrationDeadline.toISOString(), meetingPoint: input.meetingPoint.trim(),
    difficulty: difficultyToBackend[route?.difficulty || input.difficulty || '中等'],
    distanceKm: route?.distanceKm || input.distanceKm || 0,
    elevationGainM: route?.elevationGainM ?? input.elevationGainM ?? 0,
    speedMinKph: speeds[0] || 20, speedMaxKph: speeds[1] || speeds[0] || 25, capacity: input.capacity,
    equipmentRequirements: input.requirements.equipment, abilityRequirements, safetyNotice: input.description.trim(),
  };
}
