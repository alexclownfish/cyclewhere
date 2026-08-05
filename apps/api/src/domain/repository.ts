import type {
  CyclingEvent,
  Registration,
  RegistrationResult,
  Roadbook,
  UserRegistrationItem,
} from "./models.js";

export interface EventListQuery {
  status?: CyclingEvent["status"];
  difficulty?: CyclingEvent["difficulty"];
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RegisterCommand {
  eventId: string;
  userId: string;
  idempotencyKey: string;
  abilityConfirmed: boolean;
  equipmentConfirmed: boolean;
  waiverVersion: string;
  phoneEncrypted: string;
  emergencyContactEncrypted: string;
  bikeType: string;
  now: Date;
}

export interface Repository {
  createEvent(event: CyclingEvent): Promise<CyclingEvent>;
  updateEvent(event: CyclingEvent): Promise<CyclingEvent>;
  getEvent(id: string): Promise<CyclingEvent | null>;
  listEvents(query: EventListQuery): Promise<Page<CyclingEvent>>;
  createRoadbook(roadbook: Roadbook): Promise<Roadbook>;
  getRoadbook(id: string): Promise<Roadbook | null>;
  listRoadbooks(limit: number, cursor?: string): Promise<Page<Roadbook>>;
  registerAtomically(command: RegisterCommand): Promise<RegistrationResult>;
  cancelRegistrationAtomically(eventId: string, userId: string, now: Date): Promise<RegistrationResult>;
  getRegistration(eventId: string, userId: string): Promise<Registration | null>;
  listRegistrationsByUser(userId: string): Promise<UserRegistrationItem[]>;
}
