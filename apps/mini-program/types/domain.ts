export type EventStatus = 'published' | 'full' | 'cancelled' | 'completed';
export type RegistrationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface RoutePoi {
  id: string;
  name: string;
  distanceKm: number;
  note: string;
  kind: 'meeting' | 'supply' | 'risk' | 'finish';
  latitude: number;
  longitude: number;
}

export interface RideRoute {
  id: string;
  name: string;
  city: string;
  distanceKm: number;
  elevationGainM: number;
  durationMinutes: number;
  maxGradient: number;
  difficulty: '轻松' | '中等' | '进阶';
  cover: string;
  track: Array<{ latitude: number; longitude: number }>;
  elevationProfile: number[];
  pois: RoutePoi[];
}

export interface RideRequirements {
  equipment: string[];
  recentDistanceKm: number;
  recentElevationM: number;
  bikeTypes: string[];
  disciplines: string[];
  customNote?: string;
}

export interface RideEvent {
  id: string;
  title: string;
  coverUrl?: string | null;
  organizer: string;
  organizerAvatarUrl?: string | null;
  startAt: string;
  registrationDeadline: string;
  meetingPoint: string;
  meetingLatitude?: number | null;
  meetingLongitude?: number | null;
  routeId: string;
  route: RideRoute;
  capacity: number;
  registeredCount: number;
  speedRange: string;
  status: EventStatus;
  approvalRequired: boolean;
  description: string;
  requirements: RideRequirements;
  ownedByMe?: boolean;
}

export interface Registration {
  id: string;
  eventId: string;
  status: RegistrationStatus;
  phoneMasked: string;
  bikeType: string;
  createdAt: string;
}

export interface RegistrationInput {
  phone: string;
  emergencyContact: string;
  bikeType: string;
  abilityConfirmed: boolean;
  waiverConfirmed: boolean;
}

export interface MyRegistrationRecord {
  registration: Registration;
  event: RideEvent;
}

export interface PublishEventInput {
  title: string;
  date: string;
  time: string;
  meetingPoint: string;
  meetingLatitude?: number;
  meetingLongitude?: number;
  routeId: string;
  distanceKm?: number;
  elevationGainM?: number;
  difficulty?: RideRoute['difficulty'];
  capacity: number;
  speedRange: string;
  description: string;
  coverFilePath?: string;
  coverUrl?: string | null;
  requirements: RideRequirements;
}

export interface UserProfile {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  phoneMasked?: string | null;
  gender?: number | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
}

export interface EventParticipant {
  nickname: string | null;
  avatarUrl: string | null;
  isOrganizer: boolean;
  contactId?: string;
}

export interface EventParticipantContact {
  nickname: string | null;
  avatarUrl: string | null;
  phone: string;
  emergencyContact: string;
  bikeType: string;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId?: string;
}
